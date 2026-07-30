import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/keys";

/**
 * Sends a test push to the signed-in user's own devices via the send-push
 * edge function (which requires the service-role key, so browsers can't call
 * it directly). Splits the debugging space in half: if the test arrives,
 * delivery works and the problem is upstream (reminder scheduling, mentions);
 * if it doesn't, it's the subscription or the device's OS settings.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      user_ids: [user.id],
      payload: {
        title: "Iqra test 🔔",
        body: "Push notifications are working on this account.",
        url: "/settings",
        tag: "test",
      },
    }),
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: `send-push returned ${res.status}` },
      { status: 502 },
    );
  }

  const result = await res.json();
  return NextResponse.json(result);
}
