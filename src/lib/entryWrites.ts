/**
 * Client-side writes for an existing log entry (edit + delete), shared by
 * Today and the Journal so both behave identically. Inserts stay in Today,
 * the only place new entries are created.
 */

import { createClient } from "@/lib/supabase/client";
import type { LogRow, NewEntry } from "@/lib/types";

/** True when a write failed only because the mushaf column isn't in the schema
 *  yet (migration not applied). Writes then retry without it, so a pending
 *  migration can never block logging. */
export function isMissingMushaf(err: { message?: string } | null): boolean {
  return !!err && /mushaf/i.test(err.message ?? "");
}

/** Save edits to an entry. `logged_at` is never changed by an edit. */
export async function updateEntry(
  id: string,
  payload: NewEntry,
): Promise<{ row: LogRow | null; error: string | null }> {
  const base: Record<string, unknown> = {
    entry_type: payload.entry_type,
    from_ref: payload.from_ref,
    to_ref: payload.to_ref,
    amount: payload.amount,
    unit: payload.unit,
    juz: payload.juz,
    part: payload.part,
    notes: payload.notes,
  };
  const supabase = createClient();
  let res = await supabase
    .from("log_entries")
    .update(payload.mushaf != null ? { ...base, mushaf: payload.mushaf } : base)
    .eq("id", id)
    .select("*")
    .single();
  // Retry without mushaf if that column isn't in the schema yet.
  if (isMissingMushaf(res.error) && payload.mushaf != null) {
    res = await supabase
      .from("log_entries")
      .update(base)
      .eq("id", id)
      .select("*")
      .single();
  }
  if (res.error || !res.data) {
    return { row: null, error: res.error?.message ?? "Couldn’t save your changes. Try again." };
  }
  return { row: res.data as LogRow, error: null };
}

/** Delete an entry. Returns an error message, or null on success. */
export async function deleteEntry(id: string): Promise<string | null> {
  const supabase = createClient();
  const { error } = await supabase.from("log_entries").delete().eq("id", id);
  return error ? "Couldn’t delete that entry." : null;
}
