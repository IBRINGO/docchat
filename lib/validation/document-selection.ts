import { MAX_ACTIVE_SELECTION_TOTAL_PAGES, MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES } from "@/lib/config/document-limits";
import type { DocumentStatus } from "@/types/document";

/**
 * The minimal shape this module needs from a document to validate a
 * selection. Deliberately narrow (not the full DocumentSummary/Document
 * type) so this stays reusable from anywhere a document-like object with
 * these four fields exists — frontend state, tests, or a future API-side
 * validation pass.
 */
export interface SelectableDocument {
  id: string;
  status: DocumentStatus;
  size: number;
  pageCount: number | null;
}

export type SelectionLimitReason = "MAX_TOTAL_SIZE" | "MAX_TOTAL_PAGES" | "MAX_TOTAL_SIZE_AND_PAGES";

export interface SelectionTotals {
  size: number;
  pages: number;
}

export interface SelectionValidationResult {
  valid: boolean;
  reason?: SelectionLimitReason;
  totals: SelectionTotals;
}

export interface ToggleSelectionResult {
  selectedIds: string[];
  /** Set only when toggling ON a document was attempted but rejected — the returned selectedIds are unchanged from the input in that case. */
  rejected?: { documentId: string; reason: SelectionLimitReason };
}

/** Only a "ready" document may ever be selected — matches the same status the chat/retrieval pipeline requires. */
export function canSelectDocument(document: Pick<SelectableDocument, "status">): boolean {
  return document.status === "ready";
}

export function calculateSelectionTotals(documents: readonly SelectableDocument[]): SelectionTotals {
  return documents.reduce(
    (totals, doc) => ({ size: totals.size + doc.size, pages: totals.pages + (doc.pageCount ?? 0) }),
    { size: 0, pages: 0 },
  );
}

/**
 * Validates whether a complete set of documents stays within the cumulative
 * selection limits (see lib/config/document-limits.ts). Pure and
 * framework-free: used both by the frontend selection hook (indirectly, via
 * validateSelectionLimits below) and directly by the backend chat/retrieval
 * pipeline, which must re-validate the limits server-side rather than trust
 * the client's own selection UI.
 */
export function validateSelectionSet(documents: readonly SelectableDocument[]): SelectionValidationResult {
  const totals = calculateSelectionTotals(documents);

  const exceedsSize = totals.size > MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES;
  const exceedsPages = totals.pages > MAX_ACTIVE_SELECTION_TOTAL_PAGES;

  if (exceedsSize && exceedsPages) return { valid: false, reason: "MAX_TOTAL_SIZE_AND_PAGES", totals };
  if (exceedsSize) return { valid: false, reason: "MAX_TOTAL_SIZE", totals };
  if (exceedsPages) return { valid: false, reason: "MAX_TOTAL_PAGES", totals };
  return { valid: true, totals };
}

/**
 * Validates whether `currentSelection` plus `candidate` together stay within
 * the cumulative selection limits. Pure and framework-free: reused by the
 * selection hook.
 */
export function validateSelectionLimits(
  currentSelection: readonly SelectableDocument[],
  candidate: SelectableDocument,
): SelectionValidationResult {
  return validateSelectionSet([...currentSelection, candidate]);
}

/**
 * Toggles `targetId` in/out of `selectedIds`. Turning a selection OFF always
 * succeeds. Turning one ON is rejected — leaving `selectedIds` unchanged,
 * with `rejected` describing why — when the document isn't selectable
 * (status !== "ready") or when adding it would exceed the cumulative limits.
 */
export function toggleDocumentSelection(
  selectedIds: readonly string[],
  documentsById: ReadonlyMap<string, SelectableDocument>,
  targetId: string,
): ToggleSelectionResult {
  if (selectedIds.includes(targetId)) {
    return { selectedIds: selectedIds.filter((id) => id !== targetId) };
  }

  const target = documentsById.get(targetId);
  if (!target || !canSelectDocument(target)) {
    return { selectedIds: [...selectedIds] };
  }

  const currentSelection = selectedIds
    .map((id) => documentsById.get(id))
    .filter((doc): doc is SelectableDocument => doc !== undefined);

  const validation = validateSelectionLimits(currentSelection, target);
  if (!validation.valid) {
    return { selectedIds: [...selectedIds], rejected: { documentId: targetId, reason: validation.reason! } };
  }

  return { selectedIds: [...selectedIds, targetId] };
}
