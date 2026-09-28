"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ENTRY_META } from "@/lib/entries";
import {
  addWeeks,
  localDate,
  shortDate,
  startOfWeek,
  weekDatesUpTo,
  weekRangeLabel,
} from "@/lib/dates";
import { describeEntry } from "@/lib/format";
import type { LogRow } from "@/lib/types";
import { useChartColors, type ChartColors } from "./chartKit";

type HifzType = "sabak" | "sabak_para" | "dor";
/** Stack order, bottom → top: newest material at the base. */
const TYPES: HifzType[] = ["sabak", "sabak_para", "dor"];
const WEEKS = 8;

const SHORT_DESC: Record<HifzType, string> = {
  sabak: "New lesson",
  sabak_para: "Recent revision",
  dor: "Old revision",
};

const colorOf = (c: ChartColors, t: HifzType) =>
  t === "sabak" ? c.chart1 : t === "sabak_para" ? c.chart2 : c.chart3;
// Legend swatches are HTML, so they can read the tokens directly (no flash).
const CSS_VAR: Record<HifzType, string> = {
  sabak: "var(--chart-1)",
  sabak_para: "var(--chart-2)",
  dor: "var(--chart-3)",
};

type Week = { label: string; full: string } & Record<HifzType, number>;

const r1 = (n: number) => +n.toFixed(2);

/** "today" / "yesterday" / "5 days ago" / "12 Jul". */
function ago(ymd: string, today: string): string {
  const days = Math.round(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${ymd}T12:00:00`).getTime()) /
      86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return shortDate(ymd);
}

/**
 * Sabak, Sabak Para and Dhor side by side: pages per calendar week, stacked
 * by type, plus what each one last covered. Replaces the old entry-count
 * donut, which lumped both revision types together and counted a full juz
 * of Dhor the same as a quarter page of Sabak.
 */
export function HifzBreakdownCard({
  rows,
  tz,
  today,
}: {
  /** The signed-in user's entries, all time. */
  rows: LogRow[];
  tz: string;
  today: string;
}) {
  const colors = useChartColors();

  const { weeks, totals, latest, any } = useMemo(() => {
    const firstMonday = addWeeks(today, -(WEEKS - 1));
    const weeks: Week[] = [];
    const index = new Map<string, Week>();
    for (let w = WEEKS - 1; w >= 0; w--) {
      const monday = addWeeks(today, -w);
      const dates = weekDatesUpTo(monday, today);
      const range = weekRangeLabel(monday, dates[dates.length - 1]);
      const week: Week = {
        label: shortDate(monday),
        full: dates.length < 7 ? `${range} · so far` : range,
        sabak: 0,
        sabak_para: 0,
        dor: 0,
      };
      weeks.push(week);
      index.set(monday, week);
    }
    const totals: Record<HifzType, number> = { sabak: 0, sabak_para: 0, dor: 0 };
    const latest: Partial<Record<HifzType, LogRow>> = {};
    for (const r of rows) {
      if (!TYPES.includes(r.entry_type as HifzType)) continue;
      const t = r.entry_type as HifzType;
      const prev = latest[t];
      if (!prev || new Date(r.logged_at) > new Date(prev.logged_at)) latest[t] = r;
      const date = localDate(r.logged_at, tz);
      const monday = startOfWeek(date);
      if (monday < firstMonday) continue;
      const week = index.get(monday);
      if (!week) continue;
      const pages = r.pages_equiv ? +r.pages_equiv : 0;
      week[t] = r1(week[t] + pages);
      totals[t] = r1(totals[t] + pages);
    }
    const any = TYPES.some((t) => totals[t] > 0);
    return { weeks, totals, latest, any };
  }, [rows, tz, today]);

  // Only the top-most filled segment of each column gets the rounded end.
  const topOf = (w: Week): HifzType | null =>
    [...TYPES].reverse().find((t) => w[t] > 0) ?? null;

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-e1">
      <p className="text-callout font-semibold">Sabak, Sabak Para & Dhor</p>
      <p className="text-caption text-faint">Pages per week · last {WEEKS} weeks</p>

      {any ? (
        <div className="mt-3 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis
                dataKey="label"
                tick={{ fill: colors.tick, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval={1}
              />
              <YAxis
                tick={{ fill: colors.tick, fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: colors.surface2 }}
                content={({ active, payload }) => {
                  const w = payload?.[0]?.payload as Week | undefined;
                  if (!active || !w) return null;
                  const sum = r1(TYPES.reduce((s, t) => s + w[t], 0));
                  return (
                    <div className="rounded-xl border border-border bg-surface px-3 py-2 shadow-e2">
                      <p className="text-subhead font-semibold tabular-nums">
                        {sum} {sum === 1 ? "page" : "pages"}
                      </p>
                      {[...TYPES].reverse().map((t) =>
                        w[t] > 0 ? (
                          <p key={t} className="flex items-center gap-1.5 text-caption text-muted">
                            <span
                              className="h-0.5 w-2.5 rounded-full"
                              style={{ background: CSS_VAR[t] }}
                            />
                            <span className="tabular-nums text-foreground">{w[t]}</span>
                            {ENTRY_META[t].label}
                          </p>
                        ) : null,
                      )}
                      <p className="text-caption text-faint">{w.full}</p>
                    </div>
                  );
                }}
              />
              {TYPES.map((t) => (
                <Bar
                  key={t}
                  dataKey={t}
                  stackId="hifz"
                  fill={colorOf(colors, t)}
                  // 2px surface-colored edge = the gap between stacked parts.
                  stroke={colors.surface}
                  strokeWidth={2}
                  maxBarSize={24}
                  isAnimationActive={false}
                  shape={(props: unknown) => {
                    const p = props as React.ComponentProps<typeof Rectangle> & {
                      payload: Week;
                    };
                    return (
                      <Rectangle
                        {...p}
                        radius={topOf(p.payload) === t ? [4, 4, 0, 0] : 0}
                      />
                    );
                  }}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-3 text-footnote text-muted">
          No Sabak, Sabak Para or Dhor logged in the last {WEEKS} weeks.
        </p>
      )}

      {/* Legend + summary: the numbers behind the colors, and what each
          type last covered. */}
      <div className="mt-3 space-y-2.5 border-t border-border pt-3">
        {TYPES.map((t) => {
          const last = latest[t];
          return (
            <div key={t} className="flex items-start gap-2.5">
              <span
                className="mt-1 size-2.5 shrink-0 rounded-[3px]"
                style={{ background: CSS_VAR[t] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-subhead font-medium">
                    {ENTRY_META[t].label}{" "}
                    <span className="font-normal text-faint">· {SHORT_DESC[t]}</span>
                  </p>
                  <p className="shrink-0 text-subhead font-semibold tabular-nums">
                    {totals[t]}
                    <span className="ml-1 font-normal text-faint">pages</span>
                  </p>
                </div>
                <p className="truncate text-footnote text-muted">
                  {last
                    ? `Last: ${describeEntry(last)} · ${ago(localDate(last.logged_at, tz), today)}`
                    : "Not logged yet"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
