import OpenAI from "openai";
import { requireOpenAiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { embeddingGenerationFailedError, embeddingResponseInvalidError } from "@/lib/providers/embedding-errors";
import { chunkArray } from "@/lib/providers/embedding.provider";
import type { EmbeddingProvider, EmbeddingResult } from "@/lib/providers/embedding.provider";

export const OPENAI_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Conservative request-level batch size. OpenAI allows up to 2048 inputs and
 * 300,000 tokens per embeddings request; at ~1000 chars (roughly 250-300
 * tokens) per chunk, 100 chunks per request stays comfortably under both
 * limits while still avoiding one-call-per-chunk overhead.
 */
const MAX_BATCH_SIZE = 100;

/** The slice of the OpenAI SDK this provider actually uses — small enough to fake directly in tests, no vi.mock needed. */
export interface OpenAiEmbeddingsClient {
  embeddings: {
    create: OpenAI["embeddings"]["create"];
  };
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai" as const;
  private client: OpenAiEmbeddingsClient | undefined;

  constructor(
    private readonly model: string = OPENAI_DEFAULT_EMBEDDING_MODEL,
    client?: OpenAiEmbeddingsClient,
  ) {
    this.client = client;
  }

  private getClient(): OpenAiEmbeddingsClient {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: requireOpenAiApiKey() });
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
        const response = await client.embeddings.create({ model: this.model, input: batch });

        if (response.data.length !== batch.length) {
          throw embeddingResponseInvalidError(
            this.name,
            `expected ${batch.length} embeddings, received ${response.data.length}`,
          );
        }

        // The API returns items tagged with their input index rather than a documented order
        // guarantee, so sort explicitly instead of trusting array position.
        const ordered = [...response.data].sort((a, b) => a.index - b.index);
        const dimensions = ordered[0]?.embedding.length ?? 0;

        for (const item of ordered) {
          if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
            throw embeddingResponseInvalidError(this.name, "received an empty embedding vector");
          }
          if (item.embedding.length !== dimensions) {
            throw embeddingResponseInvalidError(this.name, "received inconsistent embedding dimensions within a batch");
          }

          results.push({ vector: item.embedding, provider: this.name, model: response.model, dimensions });
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
