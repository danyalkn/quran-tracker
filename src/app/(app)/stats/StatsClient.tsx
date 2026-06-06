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
import { TrendingUp } from "lucide-react";
import { type Mode } from "@/lib/entries";
import type { LogRow } from "@/lib/types";
import {
  localDate,
  todayLocal,
  currentStreak,
  longestStreak,
  lastNDays,
  shortDate,
  dayLabel,
} from "@/lib/dates";
import { cn } from "@/lib/cn";

type Scope = "mine" | "group";
type Filter = "all" | "sabak" | "revision";

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
    return () => mq.removeEventListener("change", read);
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

export function StatsClient({
  mode,
  tz,
  userId,
  memberCount,
  entries,
}: {
  mode: Mode;
  tz: string;
  userId: string;
  memberCount: number;
  entries: LogRow[];
}) {
  const reading = mode === "reading";
  const [filter, setFilter] = useState<Filter>("all");
  const [scope, setScope] = useState<Scope>("mine");
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
    if (reading || filter === "all") return scoped;
    if (filter === "sabak")
      return scoped.filter((e) => e.entry_type === "sabak");
    return scoped.filter(
      (e) => e.entry_type === "sabak_para" || e.entry_type === "dor",
    );
  }, [scoped, filter, reading]);

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

  // Pages read per day, last 14 days (bar chart).
  const pagesBar = useMemo(() => {
    const days = lastNDays(tz, 14);
    return days.map((d) => ({
      label: new Date(`${d}T12:00:00`).getDate().toString(),
      full: shortDate(d),
      pages: +chartEntries
        .filter((e) => localDate(e.logged_at, tz) === d)
        .reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0)
        .toFixed(2),
    }));
  }, [chartEntries, tz]);
  const totalPages = +pagesBar.reduce((s, b) => s + b.pages, 0).toFixed(1);

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

  // Lifetime (within loaded window) totals for the current scope.
  const totalEntriesAll = scoped.length;
  const totalPagesAll = +scoped
    .reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0)
    .toFixed(1);

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-8">
      <header className="px-5 pt-7 pb-3">
        <h1 className="text-display">Insights</h1>
      </header>

      <div className="space-y-4 px-5">
        {/* All / Sabak / Revision toggle — hifz only */}
        {!reading && (
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
          {reading && (
            <>
              <StatCard
                label="Total entries"
                value={totalEntriesAll}
                sub="logged"
              />
              <StatCard
                label="Total pages"
                value={totalPagesAll}
                sub={`≈ ${Math.round(totalPagesAll / 20)} juz`}
              />
            </>
          )}
          {scope === "mine" ? (
            <>
              <StatCard label="Current streak" value={streak} sub="days" />
              <StatCard label="Longest streak" value={longest} sub="days" />
            </>
          ) : (
            <>
              <StatCard
                label="Logged today"
                value={`${loggedTodayCount}/${memberCount}`}
                sub="members"
              />
              <StatCard label="This week" value={weekCount} sub="entries" />
            </>
          )}
        </div>

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

        {/* Pages read bar */}
        <Card title="Pages read · last 14 days">
          {totalPages === 0 ? (
            <Empty>
              No pages logged in this view. Add an amount when you log to track
              pages.
            </Empty>
          ) : (
            <>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-title2 tabular-nums">{totalPages}</span>
                <span className="text-footnote text-muted">
                  pages · ≈ {Math.round(totalPages / 20)} juz
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

        {/* New vs Revision donut — hifz only */}
        {!reading && (
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
