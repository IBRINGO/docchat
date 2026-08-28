import { AppError } from "@/lib/utils/errors";

export function llmProviderNotConfiguredError(provider: string): AppError {
  return new AppError({
    code: "AI_PROVIDER_NOT_CONFIGURED",
    message: `No API key is configured for the ${provider} answer-generation provider.`,
    status: 503,
  });
}

export function llmGenerationFailedError(provider: string, cause: unknown): AppError {
  return new AppError({
    code: "LLM_GENERATION_FAILED",
    message: `Answer generation failed via the ${provider} provider.`,
    status: 502,
    cause,
  });
}
