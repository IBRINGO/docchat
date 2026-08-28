import { GoogleGenAI } from "@google/genai";
import { requireGeminiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { embeddingGenerationFailedError, embeddingResponseInvalidError } from "@/lib/providers/embedding-errors";
import { chunkArray } from "@/lib/providers/embedding.provider";
import type { EmbeddingProvider, EmbeddingResult } from "@/lib/providers/embedding.provider";

/**
 * `gemini-embedding-2` (stable, GA on the Gemini Developer API) rather than
 * `gemini-embedding-001`: it is the current-generation model, has a larger
 * 8,192-token input limit (vs. 2,048), and auto-normalizes truncated output
 * vectors. Its embedding space is NOT compatible with gemini-embedding-001's
 * or with any OpenAI model's — this is only ever used as a whole-batch
 * fallback, never mixed with OpenAI vectors (see EmbeddingService).
 */
export const GEMINI_DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";

/**
 * Truncated via Matryoshka representation learning from the model's 3072-dim
 * default. 1536 keeps vector storage/index cost reasonable for a fallback
 * path while remaining one of Google's explicitly recommended dimensions.
 */
export const GEMINI_DEFAULT_OUTPUT_DIMENSIONS = 1536;

/** Kept in line with the OpenAI provider's batch size; the Gemini API has no documented higher limit that would justify a larger request. */
const MAX_BATCH_SIZE = 100;

/** The slice of the Gemini SDK this provider actually uses — small enough to fake directly in tests, no vi.mock needed. */
export interface GeminiEmbeddingsClient {
  models: {
    embedContent: GoogleGenAI["models"]["embedContent"];
  };
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini" as const;
  private client: GeminiEmbeddingsClient | undefined;

  constructor(
    private readonly model: string = GEMINI_DEFAULT_EMBEDDING_MODEL,
    private readonly outputDimensionality: number = GEMINI_DEFAULT_OUTPUT_DIMENSIONS,
    client?: GeminiEmbeddingsClient,
  ) {
    this.client = client;
  }

  private getClient(): GeminiEmbeddingsClient {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
    }
    return this.client;
  }

  async generateEmbedding(input: string): Promise<EmbeddingResult> {
    const [result] = await this.generateEmbeddings([input]);
    return result;
  }

  async generateEmbeddings(inputs: string[]): Promise<EmbeddingResult[]> {
    const startedAt = Date.now();
    logger.info("embedding_generation_started", {
      provider: this.name,
      model: this.model,
      inputCount: inputs.length,
    });

    try {
      const client = this.getClient();
      const results: EmbeddingResult[] = [];

      for (const batch of chunkArray(inputs, MAX_BATCH_SIZE)) {
        const response = await client.models.embedContent({
          model: this.model,
          // Each text must be its own Content object. A bare string[] is NOT
          // "one embedding per string" the way OpenAI's `input: string[]`
          // is — empirically (verified against the real API) it gets
          // collapsed into a single embedding for the whole array, as if
          // every string were one multi-part input.
          contents: batch.map((text) => ({ parts: [{ text }] })),
          config: { outputDimensionality: this.outputDimensionality },
        });

        const embeddings = response.embeddings ?? [];
        if (embeddings.length !== batch.length) {
          throw embeddingResponseInvalidError(
            this.name,
            `expected ${batch.length} embeddings, received ${embeddings.length}`,
          );
        }

        const dimensions = embeddings[0]?.values?.length ?? 0;

        for (const item of embeddings) {
          const vector = item.values;
          if (!vector || vector.length === 0) {
            throw embeddingResponseInvalidError(this.name, "received an empty embedding vector");
          }
          if (vector.length !== dimensions) {
            throw embeddingResponseInvalidError(this.name, "received inconsistent embedding dimensions within a batch");
          }

          results.push({ vector, provider: this.name, model: this.model, dimensions });
        }
      }

      logger.info("embedding_generation_completed", {
        provider: this.name,
        model: this.model,
        inputCount: inputs.length,
        dimensions: results[0]?.dimensions,
        durationMs: Date.now() - startedAt,
      });

      return results;
    } catch (error) {
      logger.error("embedding_generation_failed", { provider: this.name, model: this.model, error });
      if (isAppError(error)) throw error;
      throw embeddingGenerationFailedError(this.name, error);
    }
  }
}
