import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Called by the service worker's `pushsubscriptionchange` handler when the
 * push service rotates this device's subscription (common on Android/FCM).
 *
 * A service-worker `fetch()` is same-origin, so it carries the session cookie
 * and we can act as the signed-in user: the row swap goes through the normal
 * user-scoped client and RLS (`user_id = auth.uid()`) is the ownership check.
 * We deliberately do NOT use the service-role key here — an unauthenticated
 * "possessing the old endpoint is proof enough" route would let anyone who
 * learned a stored endpoint repoint it at their own keys and receive that
 * user's decrypted notifications.
 *
 * If the session has lapsed, we 401 and the app self-heals on next launch via
 * syncPushSubscription(), which always runs with a real session.
 */

// Only the real push services — never let a client make our sender POST
// encrypted payloads to an arbitrary host.
const PUSH_HOSTS = [
  "android.googleapis.com",
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
];

function pushHost(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    if (protocol !== "https:") return null;
    const ok = PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    return ok ? host : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let oldEndpoint: unknown;
  let subscription: { endpoint?: unknown; keys?: unknown } | null = null;
  try {
    const body = await request.json();
    oldEndpoint = body.oldEndpoint;
    subscription = body.subscription;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const keys = subscription?.keys as
    | { p256dh?: unknown; auth?: unknown }
    | undefined;
  if (
    typeof oldEndpoint !== "string" ||
    typeof subscription?.endpoint !== "string" ||
    !pushHost(oldEndpoint) ||
    !pushHost(subscription.endpoint) ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return NextResponse.json({ updated: false });
  }

  // Swap the subscription on this user's own row for the old endpoint. RLS
  // scopes the update; the extra user_id filter keeps intent explicit.
  const { data, error } = await supabase
    .from("push_subscriptions")
    .update({ subscription })
    .eq("endpoint", oldEndpoint)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    // 23505: the new endpoint already has its own row (the client re-upserted
    // first) — the old row is stale, so just drop it.
    if (error.code === "23505") {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", oldEndpoint)
        .eq("user_id", user.id);
      return NextResponse.json({ updated: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ((data?.length ?? 0) > 0) return NextResponse.json({ updated: true });

  // No row matched (already pruned, or never ours) — register the new
  // subscription for this user so the device isn't left silent.
  const { error: upsertError } = await supabase
    .from("push_subscriptions")
    .upsert({ user_id: user.id, subscription }, { onConflict: "endpoint" });
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }
  return NextResponse.json({ updated: true });
}
