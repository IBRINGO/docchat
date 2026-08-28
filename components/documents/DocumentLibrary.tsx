"use client";

import { DocumentSearch } from "@/components/documents/DocumentSearch";
import { DocumentFilters } from "@/components/documents/DocumentFilters";
import { DocumentList } from "@/components/documents/DocumentList";
import type { DocumentStatusFilter } from "@/hooks/useDocumentLibrary";
import type { DocumentSummary } from "@/lib/services/document-list.service";

export interface DocumentLibraryProps {
  documents: DocumentSummary[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: DocumentStatusFilter;
  onStatusFilterChange: (value: DocumentStatusFilter) => void;
  selectedIds: string[];
  canSelect: (document: DocumentSummary) => boolean;
  onToggle: (documentId: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function DocumentLibrary({
  documents,
  isLoading,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  selectedIds,
  canSelect,
  onToggle,
  hasMore,
  onLoadMore,
}: DocumentLibraryProps) {
  const isFiltered = search.trim().length > 0 || statusFilter !== "all";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">MY DOCUMENTS</h2>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <DocumentSearch value={search} onChange={onSearchChange} />
        <DocumentFilters value={statusFilter} onChange={onStatusFilterChange} />
      </div>

      <DocumentList
        documents={documents}
        isLoading={isLoading}
        isFiltered={isFiltered}
        selectedIds={selectedIds}
        canSelect={canSelect}
        onToggle={onToggle}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}
