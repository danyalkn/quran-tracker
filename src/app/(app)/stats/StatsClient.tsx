"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Users,
  BookMarked,
  Hourglass,
  Flag,
  CalendarCheck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { type Mode } from "@/lib/entries";
import { totalPages, pageFromRef } from "@/lib/mushaf";
import type { GroupMember, LogRow, ReadingRow } from "@/lib/types";
import {
  localDate,
  todayLocal,
  currentStreak,
  longestStreak,
  lastNDays,
  lastNDaysEndingOn,
  shortDate,
  dayLabel,
} from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";

type Scope = "mine" | "group";
type Filter = "all" | "sabak" | "revision";

// The group khatmah is measured against the standard Uthmani mushaf.
const KHATMAH_PAGES = totalPages("uthmani15"); // 604

/** Recharts paints via SVG attributes, which don't resolve CSS variables — so
 *  read the resolved token values and re-read when the color scheme flips. */
function useChartColors() {
  const [c, setC] = useState({
    accent: "#1b6b53",
    grid: "#e7e2d8",
    tick: "#9a958c",
    surface2: "#f3f0e9",
  });
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const g = (n: string, f: string) => s.getPropertyValue(n).trim() || f;
      setC({
        accent: g("--accent", "#1b6b53"),
        grid: g("--border", "#e7e2d8"),
        tick: g("--faint", "#9a958c"),
        surface2: g("--surface-2", "#f3f0e9"),
      });
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      mq.removeEventListener("change", read);
      obs.disconnect();
    };
  }, []);
  return c;
}

function TooltipCard({
  active,
  label,
  value,
  suffix,
}: {
  active?: boolean;
  label?: string;
  value?: number | string;
  suffix?: string;
}) {
  if (!active) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-e2">
      <p className="text-caption text-faint">{label}</p>
      <p className="text-subhead font-semibold tabular-nums">
        {value}
        {suffix ? ` ${suffix}` : ""}
      </p>
    </div>
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const pagesOf = (rows: { pages_equiv: number | null }[]) =>
  +rows.reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0).toFixed(1);

export function StatsClient({
  mode,
  tz,
  userId,
  members,
  entries,
  readingAll,
  initialScope = "mine",
}: {
  mode: Mode;
  tz: string;
  userId: string;
  members: GroupMember[];
  entries: LogRow[];
  readingAll: ReadingRow[];
  initialScope?: Scope;
}) {
  const reading = mode === "reading";
  const memberCount = members.length;
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>(initialScope);
  const colors = useChartColors();

  const today = todayLocal(tz);

  const scoped = useMemo(
    () =>
      scope === "mine" ? entries.filter((e) => e.user_id === userId) : entries,
    [entries, scope, userId],
  );
  // Readers have one category. Memorizers filter by All / Sabak / Revision —
  // reading entries only appear under All (never counted as "new memorization").
  const chartEntries = useMemo(() => {
    // The Sabak/Revision filter only exists in personal hifz view; never let a
    // stale value silently filter the group heatmap.
    if (reading || scope === "group" || filter === "all") return scoped;
    if (filter === "sabak")
      return scoped.filter((e) => e.entry_type === "sabak");
    return scoped.filter(
      (e) => e.entry_type === "sabak_para" || e.entry_type === "dor",
    );
  }, [scoped, filter, reading, scope]);

  // Streak from the user's own entries.
  const mineDays = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => e.user_id === userId)
          .map((e) => localDate(e.logged_at, tz)),
      ),
    [entries, userId, tz],
  );
  const streak = currentStreak(mineDays, tz);
  const longest = longestStreak(mineDays);

  // Heatmap: entries per day, last 5 weeks, aligned to weekday columns.
  const heatGrid = useMemo(() => {
    const days = lastNDays(tz, 35);
    const count = (d: string) =>
      chartEntries.filter((e) => localDate(e.logged_at, tz) === d).length;
    const counts = days.map(count);
    const max = Math.max(1, ...counts);
    const lead = new Date(`${days[0]}T12:00:00`).getDay();
    type Cell = { date: string; count: number; op: number } | null;
    const cells: Cell[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    days.forEach((d, i) => {
      const c = counts[i];
      cells.push({ date: d, count: c, op: c === 0 ? 0 : 0.3 + 0.7 * (c / max) });
    });
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [chartEntries, tz]);
  const [activeCell, setActiveCell] = useState<number | null>(null);

  // Pages read per day, last 14 days (mine scope).
  const pagesBar = useMemo(() => {
    const days = lastNDays(tz, 14);
    return days.map((d) => ({
      label: new Date(`${d}T12:00:00`).getDate().toString(),
      full: shortDate(d),
      pages: pagesOf(
        chartEntries.filter((e) => localDate(e.logged_at, tz) === d),
      ),
    }));
  }, [chartEntries, tz]);
  const totalPages14 = +pagesBar.reduce((s, b) => s + b.pages, 0).toFixed(1);

  // Weekly trend: pages per rolling 7-day bucket, last 8 weeks (mine scope).
  const weeklyBar = useMemo(() => {
    const days = lastNDays(tz, 56);
    const byDay = new Map<string, number>();
    for (const e of chartEntries) {
      const d = localDate(e.logged_at, tz);
      byDay.set(d, (byDay.get(d) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0));
    }
    const out: { label: string; full: string; pages: number }[] = [];
    for (let w = 0; w < 8; w++) {
      const chunk = days.slice(w * 7, w * 7 + 7);
      const pages = +chunk
        .reduce((s, d) => s + (byDay.get(d) ?? 0), 0)
        .toFixed(1);
      out.push({
        label: shortDate(chunk[0]),
        full: `${shortDate(chunk[0])} – ${shortDate(chunk[6])}`,
        pages,
      });
    }
    return out;
  }, [chartEntries, tz]);
  const weeklyTotal = +weeklyBar.reduce((s, w) => s + w.pages, 0).toFixed(1);

  // Donut (hifz only): Sabak vs Revision (memorization only — excludes reading).
  const sabakCount = scoped.filter((e) => e.entry_type === "sabak").length;
  const revCount = scoped.filter(
    (e) => e.entry_type === "sabak_para" || e.entry_type === "dor",
  ).length;
  const pieTotal = sabakCount + revCount;

  const loggedTodayCount = useMemo(
    () =>
      new Set(
        entries
          .filter((e) => localDate(e.logged_at, tz) === today)
          .map((e) => e.user_id),
      ).size,
    [entries, tz, today],
  );
  const weekCount = useMemo(() => {
    const days = new Set(lastNDays(tz, 7));
    return scoped.filter((e) => days.has(localDate(e.logged_at, tz))).length;
  }, [scoped, tz]);

  const totalEntries = chartEntries.length;

  // ── Group khatmah (all-time, every entry type) ──────────────────────────
  // pages_equiv already converts juz/quarter/hizb → pages; page amounts are
  // raw pages; ayah-only entries contribute nothing.
  const groupRead = pagesOf(readingAll);
  const khatmahs = Math.floor(groupRead / KHATMAH_PAGES);
  const khatmahProgress = +(groupRead - khatmahs * KHATMAH_PAGES).toFixed(1);
  const khatmahPct = Math.min(100, (khatmahProgress / KHATMAH_PAGES) * 100);

  // ── All-time & calendar-month totals (true all-time: readingAll has no
  // date window, unlike `entries` which is capped at 180 days) ─────────────
  const totals = useMemo(() => {
    const thisM = today.slice(0, 7);
    const firstOfMonth = new Date(`${thisM}-01T12:00:00`);
    firstOfMonth.setMonth(firstOfMonth.getMonth() - 1);
    const lastM = firstOfMonth.toLocaleDateString("en-CA").slice(0, 7);

    const per = new Map<string, { all: number; month: number; lastMonth: number }>();
    let groupMonth = 0;
    let groupLastMonth = 0;
    for (const r of readingAll) {
      const p = r.pages_equiv ? +r.pages_equiv : 0;
      if (!p) continue;
      const rec = per.get(r.user_id) ?? { all: 0, month: 0, lastMonth: 0 };
      rec.all += p;
      const key = localDate(r.logged_at, tz).slice(0, 7);
      if (key === thisM) {
        rec.month += p;
        groupMonth += p;
      } else if (key === lastM) {
        rec.lastMonth += p;
        groupLastMonth += p;
      }
      per.set(r.user_id, rec);
    }

    const board = members
      .map((m) => {
        const rec = per.get(m.user_id);
        return {
          member: m,
          all: +(rec?.all ?? 0).toFixed(1),
          month: +(rec?.month ?? 0).toFixed(1),
        };
      })
      .sort((a, b) => b.month - a.month || b.all - a.all);

    const mine = per.get(userId);
    return {
      board,
      maxMonth: Math.max(1, ...board.map((b) => b.month)),
      myAll: +(mine?.all ?? 0).toFixed(1),
      myMonth: +(mine?.month ?? 0).toFixed(1),
      myLastMonth: +(mine?.lastMonth ?? 0).toFixed(1),
      groupMonth: +groupMonth.toFixed(1),
      groupLastMonth: +groupLastMonth.toFixed(1),
    };
  }, [readingAll, members, userId, tz, today]);

  const monthName = new Date(`${today.slice(0, 7)}-01T12:00:00`).toLocaleDateString(
    "en-GB",
    { month: "long" },
  );

  // ── Personal khatmah — bookmark position from the latest reading entry ──
  const myKhatmah = useMemo(() => {
    if (!reading) return null;
    const mine = entries.filter((e) => e.user_id === userId);
    const lastRead = mine.find(
      (e) =>
        (e.entry_type === "reading" || e.entry_type === "revising") && e.to_ref,
    );
    const page = pageFromRef(lastRead?.to_ref);
    if (!lastRead || !page) return null;
    const total = totalPages(lastRead.mushaf ?? "uthmani15");
    const last14 = new Set(lastNDaysEndingOn(today, 14));
    const pace =
      pagesOf(
        mine.filter(
          (e) =>
            (e.entry_type === "reading" || e.entry_type === "revising") &&
            last14.has(localDate(e.logged_at, tz)),
        ),
      ) / 14;
    const left = total - page;
    return {
      page,
      total,
      pct: Math.min(100, (page / total) * 100),
      etaDays: pace > 0 && left > 0 ? Math.ceil(left / pace) : null,
    };
  }, [reading, entries, userId, tz, today]);

  // ── Insights ──────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const week = new Set(lastNDays(tz, 7));
    const prevWeek = new Set(lastNDays(tz, 14).slice(0, 7));
    const out: {
      icon: LucideIcon;
      text: React.ReactNode;
      delta?: number | null;
    }[] = [];

    const pagesIn = (rows: LogRow[], days: Set<string>) =>
      pagesOf(rows.filter((e) => days.has(localDate(e.logged_at, tz))));

    if (scope === "mine") {
      const minRows = entries.filter((e) => e.user_id === userId);
      const thisW = pagesIn(minRows, week);
      const lastW = pagesIn(minRows, prevWeek);
      out.push({
        icon: thisW >= lastW ? TrendingUp : TrendingDown,
        text: (
          <>
            <b>{thisW}</b> pages this week{" "}
            <span className="text-faint">· {lastW} last week</span>
          </>
        ),
        delta: lastW > 0 ? (thisW - lastW) / lastW : thisW > 0 ? 1 : null,
      });

      const active14 = lastNDays(tz, 14).filter((d) => mineDays.has(d)).length;
      out.push({
        icon: CalendarCheck,
        text: (
          <>
            Logged on <b>{active14}</b> of the last 14 days
          </>
        ),
      });

      // Most revised juz (structured logging).
      const revRows = minRows.filter(
        (e) =>
          (e.entry_type === "sabak_para" || e.entry_type === "dor") &&
          e.juz != null,
      );
      if (revRows.length > 0) {
        const byJuz = new Map<number, number>();
        for (const e of revRows) byJuz.set(e.juz!, (byJuz.get(e.juz!) ?? 0) + 1);
        const [topJuz, topN] = [...byJuz.entries()].sort(
          (a, b) => b[1] - a[1],
        )[0];
        out.push({
          icon: BookMarked,
          text: (
            <>
              Most revised: <b>Juz {topJuz}</b>{" "}
              <span className="text-faint">· {topN}×</span>
            </>
          ),
        });

        // Longest-untouched juz you do revise.
        if (byJuz.size > 1) {
          const lastSeen = new Map<number, string>();
          for (const e of revRows) {
            const d = localDate(e.logged_at, tz);
            const cur = lastSeen.get(e.juz!);
            if (!cur || d > cur) lastSeen.set(e.juz!, d);
          }
          const [staleJuz, staleDate] = [...lastSeen.entries()].sort((a, b) =>
            a[1] < b[1] ? -1 : 1,
          )[0];
          const staleDays = Math.floor(
            (new Date(`${today}T12:00:00`).getTime() -
              new Date(`${staleDate}T12:00:00`).getTime()) /
              86400000,
          );
          if (staleDays >= 10) {
            out.push({
              icon: Hourglass,
              text: (
                <>
                  <b>Juz {staleJuz}</b> hasn’t been revised in{" "}
                  <b>{staleDays}</b> days
                </>
              ),
            });
          }
        }
      }

      // Reading pace → khatmah ETA from the latest bookmark.
      const lastRead = minRows.find(
        (e) =>
          (e.entry_type === "reading" || e.entry_type === "revising") &&
          e.to_ref,
      );
      const page = pageFromRef(lastRead?.to_ref);
      // Reading mode gets the richer "Your khatmah" card instead.
      if (!reading && lastRead && page) {
        const total = totalPages(lastRead.mushaf ?? "uthmani15");
        const last14 = new Set(lastNDays(tz, 14));
        const pace =
          pagesIn(
            minRows.filter(
              (e) =>
                e.entry_type === "reading" || e.entry_type === "revising",
            ),
            last14,
          ) / 14;
        const left = total - page;
        if (pace > 0 && left > 0) {
          out.push({
            icon: Flag,
            text: (
              <>
                On page <b>{page}</b> — about <b>{Math.ceil(left / pace)}</b>{" "}
                days to finish at your pace
              </>
            ),
          });
        }
      }
    } else {
      const activeMembers = new Set(
        entries
          .filter((e) => week.has(localDate(e.logged_at, tz)))
          .map((e) => e.user_id),
      ).size;
      out.push({
        icon: Users,
        text: (
          <>
            <b>{activeMembers}</b> of <b>{memberCount}</b> logged this week
          </>
        ),
      });

      const thisW = pagesIn(entries, week);
      const lastW = pagesIn(entries, prevWeek);
      out.push({
        icon: thisW >= lastW ? TrendingUp : TrendingDown,
        text: (
          <>
            <b>{thisW}</b> group pages this week{" "}
            <span className="text-faint">· {lastW} last week</span>
          </>
        ),
        delta: lastW > 0 ? (thisW - lastW) / lastW : thisW > 0 ? 1 : null,
      });

      // Top contributor this week.
      const byUser = new Map<string, number>();
      for (const e of entries) {
        if (!week.has(localDate(e.logged_at, tz))) continue;
        byUser.set(
          e.user_id,
          (byUser.get(e.user_id) ?? 0) + (e.pages_equiv ? +e.pages_equiv : 0),
        );
      }
      const top = [...byUser.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) {
        const name =
          top[0] === userId
            ? "You"
            : (members.find((m) => m.user_id === top[0])?.display_name ??
              "Someone");
        out.push({
          icon: Trophy,
          text: (
            <>
              Most pages this week: <b>{name}</b>{" "}
              <span className="text-faint">· {+top[1].toFixed(1)} pages</span>
            </>
          ),
        });
      }
    }
    return out;
  }, [scope, entries, userId, tz, today, mineDays, members, memberCount, reading]);

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-8">
      <header className="px-5 pt-7 pb-3">
        <h1 className="text-display">Insights</h1>
      </header>

      <div className="space-y-4 px-5">
        {/* All / Sabak / Revision toggle — hifz, personal scope only */}
        {!reading && scope === "mine" && (
          <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
            {(
              [
                { v: "all", label: "All" },
                { v: "sabak", label: "Sabak" },
                { v: "revision", label: "Revision" },
              ] as { v: Filter; label: string }[]
            ).map((s) => (
              <button
                key={s.v}
                onClick={() => setFilter(s.v)}
                className={cn(
                  "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                  filter === s.v
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-footnote text-faint">
            {scope === "mine" ? "Your" : "Group"} activity
          </p>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-caption font-medium">
            {(["mine", "group"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize transition-colors",
                  scope === s
                    ? "bg-surface text-foreground shadow-e1"
                    : "text-muted",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3">
          {scope === "mine" ? (
            <>
              <StatCard
                label="All-time pages"
                value={totals.myAll}
                sub={`≈ ${Math.round(totals.myAll / 20)} juz`}
              />
              <StatCard
                label={monthName}
                value={totals.myMonth}
                sub={`${totals.myLastMonth} last month`}
              />
              <StatCard label="Current streak" value={streak} sub="days" />
              <StatCard label="Longest streak" value={longest} sub="days" />
            </>
          ) : (
            <>
              <StatCard
                label="All-time pages"
                value={groupRead}
                sub={`≈ ${Math.round(groupRead / 20)} juz together`}
              />
              <StatCard
                label={monthName}
                value={totals.groupMonth}
                sub={`${totals.groupLastMonth} last month`}
              />
              <StatCard
                label="Logged today"
                value={`${loggedTodayCount}/${memberCount}`}
                sub="members"
              />
              <StatCard label="This week" value={weekCount} sub="entries" />
            </>
          )}
        </div>

        {/* ── MINE: personal khatmah progress from the bookmark ── */}
        {scope === "mine" && myKhatmah && (
          <div className="rounded-2xl bg-surface p-4 shadow-e1">
            <div className="flex items-start justify-between">
              <p className="text-callout font-semibold">Your khatmah</p>
              <span className="text-caption tabular-nums text-faint">
                page {myKhatmah.page} of {myKhatmah.total}
              </span>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-700"
                style={{ width: `${myKhatmah.pct}%` }}
              />
            </div>
            <p className="mt-1.5 text-footnote text-faint">
              {Math.round(myKhatmah.pct)}% of the way through
              {myKhatmah.etaDays
                ? ` · ≈ ${myKhatmah.etaDays} days to finish at your pace`
                : ""}
            </p>
          </div>
        )}

        {/* ── GROUP: khatmah tracker ── */}
        {scope === "group" && (
          <div className="rounded-2xl bg-surface p-4 shadow-e1">
            <div className="flex items-start justify-between">
              <p className="text-callout font-semibold">Group khatmah</p>
              <span className="text-caption text-faint">
                Uthmani · {KHATMAH_PAGES} pages
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-display tabular-nums">{groupRead}</span>
              <span className="text-callout text-muted">pages read together</span>
              <span className="text-footnote text-faint">
                ≈ {Math.round(groupRead / 20)} juz
              </span>
            </div>

            {/* Progress to the next completion */}
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-footnote">
                <span className="font-medium text-muted">
                  Khatmah #{khatmahs + 1}
                </span>
                <span className="tabular-nums text-faint">
                  {khatmahProgress} / {KHATMAH_PAGES}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-700"
                  style={{ width: `${khatmahPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-footnote text-faint">
                {+(KHATMAH_PAGES - khatmahProgress).toFixed(1)} pages to go
              </p>
            </div>

            {khatmahs > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-accent-tint px-3 py-2.5 text-accent">
                <UtensilsCrossed className="size-4 shrink-0" />
                <p className="text-footnote font-medium">
                  {khatmahs} {khatmahs === 1 ? "khatmah" : "khatmahs"} completed
                  — {khatmahs === 1 ? "a dawat is" : `${khatmahs} dawats are`}{" "}
                  owed 🎉
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── GROUP: leaderboard — this month + all time per member ── */}
        {scope === "group" && (
          <Card title={`Leaderboard · ${monthName}`}>
            <div className="space-y-3">
              {totals.board.map((row, i) => (
                <div key={row.member.user_id} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-center text-footnote tabular-nums text-faint">
                    {i + 1}
                  </span>
                  <Avatar
                    name={row.member.display_name}
                    src={row.member.avatar_url}
                    size={32}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-subhead font-medium">
                        {row.member.user_id === userId
                          ? "You"
                          : row.member.display_name}
                        {i === 0 && row.month > 0 && (
                          <Trophy className="mb-0.5 ml-1.5 inline size-3.5 text-accent" />
                        )}
                      </p>
                      <p className="shrink-0 text-subhead font-semibold tabular-nums">
                        {row.month}
                        <span className="ml-1 font-normal text-faint">
                          · {row.all} all time
                        </span>
                      </p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-500"
                        style={{ width: `${(row.month / totals.maxMonth) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-caption text-faint">
              Pages this month · every entry type counts
            </p>
          </Card>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <Card title="Trends & insights">
            <div className="space-y-3">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted">
                    <ins.icon className="size-4.5" />
                  </span>
                  <p className="min-w-0 flex-1 text-subhead text-foreground [&_b]:font-semibold">
                    {ins.text}
                  </p>
                  {ins.delta != null && <DeltaBadge value={ins.delta} />}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── GROUP: pages per day ── */}
        {scope === "group" && (
          <Card title="Group pages · last 14 days">
            {totalPages14 === 0 ? (
              <Empty>
                No pages logged yet. Every entry — reading, sabak, sabak para,
                and dhor — counts toward the group khatmah.
              </Empty>
            ) : (
              <>
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-title2 tabular-nums">
                    {totalPages14}
                  </span>
                  <span className="text-footnote text-muted">
                    pages · ≈ {Math.round(totalPages14 / 20)} juz
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart
                    data={pagesBar}
                    margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                  >
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: colors.tick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fill: colors.tick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip
                      cursor={{ fill: colors.surface2 }}
                      content={({ active, payload }) => (
                        <TooltipCard
                          active={active}
                          label={payload?.[0]?.payload?.full}
                          value={payload?.[0]?.value as number}
                          suffix="pages"
                        />
                      )}
                    />
                    <Bar
                      dataKey="pages"
                      isAnimationActive={false}
                      fill={colors.accent}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </Card>
        )}

        {/* Entries heatmap */}
        <Card title="Entries · last 5 weeks">
          {totalEntries === 0 ? (
            <Empty>No entries in this view yet.</Empty>
          ) : (
            <>
              <div className="mb-2 grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((w, i) => (
                  <span key={i} className="text-center text-caption text-faint">
                    {w}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {heatGrid.map((cell, i) =>
                  cell === null ? (
                    <div key={i} className="aspect-square" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      onClick={() =>
                        setActiveCell((v) => (v === i ? null : i))
                      }
                      className="group relative aspect-square"
                    >
                      <span
                        className={cn(
                          "block size-full rounded-md",
                          cell.op === 0 ? "bg-surface-2" : "bg-accent",
                        )}
                        style={cell.op === 0 ? undefined : { opacity: cell.op }}
                      />
                      <span
                        className={cn(
                          "pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-caption shadow-e2 opacity-0 transition-opacity group-hover:opacity-100",
                          activeCell === i && "opacity-100",
                        )}
                      >
                        <span className="font-semibold tabular-nums">
                          {cell.count}
                        </span>{" "}
                        {cell.count === 1 ? "entry" : "entries"}
                        <span className="text-faint"> · {dayLabel(cell.date)}</span>
                      </span>
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </Card>

        {/* ── MINE: daily pages + weekly trend ── */}
        {scope === "mine" && (
          <>
            <Card title="Pages read · last 14 days">
              {totalPages14 === 0 ? (
                <Empty>
                  No pages logged in this view. Add an amount when you log to
                  track pages.
                </Empty>
              ) : (
                <>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-title2 tabular-nums">
                      {totalPages14}
                    </span>
                    <span className="text-footnote text-muted">
                      pages · ≈ {Math.round(totalPages14 / 20)} juz
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart
                      data={pagesBar}
                      margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                    >
                      <CartesianGrid vertical={false} stroke={colors.grid} />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: colors.tick, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        interval={1}
                      />
                      <YAxis
                        tick={{ fill: colors.tick, fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={32}
                      />
                      <Tooltip
                        cursor={{ fill: colors.surface2 }}
                        content={({ active, payload }) => (
                          <TooltipCard
                            active={active}
                            label={payload?.[0]?.payload?.full}
                            value={payload?.[0]?.value as number}
                            suffix="pages"
                          />
                        )}
                      />
                      <Bar
                        dataKey="pages"
                        isAnimationActive={false}
                        fill={colors.accent}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={18}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </Card>

            <Card title="Weekly pages · last 8 weeks">
              {weeklyTotal === 0 ? (
                <Empty>Log a few weeks of pages to see your trend here.</Empty>
              ) : (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart
                    data={weeklyBar}
                    margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                  >
                    <CartesianGrid vertical={false} stroke={colors.grid} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: colors.tick, fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval={1}
                    />
                    <YAxis
                      tick={{ fill: colors.tick, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip
                      cursor={{ fill: colors.surface2 }}
                      content={({ active, payload }) => (
                        <TooltipCard
                          active={active}
                          label={payload?.[0]?.payload?.full}
                          value={payload?.[0]?.value as number}
                          suffix="pages"
                        />
                      )}
                    />
                    <Bar
                      dataKey="pages"
                      isAnimationActive={false}
                      fill={colors.accent}
                      radius={[6, 6, 0, 0]}
                      maxBarSize={26}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </>
        )}

        {/* New vs Revision donut — hifz, personal scope */}
        {!reading && scope === "mine" && (
          <Card title="Sabak vs Revision">
            {pieTotal === 0 ? (
              <Empty>No memorization logged yet.</Empty>
            ) : (
              <div className="flex items-center gap-5">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Sabak", value: sabakCount },
                        { name: "Revision", value: revCount },
                      ]}
                      dataKey="value"
                      isAnimationActive={false}
                      innerRadius={34}
                      outerRadius={56}
                      paddingAngle={2}
                      stroke="none"
                    >
                      <Cell fill={colors.accent} />
                      <Cell fill={colors.accent} fillOpacity={0.32} />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 text-footnote">
                  <Legend
                    color={colors.accent}
                    label="Sabak"
                    value={sabakCount}
                    total={pieTotal}
                  />
                  <Legend
                    color={colors.accent}
                    faded
                    label="Revision"
                    value={revCount}
                    total={pieTotal}
                  />
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

/** ▲ 12% / ▼ 8% / — steady. Icon + number together, never color alone. */
function DeltaBadge({ value }: { value: number }) {
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-caption font-medium text-muted">
        <Minus className="size-3" /> steady
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums",
        up ? "bg-accent-tint text-accent" : "bg-danger-tint text-danger",
      )}
    >
      {up ? (
        <TrendingUp className="size-3" />
      ) : (
        <TrendingDown className="size-3" />
      )}
      {pct > 999 ? ">999" : pct}%
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="text-footnote font-medium text-muted">{label}</p>
      <p className="mt-2 text-title1 tabular-nums">{value}</p>
      <p className="text-footnote text-faint">{sub}</p>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="mb-3 text-callout font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <TrendingUp className="size-6 text-faint" />
      <p className="max-w-[15rem] text-footnote text-muted">{children}</p>
    </div>
  );
}

function Legend({
  color,
  faded,
  label,
  value,
  total,
}: {
  color: string;
  faded?: boolean;
  label: string;
  value: number;
  total: number;
}) {
  const pct = Math.round((value / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2.5 rounded-full"
        style={{ background: color, opacity: faded ? 0.32 : 1 }}
      />
      <span className="text-muted">{label}</span>
      <span className="ml-auto tabular-nums text-faint">{pct}%</span>
    </div>
  );
}
