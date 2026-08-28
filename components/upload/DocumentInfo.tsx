"use client";

import { FileText, CheckCircle2, RotateCcw } from "lucide-react";
import type { UploadedDocument } from "@/lib/client/api";

export interface DocumentInfoProps {
  document: UploadedDocument;
  onReset: () => void;
}

/** Compact summary shown once a document is ready, before/around the chat interface. */
export function DocumentInfo({ document, onReset }: DocumentInfoProps) {
  return (
    <div className="flex w-full items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-center gap-3">
        <FileText className="h-5 w-5 shrink-0 text-zinc-400" strokeWidth={1.5} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{document.fileName}</p>
          <p className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Ready
            {document.pageCount ? ` · ${document.pageCount} page${document.pageCount === 1 ? "" : "s"}` : ""}
            {` · ${document.chunkCount} chunk${document.chunkCount === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        New document
      </button>
    </div>
  );
}
