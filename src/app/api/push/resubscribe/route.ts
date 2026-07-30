import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/keys";

/**
 * Called by the service worker's `pushsubscriptionchange` handler, which runs
 * with no auth session. The old endpoint is a long unguessable push-service
 * URL, so possessing it proves this device owned the old subscription; we
 * only ever swap the subscription on that existing row (user_id untouched).
 * If the old row is already gone, we no-op — the app heals itself on next
 * launch via syncPushSubscription(), which runs with a real session.
 */
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

  if (
    typeof oldEndpoint !== "string" ||
    !oldEndpoint.startsWith("https://") ||
    typeof subscription?.endpoint !== "string" ||
    !subscription.endpoint.startsWith("https://")
  ) {
    return NextResponse.json({ updated: false });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const admin = createAdminClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("push_subscriptions")
    .update({ subscription })
    .eq("endpoint", oldEndpoint)
    .select("id");

  if (error) {
    // 23505: the new endpoint already has its own row (client re-upserted
    // first) — the old row is stale, so just drop it.
    if (error.code === "23505") {
      await admin.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
      return NextResponse.json({ updated: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ updated: (data?.length ?? 0) > 0 });
}
