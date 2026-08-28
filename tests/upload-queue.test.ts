import { describe, expect, it } from "vitest";
import {
  createQueueItems,
  getBatchResult,
  isBatchSettled,
  isQueueBusy,
  nextQueuedItemId,
  removeQueueItem,
  retryQueueItem,
  summarizeQueue,
  updateQueueItem,
  type QueuedFileInfo,
} from "@/lib/upload/upload-queue";

const BATCH_1 = "batch-1";
const BATCH_2 = "batch-2";

function file(id: string, fileName = `${id}.pdf`, fileSize = 1024): QueuedFileInfo {
  return { id, fileName, fileSize };
}

describe("createQueueItems", () => {
  it("marks every valid file as queued", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    expect(items.map((i) => i.status)).toEqual(["queued", "queued"]);
    expect(items.every((i) => i.errorMessage === null && i.progress === 0 && i.documentId === null)).toBe(true);
  });

  it("keeps an invalid file in the list as failed, with its reason, instead of dropping it", () => {
    const items = createQueueItems([file("a")], () => ({ valid: false, reason: "Only PDF files are accepted." }), BATCH_1);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("failed");
    expect(items[0].errorMessage).toBe("Only PDF files are accepted.");
  });

  it("validates each file independently in a mixed batch", () => {
    const items = createQueueItems([file("a"), file("b"), file("c")], (f) => ({ valid: f.id !== "b" }), BATCH_1);
    expect(items.map((i) => i.status)).toEqual(["queued", "failed", "queued"]);
  });

  it("stamps every item with the given batchId", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    expect(items.every((i) => i.batchId === BATCH_1)).toBe(true);
  });
});

describe("nextQueuedItemId", () => {
  it("returns the first queued item's id, in order", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    expect(nextQueuedItemId(items)).toBe("a");
  });

  it("returns null when nothing is queued", () => {
    const items = createQueueItems([file("a")], () => ({ valid: false, reason: "bad" }), BATCH_1);
    expect(nextQueuedItemId(items)).toBeNull();
  });

  it("skips items already in flight or finished", () => {
    let items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    expect(nextQueuedItemId(items)).toBe("b");
  });
});

describe("updateQueueItem", () => {
  it("patches only the targeted item", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    const updated = updateQueueItem(items, "a", { status: "uploading", progress: 40 });
    expect(updated.find((i) => i.id === "a")).toMatchObject({ status: "uploading", progress: 40 });
    expect(updated.find((i) => i.id === "b")).toMatchObject({ status: "queued", progress: 0 });
  });
});

describe("retryQueueItem", () => {
  it("moves a failed item back to queued and clears its error", () => {
    const items = createQueueItems([file("a")], () => ({ valid: false, reason: "Network error" }), BATCH_1);
    const retried = retryQueueItem(items, "a");
    expect(retried[0]).toMatchObject({ status: "queued", errorMessage: null, progress: 0 });
  });

  it("leaves a non-failed item unchanged", () => {
    let items = createQueueItems([file("a")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    const retried = retryQueueItem(items, "a");
    expect(retried[0].status).toBe("ready");
  });
});

describe("removeQueueItem", () => {
  it("removes a queued item", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    expect(removeQueueItem(items, "a").map((i) => i.id)).toEqual(["b"]);
  });

  it("removes a ready item and a failed item", () => {
    let items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    items = updateQueueItem(items, "b", { status: "failed", errorMessage: "oops" });
    expect(removeQueueItem(removeQueueItem(items, "a"), "b")).toEqual([]);
  });

  it("does not remove an item that is uploading or processing", () => {
    let items = createQueueItems([file("a")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "uploading" });
    expect(removeQueueItem(items, "a")).toHaveLength(1);

    items = updateQueueItem(items, "a", { status: "processing" });
    expect(removeQueueItem(items, "a")).toHaveLength(1);
  });
});

describe("isQueueBusy", () => {
  it("is true while anything is queued, uploading, or processing", () => {
    const queued = createQueueItems([file("a")], () => ({ valid: true }), BATCH_1);
    expect(isQueueBusy(queued)).toBe(true);
    expect(isQueueBusy(updateQueueItem(queued, "a", { status: "uploading" }))).toBe(true);
    expect(isQueueBusy(updateQueueItem(queued, "a", { status: "processing" }))).toBe(true);
  });

  it("is false once everything has reached a terminal state", () => {
    let items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    items = updateQueueItem(items, "b", { status: "failed", errorMessage: "x" });
    expect(isQueueBusy(items)).toBe(false);
  });

  it("is false for an empty queue", () => {
    expect(isQueueBusy([])).toBe(false);
  });
});

describe("summarizeQueue", () => {
  it("counts total/ready/failed for a mixed batch", () => {
    let items = createQueueItems([file("a"), file("b"), file("c"), file("d")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    items = updateQueueItem(items, "b", { status: "ready" });
    items = updateQueueItem(items, "c", { status: "failed", errorMessage: "x" });
    // "d" stays queued
    expect(summarizeQueue(items)).toEqual({ total: 4, ready: 2, failed: 1 });
  });
});

describe("isBatchSettled", () => {
  it("is false while any item of the batch is queued, uploading, or processing", () => {
    let items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    expect(isBatchSettled(items, BATCH_1)).toBe(false);

    items = updateQueueItem(items, "a", { status: "ready" });
    expect(isBatchSettled(items, BATCH_1)).toBe(false); // "b" still queued

    items = updateQueueItem(items, "b", { status: "uploading" });
    expect(isBatchSettled(items, BATCH_1)).toBe(false);
  });

  it("is true once every item of the batch has reached ready or failed", () => {
    let items = createQueueItems([file("a"), file("b")], () => ({ valid: true }), BATCH_1);
    items = updateQueueItem(items, "a", { status: "ready" });
    items = updateQueueItem(items, "b", { status: "failed", errorMessage: "x" });
    expect(isBatchSettled(items, BATCH_1)).toBe(true);
  });

  it("only considers items belonging to the given batch", () => {
    let items = createQueueItems([file("a")], () => ({ valid: true }), BATCH_1);
    items = [...items, ...createQueueItems([file("b")], () => ({ valid: true }), BATCH_2)];
    items = updateQueueItem(items, "a", { status: "ready" });
    // "b" (batch 2) is still queued, but batch 1 only contains "a", which is done.
    expect(isBatchSettled(items, BATCH_1)).toBe(true);
    expect(isBatchSettled(items, BATCH_2)).toBe(false);
  });

  it("is true for a batch made entirely of instantly-failed (invalid) files", () => {
    const items = createQueueItems([file("a")], () => ({ valid: false, reason: "Only PDF files are accepted." }), BATCH_1);
    expect(isBatchSettled(items, BATCH_1)).toBe(true);
  });
});

describe("getBatchResult", () => {
  it("splits a batch into succeeded and failed items only, excluding other batches", () => {
    let items = createQueueItems([file("a"), file("b"), file("c")], () => ({ valid: true }), BATCH_1);
    items = [...items, ...createQueueItems([file("d")], () => ({ valid: true }), BATCH_2)];
    items = updateQueueItem(items, "a", { status: "ready", documentId: "doc-a" });
    items = updateQueueItem(items, "b", { status: "ready", documentId: "doc-b" });
    items = updateQueueItem(items, "c", { status: "failed", errorMessage: "network error" });
    items = updateQueueItem(items, "d", { status: "ready", documentId: "doc-d" });

    const result = getBatchResult(items, BATCH_1);
    expect(result.succeeded.map((i) => i.id)).toEqual(["a", "b"]);
    expect(result.failed.map((i) => i.id)).toEqual(["c"]);
  });

  it("returns an empty succeeded list when every file in the batch failed", () => {
    const items = createQueueItems([file("a"), file("b")], () => ({ valid: false, reason: "bad" }), BATCH_1);
    const result = getBatchResult(items, BATCH_1);
    expect(result.succeeded).toEqual([]);
    expect(result.failed.map((i) => i.id)).toEqual(["a", "b"]);
  });
});
