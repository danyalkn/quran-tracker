/** Helpers for displaying reminders (time + days of week). */

export const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"]; // 0=Sun
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** "6:00 AM" from a Postgres time string ("HH:MM" or "HH:MM:SS"). */
export function formatTime(t: string): string {
  const [h, m] = t.split(":");
  const d = new Date();
  d.setHours(Number(h), Number(m), 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Daily" / "Weekdays" / "Weekends" / "Mon, Wed, Fri". */
export function daysSummary(days: number[]): string {
  if (days.length === 0) return "Never";
  const sorted = [...days].sort((a, b) => a - b);
  if (sameSet(sorted, ALL)) return "Daily";
  if (sameSet(sorted, WEEKDAYS)) return "Weekdays";
  if (sameSet(sorted, WEEKENDS)) return "Weekends";
  return sorted.map((d) => DAY_SHORT[d]).join(", ");
}
