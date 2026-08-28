"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMegabytes } from "@/lib/utils/format";
import { MAX_ACTIVE_SELECTION_TOTAL_PAGES, MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES } from "@/lib/config/document-limits";
import type { SelectionLimitReason, SelectionTotals } from "@/lib/validation/document-selection";

export interface SelectedDocumentsSummaryProps {
  count: number;
  documentNames: string[];
  totals: SelectionTotals;
  rejection: { reason: SelectionLimitReason } | null;
  onDismissRejection: () => void;
}

const REJECTION_MESSAGE: Record<SelectionLimitReason, string> = {
  MAX_TOTAL_SIZE: "That would exceed the 10 MB total size limit for a chat selection.",
  MAX_TOTAL_PAGES: "That would exceed the 50-page total limit for a chat selection.",
  MAX_TOTAL_SIZE_AND_PAGES: "That would exceed both the 10 MB size limit and the 50-page limit for a chat selection.",
};

function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = Math.min(100, (value / max) * 100);
  const isNearLimit = percent >= 90;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", isNearLimit ? "bg-amber-500" : "bg-zinc-900 dark:bg-zinc-100")}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function SelectedDocumentsSummary({ count, documentNames, totals, rejection, onDismissRejection }: SelectedDocumentsSummaryProps) {
  if (count === 0 && !rejection) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Selected documents: {count}</p>
        {documentNames.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {documentNames.map((name) => (
              <span
                key={name}
                className="max-w-[220px] truncate rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                title={name}
              >
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>{formatMegabytes(totals.size)}</span>
            <span>{formatMegabytes(MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES)}</span>
          </div>
          <ProgressBar value={totals.size} max={MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>{totals.pages} pages</span>
            <span>{MAX_ACTIVE_SELECTION_TOTAL_PAGES} pages</span>
          </div>
          <ProgressBar value={totals.pages} max={MAX_ACTIVE_SELECTION_TOTAL_PAGES} />
        </div>
      </div>

      {rejection ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{REJECTION_MESSAGE[rejection.reason]}</span>
          <button
            type="button"
            onClick={onDismissRejection}
            aria-label="Dismiss"
            className="shrink-0 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
