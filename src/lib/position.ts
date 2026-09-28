/**
 * Where inside a juz a hifz entry sits ("the second half of page 3 of
 * Juz 3"). Pure module: no React, no I/O.
 *
 * Storage: structured hifz rows already carry `juz` + `amount` (pages).
 * The start of the portion is stored in `from_ref` as the JUZ-RELATIVE page
 * the portion begins on, in half-page steps: "3" = top of the 3rd page of
 * the juz, "3.5" = its second half. `from_ref` is the schema's free-text
 * "what was covered" column; hifz rows never used it (the log form always
 * wrote null), and reading rows keep their bookmark in `to_ref`, so no
 * migration is needed and old rows simply read as "no position".
 *
 * Juz-relative, not absolute, because that is how memorizers count ("3rd
 * page of the 3rd juz"). The absolute mushaf page is derived with the
 * entry's mushaf when a chart needs it.
 */

import {
  juzStartPages,
  totalPages,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";
import type { EntryType } from "@/lib/entries";

/** Hifz types that carry a juz (+ optional in-juz position). */
export function isHifzType(t: EntryType): boolean {
  return t === "sabak" || t === "sabak_para" || t === "dor";
}

/** Pages in a juz for a mushaf (Uthmani juz 1 = 21, juz 30 = 23, most 20). */
export function juzLength(m: MushafId | null | undefined, juz: number): number {
  const mm = m ?? DEFAULT_MUSHAF;
  const starts = juzStartPages(mm);
  const j = Math.min(30, Math.max(1, Math.round(juz)));
  const end = j < 30 ? starts[j] - 1 : totalPages(mm);
  return end - starts[j - 1] + 1;
}

/** Parse a stored juz-relative start ("3", "3.5"). Anything else = no position. */
export function parseJuzPage(ref: string | null | undefined): number | null {
  if (!ref || !/^\d{1,2}(\.5)?$/.test(ref)) return null;
  const n = Number(ref);
  return n >= 1 ? n : null;
}

/** Serialize a juz-relative start for `from_ref`. */
export function serializeJuzPage(n: number): string {
  return String(Math.round(n * 2) / 2);
}

/** Wheel label for a start: 3 → "3", 3.5 → "3½". */
export function juzPageLabel(n: number): string {
  const whole = Math.floor(n);
  return n - whole >= 0.5 ? `${whole}½` : String(whole);
}

/** Every start a juz offers, in half-page steps: [1, 1.5, 2, …, len + 0.5]. */
export function juzPageOptions(m: MushafId | null | undefined, juz: number): number[] {
  const len = juzLength(m, juz);
  const out: number[] = [];
  for (let p = 1; p <= len + 0.5; p += 0.5) out.push(p);
  return out;
}

/** Absolute mushaf page a juz-relative position falls on. */
export function absolutePage(
  m: MushafId | null | undefined,
  juz: number,
  juzPage: number,
): number {
  const mm = m ?? DEFAULT_MUSHAF;
  return juzStartPages(mm)[Math.min(30, Math.max(1, juz)) - 1] + Math.floor(juzPage) - 1;
}

/** "½" / "¼" / "1½" / "3" - page amounts the way people say them. */
export function pagesAmountLabel(n: number): string {
  const whole = Math.floor(n);
  const frac = +(n - whole).toFixed(2);
  const glyph = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : frac === 0.75 ? "¾" : "";
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  return String(+n.toFixed(2));
}

/** "½ page", "1 page", "2½ pages". */
export function pagesPhrase(n: number): string {
  return `${pagesAmountLabel(n)} ${n > 0 && n <= 1 ? "page" : "pages"}`;
}

/**
 * Human label for a portion inside a juz:
 *   start 3,   ½ page  → "p.3, 1st half"
 *   start 3.5, ½ page  → "p.3, 2nd half"
 *   start 4,   1 page  → "p.4"
 *   start 1,   3 pages → "p.1–3"
 *   anything else      → "from p.3½" (the amount is shown alongside)
 */
export function positionLabel(start: number, amount: number | null | undefined): string {
  const a = amount == null ? 0 : +amount;
  const whole = Math.floor(start);
  const half = start - whole >= 0.5;
  // Half a page or less stays inside one half of one page.
  if (a > 0 && a <= 0.5) return `p.${whole}, ${half ? "2nd" : "1st"} half`;
  if (!half && Number.isInteger(a) && a >= 1) {
    return a === 1 ? `p.${whole}` : `p.${whole}–${whole + a - 1}`;
  }
  return `from p.${juzPageLabel(start)}`;
}

/** True when `positionLabel` already says how much (don't repeat it). */
export function positionSaysAmount(start: number, amount: number | null | undefined): boolean {
  const a = amount == null ? 0 : +amount;
  const half = start - Math.floor(start) >= 0.5;
  return a === 0.5 || (!half && Number.isInteger(a) && a >= 1);
}

/** Minimal row shape the position helpers read. */
export type PositionedRow = {
  entry_type: EntryType;
  juz: number | null;
  unit: string | null;
  amount: number | null;
  from_ref: string | null;
  mushaf?: MushafId | null;
};

/** The in-juz start of a hifz row, or null (old rows, non-page portions). */
export function rowJuzPage(e: PositionedRow): number | null {
  if (!isHifzType(e.entry_type) || e.juz == null || e.unit !== "page") return null;
  return parseJuzPage(e.from_ref);
}

/**
 * Where the next sabak should start, continuing from the last one: same juz,
 * right after the last portion (snapped to a half page). Past the end of the
 * juz it rolls to the start of the next juz. Null when the last sabak had no
 * position to continue from.
 */
export function nextSabakStart(
  last: PositionedRow | null | undefined,
  m: MushafId | null | undefined,
): { juz: number; start: number } | null {
  if (!last || last.juz == null) return null;
  const start = rowJuzPage(last);
  if (start == null) return null;
  const next = Math.round((start + (last.amount ? +last.amount : 0)) * 2) / 2;
  if (next > juzLength(m, last.juz)) {
    return last.juz < 30 ? { juz: last.juz + 1, start: 1 } : { juz: last.juz, start };
  }
  return { juz: last.juz, start: next };
}
