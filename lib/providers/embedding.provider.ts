import { embeddingConfigurationMismatchError } from "@/lib/providers/embedding-errors";

export type EmbeddingProviderName = "openai" | "gemini";

/** One text's embedding, always tagged with the exact provider/model/dimensions that produced it. */
export interface EmbeddingResult {
  vector: number[];
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
}

/**
 * The vector configuration a batch of embeddings was generated under. OpenAI
 * and Gemini vectors are never interchangeable — even at equal dimensions,
 * they live in different embedding spaces — so this is what the persistence
 * and retrieval layers must key their index/comparison logic on, not just
 * "dimensions" alone.
 */
export interface EmbeddingConfiguration {
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
}

export function toEmbeddingConfiguration(result: EmbeddingResult): EmbeddingConfiguration {
  return { provider: result.provider, model: result.model, dimensions: result.dimensions };
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  generateEmbedding(input: string): Promise<EmbeddingResult>;
  /** Batches internally; preserves input order; every result shares provider/model/dimensions. */
  generateEmbeddings(inputs: string[]): Promise<EmbeddingResult[]>;
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Verifies every result in a batch shares one provider/model/dimensions.
 * Shared by EmbeddingService (checking its own provider calls) and
 * DocumentIngestionService (checking whatever EmbeddingService it was given
 * returned) — the latter can't assume the former's internal guarantees hold
 * for an arbitrary injected implementation, so both call this explicitly.
 */
export function validateEmbeddingBatchConsistency(results: readonly EmbeddingResult[]): void {
  const [first, ...rest] = results;
  if (!first) return;

  for (const result of rest) {
    if (result.provider !== first.provider || result.model !== first.model || result.dimensions !== first.dimensions) {
      throw embeddingConfigurationMismatchError(
        `expected every result to be provider=${first.provider} model=${first.model} dimensions=${first.dimensions}, ` +
          `got provider=${result.provider} model=${result.model} dimensions=${result.dimensions}`,
      );
    }
  }
}
