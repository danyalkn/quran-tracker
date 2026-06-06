"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { bucketOf, type Bucket, type Mode } from "@/lib/entries";
import type { LogRow } from "@/lib/types";
import {
  localDate,
  todayLocal,
  currentStreak,
  longestStreak,
  lastNDays,
  shortDate,
} from "@/lib/dates";
import { cn } from "@/lib/cn";

type Scope = "mine" | "group";

const REVISION_COLOR = "color-mix(in srgb, var(--accent) 32%, var(--surface-2))";

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
  const [bucket, setBucket] = useState<Bucket>("new");
  const [scope, setScope] = useState<Scope>("mine");
  const colors = useChartColors();

  const today = todayLocal(tz);

  const scoped = useMemo(
    () => (scope === "mine" ? entries.filter((e) => e.user_id === userId) : entries),
    [entries, scope, userId],
  );
  const bucketed = useMemo(
    () => scoped.filter((e) => bucketOf(e.entry_type) === bucket),
    [scoped, bucket],
  );

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

  // Bar: entries per day, last 14 days.
  const barData = useMemo(() => {
    const days = lastNDays(tz, 14);
    return days.map((d) => ({
      label: new Date(`${d}T12:00:00`).getDate().toString(),
      full: shortDate(d),
      count: bucketed.filter((e) => localDate(e.logged_at, tz) === d).length,
    }));
  }, [bucketed, tz]);

  // Line: cumulative pages, last 30 days.
  const { lineData, totalPages } = useMemo(() => {
    const days = lastNDays(tz, 30);
    let cum = 0;
    const data = days.map((d) => {
      const pages = bucketed
        .filter((e) => localDate(e.logged_at, tz) === d)
        .reduce((s, e) => s + (e.pages_equiv ? +e.pages_equiv : 0), 0);
      cum += pages;
      return { full: shortDate(d), cum: +cum.toFixed(1) };
    });
    return { lineData: data, totalPages: +cum.toFixed(1) };
  }, [bucketed, tz]);

  // Donut: New vs Revision across the scope.
  const newCount = scoped.filter((e) => bucketOf(e.entry_type) === "new").length;
  const revCount = scoped.filter(
    (e) => bucketOf(e.entry_type) === "revision",
  ).length;
  const pieData = [
    { name: "New", value: newCount },
    { name: "Revision", value: revCount },
  ];
  const pieTotal = newCount + revCount;

  // Heatmap: entries per day, last 35 days.
  const heat = useMemo(() => {
    const days = lastNDays(tz, 35);
    const counts = days.map(
      (d) => scoped.filter((e) => localDate(e.logged_at, tz) === d).length,
    );
    const max = Math.max(1, ...counts);
    return counts.map((c) => (c === 0 ? 0 : 0.25 + 0.75 * (c / max)));
  }, [scoped, tz]);

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

  const bucketSegments =
    mode === "hifz"
      ? [
          { v: "new" as Bucket, label: "New (Sabak)" },
          { v: "revision" as Bucket, label: "Revision" },
        ]
      : [
          { v: "new" as Bucket, label: "Reading" },
          { v: "revision" as Bucket, label: "Revising" },
        ];

  return (
    <div className="flex h-full flex-col overflow-y-auto pb-8">
      <header className="px-5 pt-7 pb-3">
        <h1 className="text-display">Insights</h1>
      </header>

      <div className="space-y-4 px-5">
        {/* Toggles */}
        <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
          {bucketSegments.map((s) => (
            <button
              key={s.v}
              onClick={() => setBucket(s.v)}
              className={cn(
                "flex-1 rounded-lg py-1.5 font-medium transition-colors",
                bucket === s.v
                  ? "bg-surface text-foreground shadow-e1"
                  : "text-muted",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-footnote text-faint">
            {bucket === "new" ? "New" : "Revision"} ·{" "}
            {scope === "mine" ? "your" : "group"} activity
          </p>
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-caption font-medium">
            {(["mine", "group"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "rounded-md px-2.5 py-1 capitalize transition-colors",
                  scope === s ? "bg-surface text-foreground shadow-e1" : "text-muted",
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

        {/* Entries over time */}
        <Card title="Entries · last 14 days">
          {bucketed.length === 0 ? (
            <Empty>No {bucket === "new" ? "new" : "revision"} entries yet.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid vertical={false} stroke={colors.grid} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: colors.tick, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={1}
                />
                <YAxis
                  allowDecimals={false}
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
                      suffix="entries"
                    />
                  )}
                />
                <Bar dataKey="count" isAnimationActive={false} fill={colors.accent} radius={[6, 6, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Cumulative pages */}
        <Card title="Pages over time · last 30 days">
          {totalPages === 0 ? (
            <Empty>
              No pages logged in this view. Add an amount when you log to track
              pages.
            </Empty>
          ) : (
            <>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-title2 tabular-nums">{totalPages}</span>
                <span className="text-footnote text-muted">pages · ≈ {Math.round(totalPages / 20)} juz</span>
              </div>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={lineData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid vertical={false} stroke={colors.grid} />
                  <XAxis dataKey="full" hide />
                  <YAxis
                    tick={{ fill: colors.tick, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                  />
                  <Tooltip
                    content={({ active, payload }) => (
                      <TooltipCard
                        active={active}
                        label={payload?.[0]?.payload?.full}
                        value={payload?.[0]?.value as number}
                        suffix="pages"
                      />
                    )}
                  />
                  <Line
                    type="monotone"
                    dataKey="cum"
                    isAnimationActive={false}
                    stroke={colors.accent}
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>

        {/* By type donut */}
        <Card title="New vs Revision">
          {pieTotal === 0 ? (
            <Empty>Nothing logged yet.</Empty>
          ) : (
            <div className="flex items-center gap-5">
              <ResponsiveContainer width={120} height={120}>
                <PieChart>
                  <Pie
                    data={pieData}
                    isAnimationActive={false}
                    dataKey="value"
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
                <Legend color="var(--accent)" label="New" value={newCount} total={pieTotal} />
                <Legend color={REVISION_COLOR} label="Revision" value={revCount} total={pieTotal} />
              </div>
            </div>
          )}
        </Card>

        {/* Heatmap */}
        <Card title="Consistency · last 5 weeks">
          <div className="grid grid-cols-7 gap-1.5">
            {heat.map((op, i) => (
              <div
                key={i}
                className={cn("h-6 rounded-md", op === 0 ? "bg-surface-2" : "bg-accent")}
                style={op === 0 ? undefined : { opacity: op }}
              />
            ))}
          </div>
        </Card>
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
  label,
  value,
  total,
}: {
  color: string;
  label: string;
  value: number;
  total: number;
}) {
  const pct = Math.round((value / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <span
        className="size-2.5 rounded-full"
        style={{ background: color }}
      />
      <span className="text-muted">{label}</span>
      <span className="ml-auto tabular-nums text-faint">{pct}%</span>
    </div>
  );
}
