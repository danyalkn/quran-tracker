"use client";

import { useEffect, useState } from "react";
import { X, Plus } from "lucide-react";
import {
  ENTRY_META,
  isReadingType,
  type EntryType,
  type Unit,
} from "@/lib/entries";
import type { LogRow, NewEntry } from "@/lib/types";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, FieldLabel } from "@/components/ui/Field";
import { WheelPicker } from "@/components/WheelPicker";
import {
  totalPages,
  clampPage,
  locatePage,
  pageFromRef,
  DEFAULT_MUSHAF,
  type MushafId,
} from "@/lib/mushaf";
import { yesterdayLocal, zonedIso } from "@/lib/dates";
import { cn } from "@/lib/cn";

type Portion = "Full" | "Half" | "Quarter" | "Pages";
const PORTIONS: Portion[] = ["Full", "Half", "Quarter", "Pages"];
const JUZ = Array.from({ length: 30 }, (_, i) => i + 1);

// Sabak (new memorization) is never more than a quarter (~5 pages) at a time.
const SABAK_PAGES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];
// Revision can cover more.
const REV_PAGES = [
  0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20,
];

const PORTION_UNIT: Record<Exclude<Portion, "Pages">, Unit> = {
  Full: "juz",
  Half: "hizb",
  Quarter: "quarter",
};

function defaultPortion(t: EntryType): Portion {
  return t === "dor" ? "Full" : "Quarter";
}

/** Reconstruct the portion wheel from a saved revision entry's unit. */
function portionFromUnit(unit: Unit | null): Portion {
  if (unit === "juz") return "Full";
  if (unit === "hizb") return "Half";
  if (unit === "quarter") return "Quarter";
  return "Pages";
}

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w + "s"}`;

export function LogSheet({
  open,
  onClose,
  initialType,
  onSave,
  editing,
  lastReadPage,
  mushaf = DEFAULT_MUSHAF,
  tz,
}: {
  open: boolean;
  onClose: () => void;
  initialType: EntryType;
  onSave: (entry: NewEntry) => void;
  /** When set, the sheet edits this entry instead of creating a new one. */
  editing?: LogRow | null;
  /** Most recent last-page read, used to auto-advance the bookmark. */
  lastReadPage?: number | null;
  /** The reader's mushaf — drives the page→juz/surah map and page range. */
  mushaf?: MushafId;
  /** Profile timezone — backdating must land on the right local day. */
  tz: string;
}) {
  // An entry being edited keeps its own mushaf; otherwise use the user's.
  const mush: MushafId = editing?.mushaf ?? mushaf;
  const maxPage = totalPages(mush);
  const reading = isReadingType(initialType);
  const sabak = initialType === "sabak";
  const meta = ENTRY_META[initialType];
  const verb = sabak ? "memorizing" : "revising";

  // hifz
  const [juz, setJuz] = useState(1);
  const [portion, setPortion] = useState<Portion>(defaultPortion(initialType));
  const [part, setPart] = useState(1);
  const [pages, setPages] = useState(1); // sabak + revision "Pages"
  // reading
  const [pagesRead, setPagesRead] = useState("");
  const [stoppedAt, setStoppedAt] = useState("");
  // When on, the last page = previous bookmark + pages read (auto-advance).
  const [autoPage, setAutoPage] = useState(true);
  // shared
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [when, setWhen] = useState<"today" | "yesterday">("today");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setWhen("today");
    setNotes(editing?.notes ?? "");
    setShowNotes(Boolean(editing?.notes));

    // Auto-advance on by default for a fresh reading; off when editing so the
    // stored page shows as-is.
    setAutoPage(!editing);

    if (editing) {
      // Prefill from the entry being edited.
      if (isReadingType(editing.entry_type)) {
        setPagesRead(editing.amount != null ? String(editing.amount) : "");
        const p = pageFromRef(editing.to_ref);
        setStoppedAt(p != null ? String(p) : "");
      } else if (editing.entry_type === "sabak") {
        setJuz(editing.juz ?? 1);
        setPages(editing.amount ?? 1);
      } else {
        setJuz(editing.juz ?? 1);
        setPortion(portionFromUnit(editing.unit));
        setPart(editing.part ?? 1);
        setPages(editing.amount ?? 1);
      }
      return;
    }

    // Fresh entry defaults.
    setJuz(1);
    setPortion(defaultPortion(initialType));
    setPart(1);
    setPages(1);
    setPagesRead("");
    setStoppedAt("");
  }, [open, initialType, editing]);

  const backdating = when === "yesterday" && !editing;

  const partOptions =
    portion === "Half" ? [1, 2] : portion === "Quarter" ? [1, 2, 3, 4] : [];

  // Reading: resolve the entered last-page into its mushaf location, live.
  const stoppedNum = Number(stoppedAt);
  const stoppedValid =
    /^\d+$/.test(stoppedAt) && stoppedNum >= 1 && stoppedNum <= maxPage;
  const readLoc = stoppedValid ? locatePage(mush, stoppedNum) : null;

  // Auto-advance: new last page = previous bookmark + pages read.
  const readAmt = Number(pagesRead);
  const readAmtValid = pagesRead.trim() !== "" && !Number.isNaN(readAmt) && readAmt > 0;
  const autoLastPage = readAmtValid
    ? clampPage(mush, Math.round((lastReadPage ?? 0) + readAmt))
    : null;
  const autoLoc = autoLastPage != null ? locatePage(mush, autoLastPage) : null;
  // Never auto-advance a backdated entry: `lastReadPage` is where the user is
  // *now*, so adding yesterday's pages onto it would push the bookmark past
  // their real position and double-count on the next reading.
  const autoAdvance = autoPage && !backdating;
  // The location we'll actually store for this reading.
  const finalLoc = autoAdvance ? autoLoc : readLoc;

  // Numbers only — up to 2 decimal places for pages, integer for the page no.
  const onPagesReadChange = (v: string) => {
    if (/^\d*\.?\d{0,2}$/.test(v)) setPagesRead(v);
  };
  const onStoppedChange = (v: string) => {
    if (/^\d*$/.test(v)) setStoppedAt(v);
  };

  const summary = reading
    ? null
    : sabak
      ? `Memorizing Juz ${juz} · ${plural(pages, "page")}`
      : portion === "Full"
        ? `Revising Juz ${juz} (full juz)`
        : portion === "Pages"
          ? `Revising Juz ${juz} · ${plural(pages, "page")}`
          : `Revising Juz ${juz} · ${portion} ${part}`;

  const save = () => {
    // Backdate to 8pm yesterday *in the profile's timezone* — every consumer
    // (streaks, daily bars, feed grouping) buckets by that zone, not the
    // device's, and the two can differ.
    const loggedAt = backdating ? zonedIso(yesterdayLocal(tz), 20, tz) : null;
    if (reading) {
      const amt = Number(pagesRead);
      if (!pagesRead.trim() || Number.isNaN(amt) || amt <= 0) {
        setError("Enter how many pages you read.");
        return;
      }
      // Manual last page is optional, but if entered it must be a real page.
      if (!autoAdvance && stoppedAt.trim() && !readLoc) {
        setError(`Last page must be 1–${maxPage}, or leave it blank.`);
        return;
      }
      const loc = finalLoc;
      onSave({
        entry_type: initialType,
        from_ref: null,
        to_ref: loc ? String(loc.page) : null, // page; juz/surah derived
        amount: amt,
        unit: "page",
        juz: loc ? loc.juz : null,
        part: null,
        mushaf: mush,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    } else if (sabak) {
      onSave({
        entry_type: initialType,
        from_ref: null,
        to_ref: null,
        amount: pages,
        unit: "page",
        juz,
        part: null,
        mushaf: null,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    } else {
      // revision: Full / Half / Quarter / Pages
      const isPages = portion === "Pages";
      onSave({
        entry_type: initialType,
        from_ref: null,
        to_ref: null,
        amount: isPages ? pages : 1,
        unit: isPages ? "page" : PORTION_UNIT[portion],
        juz,
        part: portion === "Half" || portion === "Quarter" ? part : null,
        mushaf: null,
        notes: notes.trim() || null,
        logged_at: loggedAt,
      });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="log-sheet-title">
      <div className="px-5 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <h2 id="log-sheet-title" className="text-title2">
            {editing ? "Edit" : "Log"} {meta.label}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-5 text-footnote text-muted">{meta.desc}</p>

        {reading ? (
          <div className="flex flex-col items-center gap-6 py-1">
            <div className="flex flex-col items-center gap-2">
              <FieldLabel className="!mb-0">Pages read</FieldLabel>
              <div className="flex items-center gap-2">
                <div className="w-28">
                  <Input
                    inputMode="decimal"
                    placeholder="0"
                    value={pagesRead}
                    onChange={(e) => onPagesReadChange(e.target.value)}
                    autoFocus
                    className="text-center text-title2 font-semibold"
                  />
                </div>
                <span className="text-callout text-muted">pages</span>
              </div>
            </div>
            <div className="w-full">
              {/* Auto-advance the bookmark: last page = previous + pages read.
                  Hidden while backdating — see `autoAdvance`. */}
              <div
                className={cn(
                  "flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1",
                  backdating && "hidden",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-callout font-semibold">
                    Continue from last page
                  </p>
                  <p className="text-footnote text-muted">
                    {autoPage
                      ? lastReadPage != null
                        ? `Adds your pages onto p.${lastReadPage}.`
                        : "Counts from the start of the Qur’an."
                      : "Enter the last page yourself."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAutoPage((v) => !v)}
                  aria-pressed={autoPage}
                  aria-label="Continue from last page"
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full transition-colors",
                    autoPage ? "bg-accent" : "bg-border",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-6 rounded-full bg-white shadow transition-all",
                      autoPage ? "left-[1.375rem]" : "left-0.5",
                    )}
                  />
                </button>
              </div>

              {autoAdvance ? (
                <div className="mt-3 flex h-9 items-center justify-center">
                  {finalLoc ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-accent-tint px-3.5 py-1.5 text-footnote font-medium text-accent">
                      Now on p.{finalLoc.page} · Juz {finalLoc.juz} ·{" "}
                      {finalLoc.surah.name}
                      <span dir="rtl" className="text-faint">
                        {finalLoc.surah.arabic}
                      </span>
                    </span>
                  ) : (
                    <span className="text-footnote text-faint">
                      Enter pages read to set your bookmark
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-center gap-2">
                  <FieldLabel className="!mb-0">
                    {backdating
                      ? "Last page you read yesterday (optional)"
                      : "Last page you read (optional)"}
                  </FieldLabel>
                  <div className="w-44">
                    <Input
                      inputMode="numeric"
                      placeholder={`1–${maxPage}`}
                      value={stoppedAt}
                      onChange={(e) => onStoppedChange(e.target.value)}
                      className="text-center"
                    />
                  </div>
                  <div className="flex h-9 items-center">
                    {readLoc ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-accent-tint px-3.5 py-1.5 text-footnote font-medium text-accent">
                        Juz {readLoc.juz} · {readLoc.surah.name}
                        <span dir="rtl" className="text-faint">
                          {readLoc.surah.arabic}
                        </span>
                      </span>
                    ) : stoppedAt ? (
                      <span className="text-footnote text-faint">
                        Enter a page from 1 to {maxPage}
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : sabak ? (
          <>
            <FieldLabel>What did you memorize?</FieldLabel>
            <div className="rounded-2xl bg-surface p-1.5 shadow-e1">
              <div className="mb-0.5 flex text-center text-caption font-medium uppercase tracking-wider text-faint">
                <div className="flex-1">Juz</div>
                <div className="flex-1">Pages</div>
              </div>
              <div className="flex">
                <div className="flex-1">
                  <WheelPicker options={JUZ} value={juz} onChange={setJuz} ariaLabel="Juz" />
                </div>
                <div className="flex-1">
                  <WheelPicker
                    options={SABAK_PAGES}
                    value={pages}
                    onChange={setPages}
                    ariaLabel="Pages"
                  />
                </div>
              </div>
            </div>
            <p className="mt-2 px-1 text-footnote text-accent">{summary}</p>
          </>
        ) : (
          <>
            <FieldLabel>What are you {verb}?</FieldLabel>
            <div className="rounded-2xl bg-surface p-1.5 shadow-e1">
              <div className="mb-0.5 flex text-center text-caption font-medium uppercase tracking-wider text-faint">
                <div className="flex-1">Juz</div>
                <div className="flex-1">Portion</div>
                <div className="flex-1">
                  {portion === "Pages" ? "Pages" : "Part"}
                </div>
              </div>
              <div className="flex">
                <div className="flex-1">
                  <WheelPicker options={JUZ} value={juz} onChange={setJuz} ariaLabel="Juz" />
                </div>
                <div className="flex-1">
                  <WheelPicker
                    options={PORTIONS}
                    value={portion}
                    onChange={(p) => {
                      setPortion(p);
                      setPart(1);
                    }}
                    ariaLabel="Portion"
                  />
                </div>
                <div className="flex-1">
                  {portion === "Full" ? (
                    <div className="grid h-[200px] place-items-center text-callout text-faint">
                      —
                    </div>
                  ) : portion === "Pages" ? (
                    <WheelPicker
                      options={REV_PAGES}
                      value={pages}
                      onChange={setPages}
                      ariaLabel="Pages"
                    />
                  ) : (
                    <WheelPicker
                      options={partOptions}
                      value={part}
                      onChange={setPart}
                      ariaLabel="Part"
                    />
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 px-1 text-footnote text-accent">{summary}</p>
          </>
        )}

        {/* When — backdate a forgotten entry to yesterday (new entries only) */}
        {!editing && (
          <div className="mt-5">
            <div className="flex rounded-xl bg-surface-2 p-1 text-subhead">
              {(["today", "yesterday"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWhen(w)}
                  className={cn(
                    "flex-1 rounded-lg py-1.5 font-medium capitalize transition-colors",
                    when === w
                      ? "bg-surface text-foreground shadow-e1"
                      : "text-muted",
                  )}
                >
                  {w}
                </button>
              ))}
            </div>
            {when === "yesterday" && (
              <p className="mt-1.5 px-1 text-footnote text-faint">
                Forgot to log? This saves it for yesterday — your streak stays
                honest.
              </p>
            )}
          </div>
        )}

        {/* Notes — collapsed by default */}
        <div className="mt-5">
          {showNotes ? (
            <>
              <FieldLabel>Notes</FieldLabel>
              <Textarea
                placeholder="After Fajr, felt smooth…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                autoFocus
              />
            </>
          ) : (
            <button
              onClick={() => setShowNotes(true)}
              className="inline-flex items-center gap-1.5 text-subhead font-medium text-accent"
            >
              <Plus className="size-4" strokeWidth={2.5} /> Add a note
            </button>
          )}
        </div>

        {error && <p className="mt-3 text-footnote text-danger">{error}</p>}

        <Button fullWidth className="mt-6" onClick={save}>
          {editing ? "Save changes" : "Save entry"}
        </Button>
      </div>
    </Sheet>
  );
}
