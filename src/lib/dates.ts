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

/** Yesterday's local date (YYYY-MM-DD) in the given timezone. */
export function yesterdayLocal(tz: string): string {
  return prevYmd(todayLocal(tz));
}

/** How far `tz` is ahead of UTC at a given instant, in ms. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour % 24, // some locales render midnight as 24
    +p.minute,
    +p.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * ISO instant for a wall-clock time in a specific timezone — e.g. "8pm on
 * 2026-07-28 in Asia/Karachi". Needed because backdated entries must land on
 * the right *profile-local* day, and the device may be in another zone.
 * Two passes so the offset is read at (close to) the target instant, which
 * keeps it correct across DST boundaries.
 */
export function zonedIso(ymd: string, hour: number, tz: string): string {
  const naive = Date.UTC(
    +ymd.slice(0, 4),
    +ymd.slice(5, 7) - 1,
    +ymd.slice(8, 10),
    hour,
  );
  let ts = naive - tzOffsetMs(new Date(naive), tz);
  ts = naive - tzOffsetMs(new Date(ts), tz);

  // A spring-forward can make the requested wall time nonexistent (e.g. 00:00
  // in Santiago on a transition date), which would resolve onto the previous
  // day — the one thing this helper must never do. Step forward until the
  // instant really is on the intended local date.
  for (let i = 0; i < 4 && localDate(ts, tz) !== ymd; i++) {
    ts += 60 * 60 * 1000;
  }
  return new Date(ts).toISOString();
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

/**
 * iMessage-style separator label for a chat time break, in the user's tz:
 * "Today 6:12 AM", "Yesterday 9:01 PM", "Wed 3:14 PM" (this week), or
 * "12 May, 4:00 PM" / "12 May 2025, 4:00 PM" (older).
 */
export function chatStamp(ts: string | number | Date, tz: string): string {
  const ymd = localDate(ts, tz);
  const today = todayLocal(tz);
  const time = timeLabel(ts, tz);
  if (ymd === today) return `Today ${time}`;
  if (ymd === prevYmd(today)) return `Yesterday ${time}`;

  const dThen = new Date(`${ymd}T12:00:00`);
  const dToday = new Date(`${today}T12:00:00`);
  const diffDays = Math.round((dToday.getTime() - dThen.getTime()) / 86_400_000);
  if (diffDays > 1 && diffDays < 7) {
    return `${dThen.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  }
  const sameYear = dThen.getFullYear() === dToday.getFullYear();
  const date = dThen.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
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
  return lastNDaysEndingOn(todayLocal(tz), n);
}

/** As `lastNDays`, but ending on an explicit date. Prefer this inside memos:
 *  the window then depends on a value React can see, not a hidden clock read. */
export function lastNDaysEndingOn(endYmd: string, n: number): string[] {
  const out: string[] = [];
  let cursor = endYmd;
  for (let i = 0; i < n; i++) {
    out.push(cursor);
    cursor = prevYmd(cursor);
  }
  return out.reverse();
}

/* ── Calendar periods ───────────────────────────────────────────────────────
 * Weeks and months are real calendar periods, not rolling N-day windows: the
 * current week runs Monday → today, the current month runs the 1st → today,
 * and past periods are whole. A rolling window answers "the last 7 days",
 * which is a different (and less intuitive) question than "this week". */

/** Monday of the week containing `ymd` (ISO weeks — Monday is day 1). */
export function startOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  // getDay(): 0=Sun … 6=Sat. Sunday belongs to the week that began 6 days ago.
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString("en-CA");
}

/** Every date in the week containing `ymd`, Monday → Sunday. */
export function weekDates(ymd: string): string[] {
  const start = startOfWeek(ymd);
  const out: string[] = [start];
  for (let i = 1; i < 7; i++) out.push(nextYmd(out[i - 1]));
  return out;
}

/** The week containing `ymd`, but never past `upTo` (so the current week ends
 *  today rather than running into the future). */
export function weekDatesUpTo(ymd: string, upTo: string): string[] {
  return weekDates(ymd).filter((d) => d <= upTo);
}

/** Monday of the week `n` weeks before the one containing `ymd`. */
export function addWeeks(ymd: string, n: number): string {
  const d = new Date(`${startOfWeek(ymd)}T12:00:00`);
  d.setDate(d.getDate() + n * 7);
  return d.toLocaleDateString("en-CA");
}

/** Month key ("YYYY-MM") of a local date string. */
export function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

/** Shift a "YYYY-MM" key by `n` months. */
export function addMonths(key: string, n: number): string {
  const d = new Date(`${key}-01T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString("en-CA").slice(0, 7);
}

/** Every date in month `key` ("YYYY-MM"), 1st → last, capped at `upTo`. */
export function monthDates(key: string, upTo?: string): string[] {
  const [y, m] = [+key.slice(0, 4), +key.slice(5, 7)];
  // Day 0 of the next month is the last day of this one.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let day = 1; day <= last; day++) {
    const ymd = `${key}-${String(day).padStart(2, "0")}`;
    if (upTo && ymd > upTo) break;
    out.push(ymd);
  }
  return out;
}

/** "July" for the current year, "July 2025" otherwise. */
export function monthLabel(key: string, todayYmd: string): string {
  const d = new Date(`${key}-01T12:00:00`);
  const sameYear = key.slice(0, 4) === todayYmd.slice(0, 4);
  return d.toLocaleDateString("en-GB", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "6–12 Jul" style label for a week starting on `startYmd`. */
export function weekRangeLabel(startYmd: string, endYmd: string): string {
  // A week-to-date range is a single day every Monday — don't print "27–27 Jul".
  if (startYmd === endYmd) return shortDate(startYmd);
  const a = new Date(`${startYmd}T12:00:00`);
  const b = new Date(`${endYmd}T12:00:00`);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString("en-GB", {
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
  });
  const right = b.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${left}–${right}`;
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
