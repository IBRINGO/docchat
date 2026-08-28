"use client";

import { CheckSquare, Square, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMegabytes, formatRelativeDate } from "@/lib/utils/format";
import type { DocumentSummary } from "@/lib/services/document-list.service";

export interface DocumentListItemProps {
  document: DocumentSummary;
  isSelected: boolean;
  isSelectable: boolean;
  onToggle: (documentId: string) => void;
}

const STATUS_BADGE: Record<DocumentSummary["status"], { label: string; icon: typeof CheckCircle2; className: string }> = {
  ready: { label: "Ready", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  processing: { label: "Processing", icon: Loader2, className: "text-amber-600 dark:text-amber-400" },
  failed: { label: "Failed", icon: XCircle, className: "text-red-600 dark:text-red-400" },
};

export function DocumentListItem({ document, isSelected, isSelectable, onToggle }: DocumentListItemProps) {
  const badge = STATUS_BADGE[document.status];
  const BadgeIcon = badge.icon;

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        aria-disabled={!isSelectable}
        disabled={!isSelectable}
        onClick={() => onToggle(document.id)}
        title={!isSelectable ? `This document is ${badge.label.toLowerCase()} and can't be selected yet.` : undefined}
        className={cn(
          "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
          isSelectable
            ? "cursor-pointer border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
            : "cursor-not-allowed border-zinc-100 opacity-60 dark:border-zinc-900",
          isSelected && "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900",
        )}
      >
        <span className="mt-0.5 shrink-0 text-zinc-400">
          {isSelectable ? (
            isSelected ? (
              <CheckSquare className="h-4 w-4 text-zinc-900 dark:text-zinc-100" />
            ) : (
              <Square className="h-4 w-4" />
            )
          ) : (
            <Square className="h-4 w-4 opacity-40" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{document.fileName}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className={cn("flex items-center gap-1 font-medium", badge.className)}>
              <BadgeIcon className={cn("h-3 w-3", document.status === "processing" && "animate-spin")} />
              {badge.label}
            </span>
            {document.status !== "failed" ? (
              <>
                <span>·</span>
                <span>{document.pageCount ?? "—"} pages</span>
                <span>·</span>
                <span>{formatMegabytes(document.size)}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{formatRelativeDate(document.createdAt)}</span>
          </span>
          {document.status === "failed" && document.errorMessage ? (
            <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{document.errorMessage}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
