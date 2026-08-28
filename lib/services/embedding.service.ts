import OpenAI from "openai";
import { ApiError as GeminiApiError } from "@google/genai";
import { hasGeminiApiKey, hasOpenAiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { aiProviderNotConfiguredError, embeddingInvalidInputError } from "@/lib/providers/embedding-errors";
import { OpenAiEmbeddingProvider } from "@/lib/providers/openai-embedding.provider";
import { GeminiEmbeddingProvider } from "@/lib/providers/gemini-embedding.provider";
import { validateEmbeddingBatchConsistency } from "@/lib/providers/embedding.provider";
import type { EmbeddingProvider, EmbeddingResult } from "@/lib/providers/embedding.provider";

function isProviderConfigured(provider: EmbeddingProvider): boolean {
  if (provider.name === "openai") return hasOpenAiApiKey();
  if (provider.name === "gemini") return hasGeminiApiKey();
  return true;
}

function validateInputs(inputs: string[]): void {
  if (inputs.length === 0) {
    throw embeddingInvalidInputError("inputs must be a non-empty array");
  }
  if (inputs.some((input) => input.trim().length === 0)) {
    throw embeddingInvalidInputError("inputs must not contain empty or whitespace-only strings");
  }
}

/**
 * Recoverable = worth retrying against the fallback provider: rate limiting,
 * transient network failures, or a provider-side 5xx. NOT recoverable = bad
 * input, an unconfigured/invalid key, or any other 4xx — those are local
 * problems that a different provider won't fix and that fallback would only
 * mask.
 */
function isRecoverableProviderError(error: unknown): boolean {
  const cause = isAppError(error) ? error.cause : error;

  if (cause instanceof OpenAI.APIConnectionError) return true;
  if (cause instanceof OpenAI.APIError) {
    return cause.status === 429 || (typeof cause.status === "number" && cause.status >= 500);
  }

  if (cause instanceof GeminiApiError) {
    return cause.status === 429 || cause.status >= 500;
  }

  return false;
}

/**
 * Generates embeddings via Gemini (primary), falling back to OpenAI only on
 * a recoverable failure (see isRecoverableProviderError). Every result in a
 * returned batch is guaranteed to share one provider/model/dimensions —
 * never a mix of OpenAI and Gemini vectors.
 */
export class EmbeddingService {
  constructor(
    private readonly primary: EmbeddingProvider = new GeminiEmbeddingProvider(),
    private readonly fallback: EmbeddingProvider = new OpenAiEmbeddingProvider(),
  ) {}

  async generateEmbedding(input: string): Promise<EmbeddingResult> {
    const [result] = await this.generateEmbeddings([input]);
    return result;
  }

  async generateEmbeddings(inputs: string[]): Promise<EmbeddingResult[]> {
    validateInputs(inputs);

    const primaryAvailable = isProviderConfigured(this.primary);
    const fallbackAvailable = isProviderConfigured(this.fallback);

    if (!primaryAvailable && !fallbackAvailable) {
      throw aiProviderNotConfiguredError("gemini/openai");
    }

    if (primaryAvailable) {
      try {
        const results = await this.primary.generateEmbeddings(inputs);
        validateEmbeddingBatchConsistency(results);
        return results;
      } catch (error) {
        // fallbackAvailable is guaranteed true past this point: the guard above
        // already ruled out both being unavailable, so if primaryAvailable is
        // true, either fallbackAvailable is true or we throw right here.
        if (!fallbackAvailable || !isRecoverableProviderError(error)) {
          throw error;
        }
        logger.warn("embedding_fallback_triggered", {
          provider: this.primary.name,
          fallbackProvider: this.fallback.name,
          inputCount: inputs.length,
        });
      }
    }

    const fallbackResults = await this.fallback.generateEmbeddings(inputs);
    validateEmbeddingBatchConsistency(fallbackResults);
    return fallbackResults;
  }
}

let cachedService: EmbeddingService | undefined;

export function getEmbeddingService(): EmbeddingService {
  if (!cachedService) {
    cachedService = new EmbeddingService();
  }
  return cachedService;
}
