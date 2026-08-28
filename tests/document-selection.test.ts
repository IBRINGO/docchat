import { describe, expect, it } from "vitest";
import {
  calculateSelectionTotals,
  canSelectDocument,
  toggleDocumentSelection,
  validateSelectionLimits,
  type SelectableDocument,
} from "@/lib/validation/document-selection";

const MB = 1024 * 1024;

function doc(id: string, overrides: Partial<SelectableDocument> = {}): SelectableDocument {
  return { id, status: "ready", size: 0, pageCount: 0, ...overrides };
}

describe("validateSelectionLimits", () => {
  it("CASE 1: allows a selection at 9 MB / 45 pages (under both limits)", () => {
    const a = doc("a", { size: 2 * MB, pageCount: 10 });
    const b = doc("b", { size: 3 * MB, pageCount: 15 });
    const c = doc("c", { size: 4 * MB, pageCount: 20 });

    const result = validateSelectionLimits([a, b], c);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.totals).toEqual({ size: 9 * MB, pages: 45 });
  });

  it("CASE 2: rejects 11 MB / 45 pages — MAX_TOTAL_SIZE only", () => {
    const a = doc("a", { size: 6 * MB, pageCount: 20 });
    const b = doc("b", { size: 5 * MB, pageCount: 25 });

    const result = validateSelectionLimits([a], b);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MAX_TOTAL_SIZE");
    expect(result.totals).toEqual({ size: 11 * MB, pages: 45 });
  });

  it("CASE 3: rejects 8 MB / 55 pages — MAX_TOTAL_PAGES only", () => {
    const a = doc("a", { size: 3 * MB, pageCount: 30 });
    const b = doc("b", { size: 5 * MB, pageCount: 25 });

    const result = validateSelectionLimits([a], b);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MAX_TOTAL_PAGES");
    expect(result.totals).toEqual({ size: 8 * MB, pages: 55 });
  });

  it("CASE 4: rejects 11 MB / 55 pages — both limits exceeded", () => {
    const a = doc("a", { size: 6 * MB, pageCount: 30 });
    const b = doc("b", { size: 5 * MB, pageCount: 25 });

    const result = validateSelectionLimits([a], b);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MAX_TOTAL_SIZE_AND_PAGES");
    expect(result.totals).toEqual({ size: 11 * MB, pages: 55 });
  });

  it("allows a selection exactly at the limits (inclusive boundary)", () => {
    const a = doc("a", { size: 4 * MB, pageCount: 20 });
    const b = doc("b", { size: 6 * MB, pageCount: 30 });

    const result = validateSelectionLimits([a], b);

    expect(result.valid).toBe(true);
    expect(result.totals).toEqual({ size: 10 * MB, pages: 50 });
  });
});

describe("canSelectDocument", () => {
  it("CASE 5: a document is only selectable when its status is ready", () => {
    expect(canSelectDocument({ status: "ready" })).toBe(true);
    expect(canSelectDocument({ status: "processing" })).toBe(false);
    expect(canSelectDocument({ status: "failed" })).toBe(false);
  });
});

describe("calculateSelectionTotals", () => {
  it("sums size and pageCount across documents, treating a null pageCount as 0", () => {
    const totals = calculateSelectionTotals([
      doc("a", { size: 1 * MB, pageCount: 5 }),
      doc("b", { size: 2 * MB, pageCount: null }),
    ]);

    expect(totals).toEqual({ size: 3 * MB, pages: 5 });
  });

  it("returns zero totals for an empty selection", () => {
    expect(calculateSelectionTotals([])).toEqual({ size: 0, pages: 0 });
  });
});

describe("toggleDocumentSelection", () => {
  it("adds a ready document that fits within the limits", () => {
    const a = doc("a", { size: 2 * MB, pageCount: 10 });
    const documentsById = new Map([["a", a]]);

    const result = toggleDocumentSelection([], documentsById, "a");

    expect(result.selectedIds).toEqual(["a"]);
    expect(result.rejected).toBeUndefined();
  });

  it("CASE 6: removing a selected document recalculates the remaining totals correctly", () => {
    const a = doc("a", { size: 2 * MB, pageCount: 10 });
    const b = doc("b", { size: 3 * MB, pageCount: 15 });
    const documentsById = new Map([
      ["a", a],
      ["b", b],
    ]);

    const afterRemoval = toggleDocumentSelection(["a", "b"], documentsById, "a");
    expect(afterRemoval.selectedIds).toEqual(["b"]);

    const remaining = afterRemoval.selectedIds.map((id) => documentsById.get(id)!);
    expect(calculateSelectionTotals(remaining)).toEqual({ size: 3 * MB, pages: 15 });
  });

  it("does not select a document that isn't ready, and reports no rejection (it was never selectable to begin with)", () => {
    const a = doc("a", { status: "processing" });
    const documentsById = new Map([["a", a]]);

    const result = toggleDocumentSelection([], documentsById, "a");

    expect(result.selectedIds).toEqual([]);
  });

  it("rejects adding a document that would exceed the cumulative size limit, leaving the existing selection unchanged", () => {
    const a = doc("a", { size: 6 * MB, pageCount: 20 });
    const b = doc("b", { size: 5 * MB, pageCount: 10 });
    const documentsById = new Map([
      ["a", a],
      ["b", b],
    ]);

    const result = toggleDocumentSelection(["a"], documentsById, "b");

    expect(result.selectedIds).toEqual(["a"]);
    expect(result.rejected).toEqual({ documentId: "b", reason: "MAX_TOTAL_SIZE" });
  });

  it("rejects adding a document that would exceed the cumulative page limit", () => {
    const a = doc("a", { size: 1 * MB, pageCount: 30 });
    const b = doc("b", { size: 1 * MB, pageCount: 25 });
    const documentsById = new Map([
      ["a", a],
      ["b", b],
    ]);

    const result = toggleDocumentSelection(["a"], documentsById, "b");

    expect(result.selectedIds).toEqual(["a"]);
    expect(result.rejected).toEqual({ documentId: "b", reason: "MAX_TOTAL_PAGES" });
  });

  it("toggling an unknown id off is a no-op-safe removal", () => {
    const documentsById = new Map<string, SelectableDocument>();
    const result = toggleDocumentSelection(["ghost"], documentsById, "ghost");
    expect(result.selectedIds).toEqual([]);
  });
});
