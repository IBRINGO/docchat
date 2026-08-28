"use client";

import { useCallback, useMemo, useState } from "react";
import {
  calculateSelectionTotals,
  canSelectDocument,
  toggleDocumentSelection,
  type SelectableDocument,
  type SelectionLimitReason,
  type SelectionTotals,
} from "@/lib/validation/document-selection";
import type { DocumentSummary } from "@/lib/services/document-list.service";

export interface SelectionRejection {
  documentId: string;
  reason: SelectionLimitReason;
}

export interface UseDocumentSelectionResult {
  selectedIds: string[];
  totals: SelectionTotals;
  isSelected: (documentId: string) => boolean;
  canSelect: (document: DocumentSummary) => boolean;
  toggle: (documentId: string) => void;
  /** Directly replaces the selection — bypasses the usual add-one-at-a-time limit check, since this is for restoring an already-valid set (e.g. an existing conversation's document context), not a fresh user pick. */
  setSelection: (documentIds: string[]) => void;
  lastRejection: SelectionRejection | null;
  dismissRejection: () => void;
}

function toSelectable(document: DocumentSummary): SelectableDocument {
  return { id: document.id, status: document.status, size: document.size, pageCount: document.pageCount };
}

/**
 * Client-side multi-document selection state. All the actual limit logic
 * lives in lib/validation/document-selection.ts (pure, React-free); this
 * hook only adapts it to React state and to the DocumentSummary shape the
 * library fetches.
 */
export function useDocumentSelection(documents: readonly DocumentSummary[]): UseDocumentSelectionResult {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastRejection, setLastRejection] = useState<SelectionRejection | null>(null);

  const documentsById = useMemo(() => {
    const map = new Map<string, SelectableDocument>();
    for (const document of documents) map.set(document.id, toSelectable(document));
    return map;
  }, [documents]);

  const toggle = useCallback(
    (documentId: string) => {
      setLastRejection(null);
      setSelectedIds((current) => {
        const result = toggleDocumentSelection(current, documentsById, documentId);
        if (result.rejected) setLastRejection(result.rejected);
        return result.selectedIds;
      });
    },
    [documentsById],
  );

  const totals = useMemo(() => {
    const selected = selectedIds.map((id) => documentsById.get(id)).filter((doc): doc is SelectableDocument => doc !== undefined);
    return calculateSelectionTotals(selected);
  }, [selectedIds, documentsById]);

  const isSelected = useCallback((documentId: string) => selectedIds.includes(documentId), [selectedIds]);
  const canSelect = useCallback((document: DocumentSummary) => canSelectDocument(document), []);
  const dismissRejection = useCallback(() => setLastRejection(null), []);
  const setSelection = useCallback((documentIds: string[]) => {
    setLastRejection(null);
    setSelectedIds(documentIds);
  }, []);

  return { selectedIds, totals, isSelected, canSelect, toggle, setSelection, lastRejection, dismissRejection };
}
