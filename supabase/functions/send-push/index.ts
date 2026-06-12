// Iqra — send-push Edge Function
// Sends Web Push (VAPID) to one or more users. Called by the pg_cron jobs
// (reminders) and the messages @mention trigger via pg_net, authenticated with
// the project's service-role key. Dead subscriptions (404/410) are pruned.
//
// Deploy:  supabase functions deploy send-push
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

type Payload = { title: string; body: string; url?: string; tag?: string };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Only server-to-server callers (cron / triggers) may fan out notifications.
// The function's verify_jwt gateway already validates the token's signature, so
// trusting its decoded `role` claim is safe. We accept an exact service-role
// key match (fast path) or any validly-signed service_role JWT.
function isAuthorized(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  if (token === SERVICE_ROLE) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!isAuthorized(req.headers.get("Authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let userIds: string[] = [];
  let payload: Payload;
  try {
    const body = await req.json();
    userIds = Array.isArray(body.user_ids) ? body.user_ids : [];
    payload = body.payload;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (userIds.length === 0 || !payload?.title) {
    return Response.json({ sent: 0, removed: 0 });
  }

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, subscription")
    .in("user_id", userIds);

  let sent = 0;
  let removed = 0;

  await Promise.all(
    (subs ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription as webpush.PushSubscription,
          JSON.stringify(payload),
          // high urgency → FCM wakes the device out of Doze for prompt delivery
          // even when the app is fully closed; TTL keeps it for a day if offline.
          { urgency: "high", TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", row.id);
          removed++;
        }
      }
    }),
  );

  return Response.json({ sent, removed });
});
