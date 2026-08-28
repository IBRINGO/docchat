"use client";

import { cn } from "@/lib/utils/cn";
import type { DocumentStatusFilter } from "@/hooks/useDocumentLibrary";

export interface DocumentFiltersProps {
  value: DocumentStatusFilter;
  onChange: (value: DocumentStatusFilter) => void;
}

const FILTERS: Array<{ value: DocumentStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

export function DocumentFilters({ value, onChange }: DocumentFiltersProps) {
  return (
    <div role="tablist" aria-label="Filter documents by status" className="flex gap-1">
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          role="tab"
          aria-selected={value === filter.value}
          onClick={() => onChange(filter.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === filter.value
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200",
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
