"use client";

import { FileStack, SearchX } from "lucide-react";

export interface EmptyDocumentsStateProps {
  /** True when a search/filter is active and simply matched nothing, vs. the library being genuinely empty. */
  isFiltered: boolean;
}

export function EmptyDocumentsState({ isFiltered }: EmptyDocumentsStateProps) {
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-zinc-400 dark:text-zinc-600">
        <SearchX className="h-7 w-7" strokeWidth={1.5} />
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No documents match your search</p>
        <p className="text-xs">Try a different name or filter.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-zinc-400 dark:text-zinc-600">
      <FileStack className="h-7 w-7" strokeWidth={1.5} />
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">No documents yet</p>
      <p className="text-xs">Upload a PDF to get started.</p>
    </div>
  );
}
