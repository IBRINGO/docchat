"use client";

import { Loader2 } from "lucide-react";
import { DocumentListItem } from "@/components/documents/DocumentListItem";
import { EmptyDocumentsState } from "@/components/documents/EmptyDocumentsState";
import type { DocumentSummary } from "@/lib/services/document-list.service";

export interface DocumentListProps {
  documents: DocumentSummary[];
  isLoading: boolean;
  isFiltered: boolean;
  selectedIds: string[];
  canSelect: (document: DocumentSummary) => boolean;
  onToggle: (documentId: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-[68px] animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </ul>
  );
}

export function DocumentList({
  documents,
  isLoading,
  isFiltered,
  selectedIds,
  canSelect,
  onToggle,
  hasMore,
  onLoadMore,
}: DocumentListProps) {
  if (isLoading && documents.length === 0) {
    return <ListSkeleton />;
  }

  if (documents.length === 0) {
    return <EmptyDocumentsState isFiltered={isFiltered} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {documents.map((document) => (
          <DocumentListItem
            key={document.id}
            document={document}
            isSelected={selectedIds.includes(document.id)}
            isSelectable={canSelect(document)}
            onToggle={onToggle}
          />
        ))}
      </ul>

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Load more
        </button>
      ) : null}
    </div>
  );
}
