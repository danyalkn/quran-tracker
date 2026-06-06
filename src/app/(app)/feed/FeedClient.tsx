"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Inbox, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { GroupMember, LogRow } from "@/lib/types";
import { localDate, todayLocal, timeLabel, dayLabel } from "@/lib/dates";
import { describeEntry, quantityLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";

export function FeedClient({
  groupId,
  groupName,
  tz,
  userId,
  members,
  initialEntries,
  nudgedToday,
}: {
  groupId: string;
  groupName: string;
  tz: string;
  userId: string;
  members: GroupMember[];
  initialEntries: LogRow[];
  nudgedToday: string[];
}) {
  const [entries, setEntries] = useState<LogRow[]>(initialEntries);
  const [nudged, setNudged] = useState<Set<string>>(new Set(nudgedToday));

  const nudge = async (toUser: string) => {
    setNudged((prev) => new Set(prev).add(toUser));
    const supabase = createClient();
    const { error } = await supabase.from("nudges").insert({
      group_id: groupId,
      from_user: userId,
      to_user: toUser,
      kind: "log_reminder",
    });
    if (error) {
      setNudged((prev) => {
        const n = new Set(prev);
        n.delete(toUser);
        return n;
      });
    }
  };

  const memberMap = useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );

  // Live-update the feed when anyone logs (in-app only — no push for feed).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`feed-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "log_entries",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const row = payload.new as LogRow;
          setEntries((prev) =>
            prev.some((e) => e.id === row.id) ? prev : [row, ...prev],
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);

  const today = todayLocal(tz);
  const loggedTodayIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) {
      if (localDate(e.logged_at, tz) === today) s.add(e.user_id);
    }
    return s;
  }, [entries, tz, today]);

  // Group entries by local day, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const e of entries) {
      const d = localDate(e.logged_at, tz);
      (map.get(d) ?? map.set(d, []).get(d)!).push(e);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries, tz]);

  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("en-CA");
  })();

  const dayHeading = (ymd: string) =>
    ymd === today ? "Today" : ymd === yesterday ? "Yesterday" : dayLabel(ymd);

  const loggedCount = loggedTodayIds.size;
  const notLogged = members.filter(
    (m) => m.user_id !== userId && !loggedTodayIds.has(m.user_id),
  );

  return (
    <div className="flex h-full flex-col">
      <header className="px-5 pt-7 pb-3">
        <p className="text-footnote font-medium uppercase tracking-wider text-faint">
          {groupName} · {members.length}{" "}
          {members.length === 1 ? "member" : "members"}
        </p>
        <h1 className="mt-1 text-display">Feed</h1>
      </header>

      {/* Logged-today strip */}
      <div className="px-5">
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Logged today</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {members.map((m) => {
              const on = loggedTodayIds.has(m.user_id);
              return (
                <div key={m.user_id} className="relative">
                  <Avatar
                    name={m.display_name}
                    src={m.avatar_url}
                    size={44}
                    className={cn(!on && "opacity-50")}
                  />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full ring-2 ring-surface",
                      on ? "bg-accent text-on-accent" : "bg-surface-2",
                    )}
                  >
                    {on && <Check className="size-2.5" strokeWidth={4} />}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-footnote text-faint">
            {loggedCount} of {members.length} logged today
          </p>

          {notLogged.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {notLogged.map((m) => {
                const first = m.display_name.split(" ")[0];
                const done = nudged.has(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    onClick={() => !done && nudge(m.user_id)}
                    disabled={done}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-footnote font-medium transition-colors",
                      done
                        ? "bg-surface-2 text-faint"
                        : "bg-accent-tint text-accent active:scale-95",
                    )}
                  >
                    {done ? (
                      <>
                        <Check className="size-3.5" strokeWidth={3} /> Nudged{" "}
                        {first}
                      </>
                    ) : (
                      <>
                        <Bell className="size-3.5" /> Nudge {first}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Feed */}
      <div className="mt-5 flex-1 space-y-5 overflow-y-auto px-5 pb-6">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 pt-12 text-center">
            <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
              <Inbox className="size-7" strokeWidth={2} />
            </div>
            <p className="mt-4 text-callout font-semibold">No activity yet</p>
            <p className="mt-1 max-w-xs text-footnote text-muted">
              When your circle logs, it shows up here. Be the first today.
            </p>
          </div>
        ) : (
          groups.map(([ymd, rows]) => (
            <div key={ymd}>
              <p className="mb-2 px-1 text-footnote font-medium uppercase tracking-wider text-faint">
                {dayHeading(ymd)}
              </p>
              <div className="space-y-2.5">
                {rows.map((e) => {
                  const m = memberMap.get(e.user_id);
                  const amt = quantityLabel(e);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1"
                    >
                      <Avatar
                        name={m?.display_name ?? "Member"}
                        src={m?.avatar_url}
                        size={40}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-callout font-semibold">
                            {e.user_id === userId
                              ? "You"
                              : (m?.display_name ?? "Member")}
                          </span>
                          <span className="shrink-0 text-caption text-faint tabular-nums">
                            · {timeLabel(e.logged_at, tz)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge type={e.entry_type} />
                          <span className="truncate text-footnote text-muted">
                            {describeEntry(e)}
                            {amt ? ` · ${amt}` : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
