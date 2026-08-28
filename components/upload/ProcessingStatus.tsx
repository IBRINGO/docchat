"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * POST /api/upload does extraction, chunking, embedding, and persistence in
 * one request — the backend never reports intermediate progress. These
 * labels rotate on a fixed timer purely for reassurance during a request
 * that can take several seconds; they are NOT tied to real server-side
 * milestones and no percentage is ever implied.
 */
const STAGE_LABELS = ["Uploading document…", "Processing document…", "Preparing document for questions…"];
const STAGE_INTERVAL_MS = 2500;

export function ProcessingStatus() {
  const [labelIndex, setLabelIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((index) => Math.min(index + 1, STAGE_LABELS.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border border-zinc-200 px-8 py-14 text-center dark:border-zinc-800">
      <Loader2 className="h-8 w-8 animate-spin text-zinc-400" strokeWidth={1.5} />
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{STAGE_LABELS[labelIndex]}</p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">This can take a few seconds for larger documents.</p>
    </div>
  );
}
