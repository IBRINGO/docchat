"use client";

import { useId, useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { getRelevancePresentation } from "@/lib/utils/relevance";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export interface SourceCardProps {
  source: RetrievedChunk;
}

const EXCERPT_MAX_LENGTH = 220;

const TIER_BADGE_CLASS: Record<ReturnType<typeof getRelevancePresentation>["tier"], string> = {
  strong: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  relevant: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  lower: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
};

/**
 * One retrieved chunk: document/page, a relevance badge derived from the
 * Atlas vector score (never framed as a probability — see lib/utils/relevance.ts),
 * a truncated excerpt, and a "View full source" toggle that expands the
 * complete chunk text in place. An inline expandable panel (rather than a
 * portal-based popover/modal) keeps this fully keyboard-accessible for free
 * — it's a plain <button> with aria-expanded, no focus trap or Escape
 * handling to get right, and it works identically with click/tap on both
 * desktop and mobile.
 */
export function SourceCard({ source }: SourceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();
  const relevance = getRelevancePresentation(source.score);
  const isTruncated = source.content.length > EXCERPT_MAX_LENGTH;
  const excerpt = isTruncated && !isExpanded ? `${source.content.slice(0, EXCERPT_MAX_LENGTH).trimEnd()}…` : source.content;

  return (
    <li className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs transition-colors dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
          <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <span className="truncate" title={source.documentName}>
            {source.documentName}
          </span>
        </span>
        <span
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-medium", TIER_BADGE_CLASS[relevance.tier])}
          title={`Similarity score: ${source.score.toFixed(3)} (not a probability of correctness)`}
        >
          {relevance.label} · {relevance.percent}%
        </span>
      </div>

      <div className="mb-1.5 text-zinc-500 dark:text-zinc-400">{source.pageNumber !== null ? `Page ${source.pageNumber}` : "Page unknown"}</div>

      <p id={contentId} className={cn("text-zinc-700 dark:text-zinc-300", isExpanded && "max-h-56 overflow-y-auto")}>
        &ldquo;{excerpt}&rdquo;
      </p>

      {isTruncated ? (
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          aria-controls={contentId}
          className="mt-1.5 flex items-center gap-1 text-[0.7rem] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
          {isExpanded ? "Show less" : "View full source"}
        </button>
      ) : null}
    </li>
  );
}
