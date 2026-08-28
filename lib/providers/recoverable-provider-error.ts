import OpenAI from "openai";
import { ApiError as GeminiApiError } from "@google/genai";
import { isAppError } from "@/lib/utils/errors";

/**
 * Recoverable = worth retrying against a fallback provider: rate limiting,
 * transient network failures, or a provider-side 5xx. NOT recoverable = bad
 * input, an unconfigured/invalid key, or any other 4xx — those are local
 * problems a different provider won't fix, and that fallback would only
 * mask. Shared by EmbeddingService and AnswerGenerationService — both call
 * OpenAI and Gemini SDKs and need identical recoverability rules.
 */
export function isRecoverableProviderError(error: unknown): boolean {
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
