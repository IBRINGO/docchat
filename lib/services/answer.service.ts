import { hasGeminiApiKey, hasOpenAiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isRecoverableProviderError } from "@/lib/providers/recoverable-provider-error";
import { llmProviderNotConfiguredError } from "@/lib/providers/llm-errors";
import { OpenAiLlmProvider } from "@/lib/providers/openai-llm.provider";
import { GeminiLlmProvider } from "@/lib/providers/gemini-llm.provider";
import type { AnswerPromptInput, LLMProvider, LLMProviderName } from "@/lib/providers/llm.provider";

export interface AnswerStream {
  provider: LLMProviderName;
  model: string;
  chunks: AsyncGenerator<string>;
}

function isProviderConfigured(provider: LLMProvider): boolean {
  if (provider.name === "openai") return hasOpenAiApiKey();
  if (provider.name === "gemini") return hasGeminiApiKey();
  return true;
}

type FirstChunkResult =
  | { ok: true; result: IteratorResult<string> }
  | { ok: false; error: unknown };

/** Pulls exactly one item from the generator, converting a thrown error into a tagged result instead of letting it propagate — so the caller can decide whether to fall back before any output has been committed. */
async function pullFirstChunk(generator: AsyncGenerator<string>): Promise<FirstChunkResult> {
  try {
    const result = await generator.next();
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Replays an already-pulled first result, then continues draining the same generator. Never re-enters the generator that produced `first` from a different call site, so output always comes from exactly one provider. */
async function* continueFrom(first: IteratorResult<string>, generator: AsyncGenerator<string>): AsyncGenerator<string> {
  if (first.done) return;
  yield first.value;
  yield* generator;
}

/**
 * Generates a streamed answer via Gemini (primary), falling back to OpenAI
 * only if the primary fails before producing any output AND the failure is
 * recoverable (see isRecoverableProviderError) — mirrors EmbeddingService's
 * fallback contract, adapted for streaming. Once a provider has yielded its
 * first chunk, the returned stream is committed to that provider: a failure
 * later in the same stream propagates as-is rather than silently switching
 * providers mid-answer, which would otherwise risk concatenating two
 * different models' output into one response.
 */
export class AnswerGenerationService {
  constructor(
    private readonly primary: LLMProvider = new GeminiLlmProvider(),
    private readonly fallback: LLMProvider = new OpenAiLlmProvider(),
  ) {}

  hasAnyProviderConfigured(): boolean {
    return isProviderConfigured(this.primary) || isProviderConfigured(this.fallback);
  }

  async streamAnswer(input: AnswerPromptInput): Promise<AnswerStream> {
    const primaryAvailable = isProviderConfigured(this.primary);
    const fallbackAvailable = isProviderConfigured(this.fallback);

    if (!primaryAvailable && !fallbackAvailable) {
      throw llmProviderNotConfiguredError("gemini/openai");
    }

    if (primaryAvailable) {
      const generator = this.primary.streamAnswer(input);
      const first = await pullFirstChunk(generator);

      if (first.ok) {
        return { provider: this.primary.name, model: this.primary.model, chunks: continueFrom(first.result, generator) };
      }

      // fallbackAvailable is guaranteed true past this point: the guard above already
      // ruled out both being unavailable, so if primaryAvailable is true, either
      // fallbackAvailable is true or we throw right here — no output was ever produced.
      if (!fallbackAvailable || !isRecoverableProviderError(first.error)) {
        throw first.error;
      }
      logger.warn("llm_fallback_triggered", { provider: this.primary.name, fallbackProvider: this.fallback.name });
    }

    return { provider: this.fallback.name, model: this.fallback.model, chunks: this.fallback.streamAnswer(input) };
  }
}

let cachedService: AnswerGenerationService | undefined;

export function getAnswerGenerationService(): AnswerGenerationService {
  if (!cachedService) {
    cachedService = new AnswerGenerationService();
  }
  return cachedService;
}
