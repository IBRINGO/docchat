"use client";

import { useCallback, useEffect, useState } from "react";
import { listDocuments, ApiError } from "@/lib/client/api";
import type { DocumentSummary } from "@/lib/services/document-list.service";

export type DocumentStatusFilter = "all" | "processing" | "ready" | "failed";

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export interface UseDocumentLibraryResult {
  documents: DocumentSummary[];
  isLoading: boolean;
  errorMessage: string | null;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: DocumentStatusFilter;
  setStatusFilter: (value: DocumentStatusFilter) => void;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-fetches page 1 with the current search/filter — call after a document finishes uploading. */
  refresh: () => void;
}

/** Owns the document library's list state: debounced search, status filter, and simple "load more" pagination against GET /api/documents. */
export function useDocumentLibrary(): UseDocumentLibraryResult {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilterState] = useState<DocumentStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  // Debounces `search` into `debouncedSearch`, resetting to page 1 once the settled value
  // actually changes (not per keystroke) — both updates happen inside the timer callback,
  // not synchronously in the effect body, so they don't cascade extra renders on mount.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await listDocuments({
          q: debouncedSearch || undefined,
          status: statusFilter === "all" ? undefined : statusFilter,
          page,
          limit: PAGE_LIMIT,
        });
        if (cancelled) return;
        setDocuments((previous) => (page === 1 ? result.documents : [...previous, ...result.documents]));
        setTotalPages(result.pagination.totalPages);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiError ? error.message : "The document library could not be loaded.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, statusFilter, page, refreshToken]);

  const setStatusFilter = useCallback((value: DocumentStatusFilter) => {
    setStatusFilterState(value);
    setPage(1);
  }, []);

  const loadMore = useCallback(() => {
    setPage((current) => (current < totalPages ? current + 1 : current));
  }, [totalPages]);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
    setPage(1);
  }, []);

  return {
    documents,
    isLoading,
    errorMessage,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    hasMore: page < totalPages,
    loadMore,
    refresh,
  };
}
