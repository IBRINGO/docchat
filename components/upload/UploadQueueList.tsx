"use client";

import { CheckCircle2, Clock, FileText, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMegabytes } from "@/lib/utils/format";
import type { UploadQueueItemWithFile } from "@/hooks/useMultiDocumentUpload";

export interface UploadQueueListProps {
  items: UploadQueueItemWithFile[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const STATUS_TEXT: Record<UploadQueueItemWithFile["status"], string> = {
  queued: "Queued",
  uploading: "Uploading…",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

function StatusIcon({ item }: { item: UploadQueueItemWithFile }) {
  switch (item.status) {
    case "queued":
      return <Clock className="h-4 w-4 text-zinc-400" aria-hidden="true" />;
    case "uploading":
    case "processing":
      return <Loader2 className="h-4 w-4 animate-spin text-zinc-500 dark:text-zinc-400" aria-hidden="true" />;
    case "ready":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" aria-hidden="true" />;
  }
}

/** Compact per-file queue shown while (and after) a multi-file upload batch runs — see hooks/useMultiDocumentUpload.ts. A file's status is never hidden or silently dropped, including for a batch that partially fails. */
export function UploadQueueList({ items, onRemove, onRetry }: UploadQueueListProps) {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5" aria-label="Upload queue">
      {items.map((item) => {
        const canRemove = item.status === "queued" || item.status === "ready" || item.status === "failed";
        return (
          <li
            key={item.id}
            className="animate-fade-in-up flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          >
            <FileText className="h-4 w-4 shrink-0 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-zinc-900 dark:text-zinc-100" title={item.fileName}>
                  {item.fileName}
                </span>
                <span className="shrink-0 text-zinc-400">{formatMegabytes(item.fileSize)}</span>
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                <StatusIcon item={item} />
                <span className={cn("text-zinc-500 dark:text-zinc-400", item.status === "failed" && "text-red-600 dark:text-red-400")}>
                  {item.status === "uploading" ? `${STATUS_TEXT[item.status]} ${item.progress}%` : STATUS_TEXT[item.status]}
                  {item.status === "failed" && item.errorMessage ? `: ${item.errorMessage}` : null}
                </span>
              </div>

              {item.status === "uploading" ? (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-zinc-900 transition-[width] duration-200 dark:bg-zinc-100"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {item.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => onRetry(item.id)}
                  aria-label={`Retry uploading ${item.fileName}`}
                  className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {canRemove ? (
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.fileName} from the upload queue`}
                  className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
