import { hasGeminiApiKey, hasOpenAiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isRecoverableProviderError } from "@/lib/providers/recoverable-provider-error";
import {
  aiProviderNotConfiguredError,
  embeddingConfigurationMismatchError,
  embeddingInvalidInputError,
  unsupportedEmbeddingConfigurationError,
} from "@/lib/providers/embedding-errors";
import { OpenAiEmbeddingProvider } from "@/lib/providers/openai-embedding.provider";
import { GeminiEmbeddingProvider } from "@/lib/providers/gemini-embedding.provider";
import { validateEmbeddingBatchConsistency } from "@/lib/providers/embedding.provider";
import type { EmbeddingConfiguration, EmbeddingProvider, EmbeddingResult } from "@/lib/providers/embedding.provider";

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
 * Constructs a provider instance pinned to an exact model (and, for Gemini,
 * output dimensionality) rather than provider defaults. Used only for
 * configuration-aware embedding, where the caller needs the SAME embedding
 * space a document was originally embedded in — never "whichever provider
 * happens to be primary right now".
 */
function createProviderForConfiguration(configuration: EmbeddingConfiguration): EmbeddingProvider {
  switch (configuration.provider) {
    case "openai":
      return new OpenAiEmbeddingProvider(configuration.model);
    case "gemini":
      return new GeminiEmbeddingProvider(configuration.model, configuration.dimensions);
    default:
      throw unsupportedEmbeddingConfigurationError(configuration.provider);
  }
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

  /**
   * Generates a single embedding using an EXACT provider/model/dimensions —
   * no fallback. For retrieval, where the query embedding must land in the
   * same vector space a specific document was already embedded in, silently
   * falling back to a different provider would produce a vector that's
   * incompatible with that document's stored chunks.
   */
  async generateEmbeddingForConfiguration(input: string, configuration: EmbeddingConfiguration): Promise<EmbeddingResult> {
    validateInputs([input]);

    const available = configuration.provider === "openai" ? hasOpenAiApiKey() : hasGeminiApiKey();
    if (!available) {
      throw aiProviderNotConfiguredError(configuration.provider);
    }

    const provider = createProviderForConfiguration(configuration);
    const result = await provider.generateEmbedding(input);

    if (result.provider !== configuration.provider || result.model !== configuration.model || result.dimensions !== configuration.dimensions) {
      throw embeddingConfigurationMismatchError(
        `expected provider=${configuration.provider} model=${configuration.model} dimensions=${configuration.dimensions}, ` +
          `got provider=${result.provider} model=${result.model} dimensions=${result.dimensions}`,
      );
    }

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
