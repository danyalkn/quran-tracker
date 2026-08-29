/** Personal insight + advice engine for the Insights page (mine scope).
 *
 * Two rules drive everything here:
 *  1. Every line is about YOUR relationship with the Quran - never a
 *     comparison with another member (owner direction, 2026-08-29).
 *  2. Phrasing rotates weekly and per-person, from pools, so the card never
 *     reads like the same form letter twice. Selection is deterministic on
 *     (week, user, kind): stable within a week - no flicker between renders,
 *     no server/client hydration mismatch - different the next week.
 *
 * Pure module: no React, no I/O. `**bold**` markers are rendered by the UI.
 */

import { localDate, weekDates, weekDatesUpTo, addWeeks, startOfWeek } from "@/lib/dates";
import {
  juzForPage,
  juzStartPages,
  surahForPage,
  totalPages,
  pageFromRef,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";

export type InsightKind =
  | "trend"
  | "streak"
  | "consistency"
  | "nextJuz"
  | "weekday"
  | "timeOfDay"
  | "bestWeek"
  | "month"
  | "eta";

export type Insight = { kind: InsightKind; text: string; delta?: number | null };

/** Minimal entry shape the engine needs (subset of LogRow / ReadingRow). */
export type InsightEntry = {
  logged_at: string;
  pages_equiv: number | null;
  entry_type?: string;
  to_ref?: string | null;
  mushaf?: string | null;
};

const round1 = (n: number) => +n.toFixed(1);

/** djb2 - tiny, deterministic, identical on server and client. */
export function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const pick = <T,>(pool: T[], seed: string): T => pool[hashSeed(seed) % pool.length];

/** Fill `{key}` slots in a template. */
function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ── Signals ─────────────────────────────────────────────────────────────────

export type PersonalSignals = {
  pagesThisWeek: number;
  pagesSameSpanLastWeek: number;
  spanDays: number;
  activeOf14: number;
  streak: number;
  longestStreak: number;
  /** Strongest weekday all-time, only when the pattern is real (≥15 pages, ≥25% share). */
  topWeekday: { day: number; pages: number; share: number } | null;
  /** Where in the day entries happen, when one bucket clearly leads. */
  topTime: { label: string; share: number } | null;
  /** Best completed calendar week ever (excludes the current, open week). */
  bestWeek: { pages: number; weekStart: string } | null;
  bookmark: { page: number; surah: string; left: number } | null;
  nextJuz: { juz: number; pagesLeft: number } | null;
  /** Khatmah finish estimate from 14-day pace, reading/revising pages only. */
  etaDays: number | null;
};

export function computeSignals(opts: {
  mine: InsightEntry[]; // recent window (~180d), newest first
  mineAllTime: InsightEntry[]; // slim all-time rows
  mineDays: Set<string>; // all local dates with ≥1 entry (recent window)
  streak: number;
  longestStreak: number;
  tz: string;
  today: string;
}): PersonalSignals {
  const { mine, mineAllTime, mineDays, streak, longestStreak, tz, today } = opts;

  const thisWeek = new Set(weekDatesUpTo(today, today));
  const spanDays = thisWeek.size;
  const prevSpan = new Set(weekDates(addWeeks(today, -1)).slice(0, spanDays));
  const pagesIn = (rows: InsightEntry[], days: Set<string>) =>
    round1(
      rows.reduce(
        (s, e) =>
          days.has(localDate(e.logged_at, tz)) ? s + (e.pages_equiv ? +e.pages_equiv : 0) : s,
        0,
      ),
    );
  const pagesThisWeek = pagesIn(mine, thisWeek);
  const pagesSameSpanLastWeek = pagesIn(mine, prevSpan);

  // Last-14 consistency from the recent window.
  let activeOf14 = 0;
  {
    let d = today;
    for (let i = 0; i < 14; i++) {
      if (mineDays.has(d)) activeOf14++;
      const t = new Date(`${d}T12:00:00`);
      t.setDate(t.getDate() - 1);
      d = t.toLocaleDateString("en-CA");
    }
  }

  // Weekday pattern, all-time.
  let topWeekday: PersonalSignals["topWeekday"] = null;
  {
    const byDow = new Array(7).fill(0);
    let total = 0;
    for (const e of mineAllTime) {
      const p = e.pages_equiv ? +e.pages_equiv : 0;
      if (!p) continue;
      byDow[new Date(`${localDate(e.logged_at, tz)}T12:00:00`).getDay()] += p;
      total += p;
    }
    if (total >= 15) {
      const day = byDow.indexOf(Math.max(...byDow));
      const share = byDow[day] / total;
      if (share >= 0.25) topWeekday = { day, pages: round1(byDow[day]), share };
    }
  }

  // Time-of-day pattern (entry timestamps, local hour).
  let topTime: PersonalSignals["topTime"] = null;
  if (mine.length >= 10) {
    const buckets: Record<string, number> = {
      "around Fajr": 0,
      "during the day": 0,
      "in the evening": 0,
      "late at night": 0,
    };
    for (const e of mine) {
      const h = +new Date(e.logged_at).toLocaleString("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      });
      if (h >= 3 && h < 9) buckets["around Fajr"]++;
      else if (h >= 9 && h < 17) buckets["during the day"]++;
      else if (h >= 17 && h < 22) buckets["in the evening"]++;
      else buckets["late at night"]++;
    }
    const [label, n] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
    const share = n / mine.length;
    if (share >= 0.5) topTime = { label, share };
  }

  // Best completed week ever (open week excluded - it can still grow).
  let bestWeek: PersonalSignals["bestWeek"] = null;
  {
    const currentMonday = startOfWeek(today);
    const byWeek = new Map<string, number>();
    for (const e of mineAllTime) {
      const p = e.pages_equiv ? +e.pages_equiv : 0;
      if (!p) continue;
      const wk = startOfWeek(localDate(e.logged_at, tz));
      if (wk === currentMonday) continue;
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + p);
    }
    for (const [weekStart, pages] of byWeek) {
      if (!bestWeek || pages > bestWeek.pages) bestWeek = { pages: round1(pages), weekStart };
    }
  }

  // Bookmark, next-juz distance, khatmah ETA.
  let bookmark: PersonalSignals["bookmark"] = null;
  let nextJuz: PersonalSignals["nextJuz"] = null;
  let etaDays: number | null = null;
  {
    const lastRead = mine.find(
      (e) => (e.entry_type === "reading" || e.entry_type === "revising") && e.to_ref,
    );
    const page = pageFromRef(lastRead?.to_ref);
    if (lastRead && page) {
      const m = (lastRead.mushaf ?? DEFAULT_MUSHAF) as MushafId;
      const total = totalPages(m);
      bookmark = { page, surah: surahForPage(m, page).name, left: total - page };

      const juz = juzForPage(m, page);
      const starts = juzStartPages(m);
      if (juz < 30) {
        // starts[juz] = first page of juz+1 (0-indexed array). The bookmark
        // is the last page READ, so it doesn't count toward what's left -
        // on the final page of a juz there are 0 pages left, not 1.
        const pagesLeft = starts[juz] - page - 1;
        if (pagesLeft > 0) nextJuz = { juz, pagesLeft };
      }

      const cutoff = new Date(`${today}T12:00:00`);
      cutoff.setDate(cutoff.getDate() - 13);
      const floor = cutoff.toLocaleDateString("en-CA");
      const pacePages = round1(
        mine.reduce((s, e) => {
          if (e.entry_type !== "reading" && e.entry_type !== "revising") return s;
          const d = localDate(e.logged_at, tz);
          return d >= floor && d <= today ? s + (e.pages_equiv ? +e.pages_equiv : 0) : s;
        }, 0),
      );
      const pace = pacePages / 14;
      if (pace > 0 && bookmark.left > 0) etaDays = Math.ceil(bookmark.left / pace);
    }
  }

  return {
    pagesThisWeek,
    pagesSameSpanLastWeek,
    spanDays,
    activeOf14,
    streak,
    longestStreak,
    topWeekday,
    topTime,
    bestWeek,
    bookmark,
    nextJuz,
    etaDays,
  };
}

// ── Lines ───────────────────────────────────────────────────────────────────

type Candidate = { kind: InsightKind; text: string; delta?: number | null; weight: number };

/** Build the personal insight list: 4 varied lines + rotation across weeks. */
export function buildPersonalInsights(
  s: PersonalSignals,
  opts: { seedBase: string; includeEta: boolean },
): Insight[] {
  const { seedBase, includeEta } = opts;
  const seed = (kind: string) => seedBase + ":" + kind;
  const out: Candidate[] = [];

  // 1 · Week trend - always present, leads the card.
  {
    const { pagesThisWeek: p, pagesSameSpanLastWeek: q, spanDays } = s;
    const v = {
      p,
      q,
      d: spanDays,
      pw: p === 1 ? "page" : "pages",
      dw: spanDays === 1 ? "day" : "days",
    };
    let text: string;
    if (p === 0 && q === 0) {
      text = pick(
        [
          "A quiet stretch: nothing logged this week or last. The next page ends it.",
          "Two quiet weeks side by side. One entry tonight changes the shape of this card.",
        ],
        seed("trend0"),
      );
    } else if (p >= q) {
      text = fill(
        pick(
          [
            "**{p} {pw}** so far this week. By this point last week you had {q}.",
            "You're at **{p} {pw}** this week, ahead of last week's {q} at the same point.",
            "**{p} {pw}** down, {d} {dw} in. Last week's pace would be {q}.",
          ],
          seed("trendUp"),
        ),
        v,
      );
    } else {
      text = fill(
        pick(
          [
            "**{p} {pw}** this week so far; last week you'd reached {q} by now. Plenty of week left.",
            "This week: **{p} {pw}**. Same days last week: {q}. The gap is one sitting.",
            "You're at **{p}** against last week's {q} at this point. A single page starts the catch-up.",
          ],
          seed("trendDown"),
        ),
        v,
      );
    }
    out.push({
      kind: "trend",
      text,
      delta: q > 0 ? (p - q) / q : p > 0 ? 1 : null,
      weight: 100,
    });
  }

  // 2 · Streak.
  if (s.streak >= s.longestStreak && s.streak >= 3) {
    out.push({
      kind: "streak",
      weight: 90,
      text: fill(
        pick(
          [
            "**{s} days running, your longest streak ever.** Every day now sets a new record.",
            "This is uncharted: **{s} straight days**, the longest you've ever gone.",
          ],
          seed("streakRecord"),
        ),
        { s: s.streak },
      ),
    });
  } else if (s.streak >= 2) {
    out.push({
      kind: "streak",
      weight: 70,
      text: fill(
        pick(
          [
            "**{s} days** in a row. Your record is {L}, and it's catchable.",
            "Streak at **{s}**. The one to beat: {L} days.",
            "**{s} straight days.** {left} more matches your best run.",
          ],
          seed("streak"),
        ),
        { s: s.streak, L: s.longestStreak, left: Math.max(1, s.longestStreak - s.streak) },
      ),
    });
  } else if (s.longestStreak >= 3) {
    out.push({
      kind: "streak",
      weight: 40,
      text: fill(
        pick(
          [
            "Your longest run is **{L} days**. Day one of the next one is available tonight.",
            "You've done **{L} days in a row** before. That version of you is still in there.",
          ],
          seed("streakGone"),
        ),
        { L: s.longestStreak },
      ),
    });
  }

  // 3 · Next juz within reach.
  if (s.nextJuz && s.nextJuz.pagesLeft <= 15) {
    out.push({
      kind: "nextJuz",
      weight: 80,
      text: fill(
        pick(
          [
            "**{n} page{pl}** left in Juz {j}. Close enough to finish this week.",
            "Juz {j} is **{n} page{pl}** from done.",
            "You're **{n} page{pl}** from closing out Juz {j}.",
          ],
          seed("nextJuz"),
        ),
        { n: s.nextJuz.pagesLeft, j: s.nextJuz.juz, pl: s.nextJuz.pagesLeft === 1 ? "" : "s" },
      ),
    });
  }

  // 4 · Best week - celebrate a record in progress, or dangle a close one.
  if (s.bestWeek) {
    if (s.pagesThisWeek > s.bestWeek.pages) {
      out.push({
        kind: "bestWeek",
        weight: 95,
        text: fill(
          pick(
            [
              "**Your best week ever, in progress.** {p} pages; the old record was {b}.",
              "Record broken: **{p} pages** this week, past your previous best of {b}.",
            ],
            seed("bestNow"),
          ),
          { p: s.pagesThisWeek, b: s.bestWeek.pages },
        ),
      });
    } else if (s.bestWeek.pages - s.pagesThisWeek <= 5 && s.pagesThisWeek > 0) {
      out.push({
        kind: "bestWeek",
        weight: 75,
        text: fill(
          pick(
            [
              "Your record week is **{b} pages**. You're {gap} away from it right now.",
              "**{gap} page{pl}** between you and your best week ever ({b}).",
            ],
            seed("bestNear"),
          ),
          (() => {
            const gap = round1(s.bestWeek.pages - s.pagesThisWeek);
            return { b: s.bestWeek.pages, gap, pl: gap === 1 ? "" : "s" };
          })(),
        ),
      });
    } else {
      out.push({
        kind: "bestWeek",
        weight: 30,
        text: fill(
          pick(
            [
              "Your best week so far: **{b} pages**. A target, not a ceiling.",
              "The week to beat: **{b} pages**, your all-time best.",
            ],
            seed("best"),
          ),
          { b: s.bestWeek.pages },
        ),
      });
    }
  }

  // 5 · Weekday pattern.
  if (s.topWeekday) {
    out.push({
      kind: "weekday",
      weight: 50,
      text: fill(
        pick(
          [
            "**{day}s** carry your reading: {pages} pages all-time, more than any other day.",
            "No day works for you like **{day}** ({pages} pages so far).",
            "Your strongest day is **{day}**, with {pct}% of everything you've read.",
          ],
          seed("weekday"),
        ),
        {
          day: WEEKDAY_NAMES[s.topWeekday.day],
          pages: s.topWeekday.pages,
          pct: Math.round(s.topWeekday.share * 100),
        },
      ),
    });
  }

  // 6 · Time-of-day pattern.
  if (s.topTime) {
    out.push({
      kind: "timeOfDay",
      weight: 45,
      text: fill(
        pick(
          [
            "Most of your reading happens **{label}**: {pct}% of your entries.",
            "You're a **{label}** reader: {pct}% of your logging lands there.",
          ],
          seed("timeOfDay"),
        ),
        { label: s.topTime.label, pct: Math.round(s.topTime.share * 100) },
      ),
    });
  }

  // 7 · Consistency.
  {
    const n = s.activeOf14;
    const phrase =
      n >= 11
        ? pick(["rock steady", "a real rhythm now", "the habit is holding you"], seed("cph1"))
        : n >= 7
          ? pick(
              ["a rhythm is forming", "more days on than off", "the shape of a habit"],
              seed("cph2"),
            )
          : n >= 4
            ? pick(["finding your feet", "building back", "a base to grow from"], seed("cph3"))
            : pick(["a fresh start is waiting", "room to begin again"], seed("cph4"));
    out.push({
      kind: "consistency",
      weight: 60,
      text: fill(
        pick(
          [
            "Logged on **{n} of the last 14** days: {phrase}.",
            "**{n} of 14** recent days have an entry: {phrase}.",
          ],
          seed("consistency"),
        ),
        { n, phrase },
      ),
    });
  }

  // 8 · Khatmah ETA (hifz mode only - reading mode has the khatmah card).
  if (includeEta && s.etaDays && s.bookmark) {
    out.push({
      kind: "eta",
      weight: 55,
      text: fill(
        pick(
          [
            "On page **{p}** ({surah}), about **{d} day{dpl}** to the khatmah at your current pace.",
            "At this pace the khatmah lands in about **{d} day{dpl}**. You're on p.{p}, {surah}.",
          ],
          seed("eta"),
        ),
        {
          p: s.bookmark.page,
          surah: s.bookmark.surah,
          d: s.etaDays,
          dpl: s.etaDays === 1 ? "" : "s",
        },
      ),
    });
  }

  // Selection: trend always leads; then the highest-weight lines, with a
  // weekly-rotating tiebreak so mid-weight lines take turns appearing.
  const [lead, ...rest] = [
    out.find((c) => c.kind === "trend")!,
    ...out.filter((c) => c.kind !== "trend"),
  ];
  const jitter = (c: Candidate) => c.weight + (hashSeed(seed("rot:" + c.kind)) % 25);
  rest.sort((a, b) => jitter(b) - jitter(a));
  return [lead, ...rest.slice(0, 3)].map(({ kind, text, delta }) => ({ kind, text, delta }));
}

// ── Advice ──────────────────────────────────────────────────────────────────

/** One practical, personal suggestion - rotates weekly, reacts to patterns. */
export function buildAdvice(s: PersonalSignals, seedBase: string): string {
  const seed = seedBase + ":advice";

  if (s.streak === 0 && s.activeOf14 <= 3) {
    return pick(
      [
        "Start smaller than feels worthwhile: half a page after one salah you never miss. Consistency first, volume later.",
        "Restart with one ayah after Maghrib tonight. The point isn't the amount; it's ending the silence.",
        "Pick your easiest salah and staple one page to it. A tiny anchor beats a big plan.",
      ],
      seed,
    );
  }
  if (s.topTime?.label === "late at night" && s.activeOf14 < 11) {
    return pick(
      [
        "Your reading lives late at night, the first slot to vanish on a tired day. Try moving one page to right after Maghrib and see if the missed days shrink.",
        "Late-night reading is fragile reading. Anchor a page to a salah earlier in the day and the streak stops depending on how sleepy you are.",
      ],
      seed,
    );
  }
  if (s.topWeekday && (s.topWeekday.day === 0 || s.topWeekday.day === 6) && s.activeOf14 < 10) {
    return pick(
      [
        "Most of your pages come on weekends. One small weekday anchor, even half a page after work, would smooth the whole week out.",
        "You read in weekend bursts. Try borrowing just one of those pages for a Tuesday; rhythm beats volume.",
      ],
      seed,
    );
  }
  if (s.streak >= 3) {
    return pick(
      [
        "Streaks die on busy days, not lazy ones. Decide now what your minimum is on a chaotic day; one ayah with attention counts.",
        "Protect the streak with a floor, not a goal: on the worst day, one ayah before bed keeps the thread alive.",
      ],
      seed,
    );
  }
  return pick(
    [
      "Five ayahs after every salah quietly adds up to a khatmah a year.",
      "Keep your mushaf somewhere it can look at you: out of the drawer, onto the desk.",
      "Read along while a reciter plays; it carries you further than pushing through alone.",
      "Tie your reading to a salah you never miss; habits hold better on existing hooks.",
    ],
    seed,
  );
}
