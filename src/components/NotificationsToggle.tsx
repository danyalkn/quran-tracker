"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import {
  getPushState,
  enablePush,
  disablePush,
  type PushState,
} from "@/lib/push";
import { FieldLabel } from "@/components/ui/Field";
import { cn } from "@/lib/cn";

export function NotificationsToggle({ userId }: { userId: string }) {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  const on = state === "on";

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(on ? await disablePush() : await enablePush(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const note: Record<PushState, string> = {
    unsupported: "This browser doesn’t support push notifications.",
    "needs-install":
      "On iPhone, add Iqra to your Home Screen first (Safari → Share → Add to Home Screen), then turn this on.",
    denied:
      "Notifications are blocked. Enable them for Iqra in your browser/site settings, then try again.",
    off: "Get a nudge for your reminders and when someone @mentions you in chat.",
    on: "You’ll get your reminders and @mention alerts on this device.",
  };

  return (
    <div>
      <FieldLabel>Notifications</FieldLabel>
      <div className="rounded-2xl bg-surface p-4 shadow-e1">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              on ? "bg-accent-tint text-accent" : "bg-surface-2 text-muted",
            )}
          >
            {on ? <BellRing className="size-5" /> : <Bell className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-callout font-semibold">Push notifications</p>
            <p className="text-footnote text-muted">
              {state === "loading" ? "Checking…" : note[state]}
            </p>
          </div>
          {(state === "on" || state === "off") && (
            <button
              onClick={toggle}
              disabled={busy}
              aria-pressed={on}
              className={cn(
                "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                on ? "bg-accent" : "bg-border",
                busy && "opacity-60",
              )}
            >
              {busy ? (
                <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-white" />
              ) : (
                <span
                  className={cn(
                    "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                    on ? "left-[1.375rem]" : "left-0.5",
                  )}
                />
              )}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}
      </div>
    </div>
  );
}
