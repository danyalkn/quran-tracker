/** Date helpers that respect each user's IANA timezone (streaks + "today"
 *  are local-day concepts). No external date library needed. */

/** Local calendar date (YYYY-MM-DD) of an instant, in the given timezone. */
export function localDate(ts: string | number | Date, tz: string): string {
  // en-CA renders as YYYY-MM-DD.
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: tz });
}

/** Today's local date (YYYY-MM-DD) in the given timezone. */
export function todayLocal(tz: string): string {
  return localDate(new Date(), tz);
}

/** Short label like "Mon · 6 Jun" for a local date string. */
export function dayLabel(ymd: string): string {
  // Parse as a local-noon date to avoid TZ drift on the label itself.
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Time label like "6:12 AM" for an instant in the given timezone. */
export function timeLabel(ts: string | number | Date, tz: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
}

function prevYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}

/**
 * Current streak = consecutive local days with ≥1 entry, counting back from
 * today (or from yesterday if nothing logged yet today, so the streak doesn't
 * read 0 until a full day is actually missed).
 */
export function currentStreak(loggedDays: Set<string>, tz: string): number {
  const today = todayLocal(tz);
  let cursor = loggedDays.has(today) ? today : prevYmd(today);
  if (!loggedDays.has(cursor)) return 0;
  let streak = 0;
  while (loggedDays.has(cursor)) {
    streak += 1;
    cursor = prevYmd(cursor);
  }
  return streak;
}

/** Longest run of consecutive local days in the set. */
export function longestStreak(loggedDays: Set<string>): number {
  let best = 0;
  for (const day of loggedDays) {
    // Only start counting from the beginning of a run.
    if (loggedDays.has(prevYmd(day))) continue;
    let run = 0;
    let cursor = day;
    while (loggedDays.has(cursor)) {
      run += 1;
      cursor = nextYmd(cursor);
    }
    if (run > best) best = run;
  }
  return best;
}

function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

/** The last `n` local dates (YYYY-MM-DD), oldest → newest, ending today. */
export function lastNDays(tz: string, n: number): string[] {
  const out: string[] = [];
  let cursor = todayLocal(tz);
  for (let i = 0; i < n; i++) {
    out.push(cursor);
    cursor = prevYmd(cursor);
  }
  return out.reverse();
}

/** "6 Jun" short date for a local date string. */
export function shortDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Single-letter weekday for a local date string (M/T/W…). */
export function weekdayInitial(ymd: string): string {
  return ["S", "M", "T", "W", "T", "F", "S"][
    new Date(`${ymd}T12:00:00`).getDay()
  ];
}
