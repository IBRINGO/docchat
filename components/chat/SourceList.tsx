"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export interface SourceListProps {
  sources: RetrievedChunk[];
}

const EXCERPT_MAX_LENGTH = 220;

function truncate(content: string): string {
  return content.length > EXCERPT_MAX_LENGTH ? `${content.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…` : content;
}

/** Secondary, collapsible display of the chunks a given answer was grounded on. Never renders embeddings or any other internal field — only what a reader needs to judge the answer. */
export function SourceList({ sources }: SourceListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")} />
        Sources ({sources.length})
      </button>

      {isExpanded ? (
        <ul className="mt-2 flex flex-col gap-2">
          {sources.map((source) => (
            <li
              key={source.id}
              className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-zinc-500 dark:text-zinc-400">
                <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">{source.documentName}</span>
                <span className="shrink-0">Similarity: {source.score.toFixed(2)}</span>
              </div>
              <div className="mb-1 text-zinc-500 dark:text-zinc-400">{source.pageNumber !== null ? `Page ${source.pageNumber}` : "Page unknown"}</div>
              <p className="text-zinc-700 dark:text-zinc-300">&ldquo;{truncate(source.content)}&rdquo;</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
