"use client";

import { useCallback, useRef, useState } from "react";
import { uploadDocumentWithProgress, ApiError, type UploadedDocument } from "@/lib/client/api";
import { validateFileClientSide } from "@/lib/validation/upload-client";
import {
  createQueueItems,
  getBatchResult,
  isBatchSettled,
  isQueueBusy,
  nextQueuedItemId,
  removeQueueItem,
  retryQueueItem,
  updateQueueItem,
  type FileValidationResult,
  type QueuedFileInfo,
  type UploadQueueItem,
} from "@/lib/upload/upload-queue";

function validateQueuedFile(file: QueuedFileInfo): FileValidationResult {
  return validateFileClientSide({ name: file.fileName, size: file.fileSize });
}

/** The queue item plus the actual browser File it was built from — the pure lib/upload/upload-queue.ts module stays File/DOM-free and testable, so the File reference lives only here, in the React adapter that needs it to actually send the request. */
export interface UploadQueueItemWithFile extends UploadQueueItem {
  file: File;
}

export interface UploadBatchResult {
  succeeded: UploadQueueItemWithFile[];
  failed: UploadQueueItemWithFile[];
}

export interface UseMultiDocumentUploadResult {
  items: UploadQueueItemWithFile[];
  isBusy: boolean;
  /** Adds one or more newly-picked files to the queue and starts processing them (sequentially — see lib/upload/upload-queue.ts). Invalid files are kept in the list as "failed", never dropped. All files passed in one call form a single batch — see onBatchSettled. */
  addFiles: (files: File[]) => void;
  /** Removes a not-yet-started, succeeded, or failed item from the queue. No-op for an item currently in flight. */
  removeItem: (id: string) => void;
  /** Re-queues a failed item so the processing loop attempts it again. */
  retryItem: (id: string) => void;
  /** Clears every item in a terminal state (ready/failed), keeping anything still in flight. */
  clearFinished: () => void;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

/**
 * Owns the multi-file upload queue: validates each file client-side, then
 * uploads them one at a time (a small, safe concurrency strategy — see Part 2
 * of the enhancement task) via POST /api/upload, which is unchanged and still
 * handles exactly one file per request. All state-transition logic is pure
 * and lives in lib/upload/upload-queue.ts; this hook is the thin React
 * adapter that runs the actual network calls and dispatches through it —
 * mirrors the existing lib/validation/document-selection.ts +
 * hooks/useDocumentSelection.ts pattern.
 *
 * `onBatchSettled` fires exactly once per addFiles() call, only once every
 * file from that call has reached a terminal state — never once per file —
 * so a caller reacting to "this upload action is done" (e.g. auto-starting a
 * conversation for the documents that came out of it) sees the whole batch's
 * outcome at once. A `notifiedBatchesRef` guards against firing a second time
 * if a failed item from an already-settled batch is retried later.
 *
 * `itemsRef` is the actual source of truth, mutated synchronously by
 * `applyUpdate` before `setItems` is ever called — deliberately NOT derived
 * from inside a `setItems(updater)` callback, whose invocation timing React
 * does not contractually guarantee. That matters here because
 * `maybeNotifyBatchSettled` must read the just-applied state immediately
 * after `applyUpdate` returns, with no `await` in between to fall back on.
 */
export function useMultiDocumentUpload(
  onFileUploaded?: (document: UploadedDocument) => void,
  onBatchSettled?: (result: UploadBatchResult) => void,
): UseMultiDocumentUploadResult {
  const [items, setItems] = useState<UploadQueueItemWithFile[]>([]);
  const itemsRef = useRef<UploadQueueItemWithFile[]>([]);
  const isProcessingRef = useRef(false);
  const notifiedBatchesRef = useRef(new Set<string>());

  const applyUpdate = useCallback((updater: (current: UploadQueueItemWithFile[]) => UploadQueueItemWithFile[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<Omit<UploadQueueItem, "id" | "fileName" | "fileSize">>) => {
      applyUpdate((current) => updateQueueItem(current, id, changes) as UploadQueueItemWithFile[]);
    },
    [applyUpdate],
  );

  const maybeNotifyBatchSettled = useCallback(
    (batchId: string) => {
      if (notifiedBatchesRef.current.has(batchId)) return;
      if (!isBatchSettled(itemsRef.current, batchId)) return;
      notifiedBatchesRef.current.add(batchId);
      const result = getBatchResult(itemsRef.current, batchId);
      onBatchSettled?.(result as UploadBatchResult);
    },
    [onBatchSettled],
  );

  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      for (;;) {
        const id = nextQueuedItemId(itemsRef.current);
        if (!id) break;

        const item = itemsRef.current.find((candidate) => candidate.id === id);
        if (!item) break;
        const batchId = item.batchId;

        patch(id, { status: "uploading", progress: 0 });

        try {
          const { promise } = uploadDocumentWithProgress(item.file, {
            onProgress: (percent) => patch(id, { progress: percent }),
            onUploadComplete: () => patch(id, { status: "processing" }),
          });
          const document = await promise;
          patch(id, { status: "ready", progress: 100, documentId: document.id });
          onFileUploaded?.(document);
        } catch (error) {
          const message = error instanceof ApiError ? error.message : "The document could not be uploaded.";
          patch(id, { status: "failed", errorMessage: message });
        }

        maybeNotifyBatchSettled(batchId);
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [patch, onFileUploaded, maybeNotifyBatchSettled]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const batchId = nextId("batch");
      const withIds = files.map((file) => ({ id: nextId("upload"), fileName: file.name, fileSize: file.size, file }));
      const validated = createQueueItems(withIds, validateQueuedFile, batchId);
      const newItems: UploadQueueItemWithFile[] = validated.map((item, index) => ({ ...item, file: withIds[index].file }));
      applyUpdate((current) => [...current, ...newItems]);
      // A batch made entirely of instantly-rejected (invalid) files is already settled — nothing
      // will reach processQueue's per-item check for it, so it needs this check here too.
      maybeNotifyBatchSettled(batchId);
      void processQueue();
    },
    [applyUpdate, processQueue, maybeNotifyBatchSettled],
  );

  const removeItem = useCallback(
    (id: string) => {
      applyUpdate((current) => removeQueueItem(current, id) as UploadQueueItemWithFile[]);
    },
    [applyUpdate],
  );

  const retryItem = useCallback(
    (id: string) => {
      applyUpdate((current) => retryQueueItem(current, id) as UploadQueueItemWithFile[]);
      void processQueue();
    },
    [applyUpdate, processQueue],
  );

  const clearFinished = useCallback(() => {
    applyUpdate((current) => current.filter((item) => item.status !== "ready" && item.status !== "failed"));
  }, [applyUpdate]);

  return { items, isBusy: isQueueBusy(items), addFiles, removeItem, retryItem, clearFinished };
}
