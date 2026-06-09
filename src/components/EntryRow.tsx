"use client";

import { Pencil, Trash2 } from "lucide-react";
import { timeLabel } from "@/lib/dates";
import { describeEntry, quantityLabel } from "@/lib/format";
import type { LogRow } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

export function EntryRow({
  entry,
  tz,
  onEdit,
  onDelete,
}: {
  entry: LogRow;
  tz: string;
  onEdit?: (entry: LogRow) => void;
  onDelete?: (id: string) => void;
}) {
  const amt = quantityLabel(entry);
  const pending = entry.id.startsWith("temp-");
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-e1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge type={entry.entry_type} />
          <span className="text-caption text-faint tabular-nums">
            {pending ? "saving…" : timeLabel(entry.logged_at, tz)}
          </span>
        </div>
        <p className="mt-1.5 truncate text-callout font-semibold">
          {describeEntry(entry)}
        </p>
        {(amt || entry.notes) && (
          <p className="truncate text-footnote text-muted">
            {amt}
            {amt && entry.notes ? " · " : ""}
            {entry.notes && <span className="text-faint">{entry.notes}</span>}
          </p>
        )}
      </div>
      {!pending && (onEdit || onDelete) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {onEdit && (
            <button
              onClick={() => onEdit(entry)}
              aria-label="Edit entry"
              className="grid size-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(entry.id)}
              aria-label="Delete entry"
              className="grid size-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-tint hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
