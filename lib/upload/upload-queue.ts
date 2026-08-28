/**
 * Pure, framework-free state transitions for the multi-file upload queue.
 * Kept separate from hooks/useMultiDocumentUpload.ts (the React adapter, see
 * lib/validation/document-selection.ts + hooks/useDocumentSelection.ts for
 * the same pattern already used elsewhere in this codebase) so the
 * orchestration logic — which file goes next, what a retry/remove is allowed
 * to do, how a mixed-result batch is summarized — is testable without a DOM,
 * fetch, or XHR.
 */

export type UploadQueueStatus = "queued" | "uploading" | "processing" | "ready" | "failed";

export interface QueuedFileInfo {
  id: string;
  fileName: string;
  fileSize: number;
}

export interface UploadQueueItem extends QueuedFileInfo {
  status: UploadQueueStatus;
  /** Meaningful while status is "uploading" — percentage of the request body sent so far. */
  progress: number;
  errorMessage: string | null;
  documentId: string | null;
  /** Identifies which addFiles() call this item came from — see isBatchSettled/getBatchResult below. Every item from one drag-drop/browse selection shares the same batchId, even if some of them fail client-side validation instantly. */
  batchId: string;
}

export interface FileValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Builds initial queue items for a newly-selected batch of files, validating
 * each one independently. An invalid file is kept in the returned list as
 * "failed" with its reason — never silently dropped — so a batch containing
 * both good and bad files still shows every file's outcome.
 */
export function createQueueItems(
  files: readonly QueuedFileInfo[],
  validate: (file: QueuedFileInfo) => FileValidationResult,
  batchId: string,
): UploadQueueItem[] {
  return files.map((file) => {
    const result = validate(file);
    return {
      ...file,
      status: result.valid ? "queued" : "failed",
      progress: 0,
      errorMessage: result.valid ? null : (result.reason ?? "This file could not be uploaded."),
      documentId: null,
      batchId,
    };
  });
}

/** The id of the first not-yet-started item, in queue order, or null if nothing is waiting. */
export function nextQueuedItemId(items: readonly UploadQueueItem[]): string | null {
  return items.find((item) => item.status === "queued")?.id ?? null;
}

export function updateQueueItem(
  items: readonly UploadQueueItem[],
  id: string,
  patch: Partial<Omit<UploadQueueItem, "id" | "fileName" | "fileSize">>,
): UploadQueueItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/**
 * Moves a failed item back to "queued" so the processing loop picks it up
 * again in order. Anything not currently "failed" is returned unchanged —
 * retrying an in-flight or already-succeeded item is not a meaningful action.
 */
export function retryQueueItem(items: readonly UploadQueueItem[], id: string): UploadQueueItem[] {
  return items.map((item) =>
    item.id === id && item.status === "failed" ? { ...item, status: "queued", progress: 0, errorMessage: null } : item,
  );
}

/**
 * Removes an item from the queue. Only allowed for items that are not
 * currently in flight ("queued", "ready", or "failed") — an "uploading" or
 * "processing" item is left in place, since a real request is outstanding
 * for it and hiding it would orphan that request from the UI describing it.
 */
export function removeQueueItem(items: readonly UploadQueueItem[], id: string): UploadQueueItem[] {
  return items.filter((item) => !(item.id === id && (item.status === "queued" || item.status === "ready" || item.status === "failed")));
}

/** True if any item is still waiting or in flight — used to decide whether "Uploading…" summary text should still show. */
export function isQueueBusy(items: readonly UploadQueueItem[]): boolean {
  return items.some((item) => item.status === "queued" || item.status === "uploading" || item.status === "processing");
}

export interface QueueSummary {
  total: number;
  ready: number;
  failed: number;
}

export function summarizeQueue(items: readonly UploadQueueItem[]): QueueSummary {
  return {
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
}

/**
 * True once every item belonging to `batchId` has reached a terminal state
 * (ready or failed) — i.e. nothing from that batch is still queued, uploading,
 * or processing. Because the queue processes items strictly in order and a
 * batch's items are always contiguous (appended together by addFiles), a
 * batch's items are guaranteed to fully settle before the next batch's items
 * start — so this only ever flips from false to true once per batch, even if
 * multiple batches are in flight over time.
 */
export function isBatchSettled(items: readonly UploadQueueItem[], batchId: string): boolean {
  return !items.some((item) => item.batchId === batchId && (item.status === "queued" || item.status === "uploading" || item.status === "processing"));
}

export interface BatchResult {
  succeeded: UploadQueueItem[];
  failed: UploadQueueItem[];
}

/** Splits one batch's items into what succeeded vs. failed — used once isBatchSettled is true to decide what to do with the batch as a whole (see hooks/useMultiDocumentUpload.ts). */
export function getBatchResult(items: readonly UploadQueueItem[], batchId: string): BatchResult {
  const batchItems = items.filter((item) => item.batchId === batchId);
  return {
    succeeded: batchItems.filter((item) => item.status === "ready"),
    failed: batchItems.filter((item) => item.status === "failed"),
  };
}
