/**
 * Presentation-only helpers for turning an Atlas `vectorSearchScore`
 * (0–1, cosine similarity — see lib/db/vector-search.ts) into something a
 * reader can scan at a glance. Deliberately not framed as a probability or a
 * factual-confidence measure — it's a similarity ranking signal, nothing
 * more. Thresholds below are a reasonable, restrained bucketing for display
 * only; they are not scientifically calibrated against any labeled data, and
 * no part of the retrieval/ranking pipeline (lib/services/retrieval.service.ts)
 * depends on them — moving a boundary here only changes a label's color/text,
 * never which chunks are retrieved or how they're ordered.
 */

export type RelevanceTier = "strong" | "relevant" | "lower";

export interface RelevancePresentation {
  /** 0–100, rounded. */
  percent: number;
  tier: RelevanceTier;
  label: string;
}

const STRONG_THRESHOLD = 0.75;
const RELEVANT_THRESHOLD = 0.5;

const TIER_LABEL: Record<RelevanceTier, string> = {
  strong: "Strong match",
  relevant: "Relevant match",
  lower: "Lower match",
};

export function classifyRelevance(score: number): RelevanceTier {
  if (score >= STRONG_THRESHOLD) return "strong";
  if (score >= RELEVANT_THRESHOLD) return "relevant";
  return "lower";
}

export function formatRelevancePercent(score: number): number {
  return Math.round(Math.min(1, Math.max(0, score)) * 100);
}

export function getRelevancePresentation(score: number): RelevancePresentation {
  const tier = classifyRelevance(score);
  return { percent: formatRelevancePercent(score), tier, label: TIER_LABEL[tier] };
}
