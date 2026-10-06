"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HistoryEntry } from "@/lib/client/history";
import { computeOccupancy, formatPercent, STATUS } from "@/lib/occupancy";

export function HistoryList({
  history,
  onDelete,
}: {
  history: HistoryEntry[];
  onDelete: (id: string) => void;
}) {
  if (history.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No uploads yet. Analyzed photos are listed here and kept in this browser.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {history.map((entry) => {
        const occupancy = computeOccupancy(entry.vehicles, entry.totalSpaces);
        const status = STATUS[occupancy.status];
        return (
          <li key={entry.id} className="flex items-center gap-3 py-2" data-testid="history-item">
            {entry.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL from localStorage
              <img src={entry.thumbnail} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-10 w-14 shrink-0 rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{entry.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(entry.timestamp).toLocaleString()} · {occupancy.occupied} of{" "}
                {occupancy.total} spaces
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: status.color }}
                title={status.label}
                aria-label={status.label}
                role="img"
              />
              {formatPercent(occupancy.percent)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${entry.fileName} from history`}
              onClick={() => onDelete(entry.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
