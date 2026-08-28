"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SourceCard } from "@/components/chat/SourceCard";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export interface SourceListProps {
  sources: RetrievedChunk[];
}

/** Secondary, collapsible display of the chunks a given answer was grounded on. Never renders embeddings or any other internal field — only what a reader needs to judge the answer. */
export function SourceList({ sources }: SourceListProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const listId = useId();

  if (sources.length === 0) return null;

  return (
    <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        aria-controls={listId}
        className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
        Sources ({sources.length})
      </button>

      {isExpanded ? (
        <ul id={listId} className="animate-fade-in mt-2 flex flex-col gap-2">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
