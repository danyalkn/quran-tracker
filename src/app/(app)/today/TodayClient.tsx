"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Inbox, UserPlus, Bookmark } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  bucketOf,
  pagesEquiv,
  type EntryType,
  type Mode,
} from "@/lib/entries";
import type { LogRow, NewEntry } from "@/lib/types";
import { localDate, todayLocal, currentStreak, longestStreak } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { SpeedDial } from "@/components/SpeedDial";
import { LogSheet } from "@/components/LogSheet";
import { EntryRow } from "@/components/EntryRow";

type Filter = "all" | "new" | "revision";

export function TodayClient({
  mode,
  tz,
  displayName,
  avatarUrl,
  userId,
  groupId,
  initialEntries,
}: {
  mode: Mode;
  tz: string;
  displayName: string;
  avatarUrl: string | null;
  userId: string;
  groupId: string | null;
  initialEntries: LogRow[];
}) {
  const [entries, setEntries] = useState<LogRow[]>(initialEntries);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetType, setSheetType] = useState<EntryType>(
    mode === "hifz" ? "sabak" : "reading",
  );
  const [error, setError] = useState<string | null>(null);

  const today = todayLocal(tz);

  const loggedDays = useMemo(
    () => new Set(entries.map((e) => localDate(e.logged_at, tz))),
    [entries, tz],
  );
  const streak = currentStreak(loggedDays, tz);
  const longest = longestStreak(loggedDays);

  const todayEntries = useMemo(
    () => entries.filter((e) => localDate(e.logged_at, tz) === today),
    [entries, tz, today],
  );
  const filtered = todayEntries.filter((e) =>
    filter === "all" ? true : bucketOf(e.entry_type) === filter,
  );

  // Most recent reading bookmark, to resume from.
  const lastStopped = entries.find(
    (e) =>
      (e.entry_type === "reading" || e.entry_type === "revising") && e.to_ref,
  )?.to_ref;

  const dateLabel = new Date().toLocaleDateString("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const handlePick = (t: EntryType) => {
    setSheetType(t);
    setSheetOpen(true);
  };

  const handleSave = async (payload: NewEntry) => {
    if (!groupId) return;
    setError(null);
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: LogRow = {
      id: tempId,
      user_id: userId,
      group_id: groupId,
      logged_at: new Date().toISOString(),
      pages_equiv: pagesEquiv(payload.amount, payload.unit),
      ...payload,
    };
    setEntries((prev) => [optimistic, ...prev]);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("log_entries")
      .insert({
        user_id: userId,
        group_id: groupId,
        entry_type: payload.entry_type,
        from_ref: payload.from_ref,
        to_ref: payload.to_ref,
        amount: payload.amount,
        unit: payload.unit,
        juz: payload.juz,
        part: payload.part,
        notes: payload.notes,
      })
      .select("*")
      .single();

    if (error || !data) {
      setEntries((prev) => prev.filter((e) => e.id !== tempId));
      setError(error?.message ?? "Couldn’t save that entry. Try again.");
      return;
    }
    setEntries((prev) =>
      prev.map((e) => (e.id === tempId ? (data as LogRow) : e)),
    );
  };

  const handleDelete = async (id: string) => {
    const prev = entries;
    setEntries((p) => p.filter((e) => e.id !== id));
    const supabase = createClient();
    const { error } = await supabase.from("log_entries").delete().eq("id", id);
    if (error) {
      setEntries(prev);
      setError("Couldn’t delete that entry.");
    }
  };

  const segments: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    {
      value: "new",
      label: mode === "hifz" ? "New (Sabak)" : "Reading",
    },
    {
      value: "revision",
      label: mode === "hifz" ? "Revision" : "Revising",
    },
  ];

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <header className="px-5 pt-7 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-footnote font-medium uppercase tracking-wider text-faint">
              {dateLabel}
            </p>
            <h1 className="mt-1 text-display">Today</h1>
          </div>
          <Link href="/settings" aria-label="Settings">
            <Avatar name={displayName} src={avatarUrl} />
          </Link>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 px-5">
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Streak</p>
          <p className="mt-2 text-title1 tabular-nums">{streak}</p>
          <p className="text-footnote text-faint">
            {streak === 1 ? "day" : "days"} · longest {longest}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-e1">
          <p className="text-footnote font-medium text-muted">Logged today</p>
          <p className="mt-2 text-title1 tabular-nums">{todayEntries.length}</p>
          <p className="text-footnote text-faint">
            {todayEntries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
      </div>

      {/* Resume-from bookmark */}
      {lastStopped && (
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-xl bg-accent-tint px-3.5 py-2.5 text-accent">
            <Bookmark className="size-4 shrink-0" />
            <span className="text-footnote font-medium">
              Last stopped at {lastStopped}
            </span>
          </div>
        </div>
      )}

      {/* Filter (hifz only — readers have a single category) */}
      {mode !== "reading" && todayEntries.length > 0 && (
        <div className="px-5 pt-5">
          <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
            {segments.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilter(s.value)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                  s.value === filter
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mx-5 mt-3 rounded-lg bg-danger-tint px-3 py-2 text-footnote text-danger">
          {error}
        </p>
      )}

      {/* Entries */}
      <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto px-5 pb-28">
        {!groupId ? (
          <EmptyState
            icon={UserPlus}
            title="You’re not in a circle yet"
            note="Ask the group owner to add you. Once you’re in, your logs and your circle’s feed show up here."
          />
        ) : todayEntries.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing logged yet today"
            note="Tap the + to log your first entry. Small and consistent wins."
          />
        ) : (
          <>
            <p className="px-1 text-footnote font-medium uppercase tracking-wider text-faint">
              Today’s entries
            </p>
            {filtered.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                tz={tz}
                onDelete={handleDelete}
              />
            ))}
            {filtered.length === 0 && (
              <p className="px-1 pt-2 text-footnote text-faint">
                No {filter} entries today.
              </p>
            )}
          </>
        )}
      </div>

      <SpeedDial mode={mode} onPick={handlePick} disabled={!groupId} />

      <LogSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        initialType={sheetType}
        onSave={handleSave}
      />
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  note,
}: {
  icon: typeof Inbox;
  title: string;
  note: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 pt-12 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-accent-tint text-accent">
        <Icon className="size-7" strokeWidth={2} />
      </div>
      <p className="mt-4 text-callout font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-footnote text-muted">{note}</p>
    </div>
  );
}
