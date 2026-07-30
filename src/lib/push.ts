import { createClient } from "@/lib/supabase/client";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export type PushState =
  | "unsupported"
  | "needs-install" // iOS Safari, not added to Home Screen
  | "denied"
  | "off"
  | "on";

function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iOS only exposes Push once installed to the Home Screen.
    if (isIOS() && !isStandalone()) return "needs-install";
    return "unsupported";
  }
  if (isIOS() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";

  // Don't hang on serviceWorker.ready if the SW isn't active yet.
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ]);
  if (!reg) return "off";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Marks that the user turned push ON for this device, so the launch-time
 *  re-sync knows it may silently resubscribe after the push service rotates
 *  the subscription (frequent on Android/FCM, rare on Apple's service). */
const ENABLED_FLAG = "iqra:push-enabled";

/** Request permission, subscribe, and persist the subscription. Must be called
 *  from a user gesture. Returns the resulting state. */
export async function enablePush(userId: string): Promise<PushState> {
  if (!VAPID_PUBLIC_KEY) throw new Error("Missing VAPID public key.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "denied" : "off";
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const supabase = createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, subscription: sub.toJSON() as unknown as object },
      { onConflict: "endpoint" },
    );
  if (error) throw error;
  try {
    localStorage.setItem(ENABLED_FLAG, "1");
  } catch {}
  return "on";
}

/** Unsubscribe this device and remove its stored subscription. */
export async function disablePush(): Promise<PushState> {
  try {
    localStorage.removeItem(ENABLED_FLAG);
  } catch {}
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const supabase = createClient();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }
  return "off";
}

/** Launch-time self-heal. Two Android-realistic failures leave a device that
 *  thinks push is on but never receives anything:
 *   1. FCM rotated/expired the subscription → old endpoint 410s → the edge
 *      function pruned the DB row → nothing re-creates it.
 *   2. The subscription still exists locally but its DB row is gone (prune,
 *      reinstall, account hiccup).
 *  With permission already granted, resubscribing needs no user gesture, so
 *  every launch we re-assert the subscription and re-upsert its row. No-op
 *  unless the user enabled push on this device (ENABLED_FLAG). */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !VAPID_PUBLIC_KEY ||
      Notification.permission !== "granted" ||
      localStorage.getItem(ENABLED_FLAG) !== "1"
    ) {
      return;
    }

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;

    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    if (!reg) return;

    let sub = await reg.pushManager.getSubscription();

    // Rotate proactively when the browser reports an imminent expiry.
    if (sub?.expirationTime && sub.expirationTime - Date.now() < 24 * 60 * 60 * 1000) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    // Upsert is idempotent — cheap insurance against a pruned/missing row.
    await supabase.from("push_subscriptions").upsert(
      {
        user_id: session.user.id,
        subscription: sub.toJSON() as unknown as object,
      },
      { onConflict: "endpoint" },
    );
  } catch {
    // Best-effort: never block app startup on push housekeeping.
  }
}
