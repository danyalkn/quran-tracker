import { ENTRY_META, UNIT_META } from "@/lib/entries";
import type { LogRow } from "@/lib/types";

/** Primary label for an entry (what was covered). */
export function describeEntry(e: LogRow): string {
  // Structured hifz entry (juz + portion).
  if (e.juz != null) {
    const base = `Juz ${e.juz}`;
    if (e.unit === "hizb" && e.part) return `${base} · Half ${e.part}`;
    if (e.unit === "quarter" && e.part) return `${base} · Q${e.part}`;
    return base; // full juz
  }
  if (e.from_ref && e.to_ref) return `${e.from_ref} → ${e.to_ref}`;
  return e.from_ref || e.to_ref || ENTRY_META[e.entry_type].label;
}

/** Secondary quantity label (null when the portion already says it). */
export function quantityLabel(e: LogRow): string | null {
  // Structured hifz: only show a quantity when it's a page amount (sabak or a
  // "Pages" revision). Full/Half/Quarter already read in describeEntry.
  if (e.juz != null) {
    if (e.unit === "page" && e.amount != null) {
      const n = +e.amount;
      return `${n} ${n === 1 ? "page" : "pages"}`;
    }
    return null;
  }
  if (e.amount == null || e.unit == null) return null;
  const n = +e.amount;
  const word = n === 1 ? UNIT_META[e.unit].one : UNIT_META[e.unit].plural;
  let s = `${n} ${word}`;
  if (e.pages_equiv != null && e.unit !== "page") {
    s += ` · ≈ ${+(+e.pages_equiv).toFixed(2)} pg`;
  }
  return s;
}
