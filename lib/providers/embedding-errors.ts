import { AppError } from "@/lib/utils/errors";

export function aiProviderNotConfiguredError(provider: string): AppError {
  return new AppError({
    code: "AI_PROVIDER_NOT_CONFIGURED",
    message: `No API key is configured for the ${provider} embedding provider.`,
    status: 503,
  });
}

export function embeddingInvalidInputError(reason: string): AppError {
  return new AppError({
    code: "EMBEDDING_INVALID_INPUT",
    message: `Invalid embedding input: ${reason}`,
    status: 400,
  });
}

export function embeddingGenerationFailedError(provider: string, cause: unknown): AppError {
  return new AppError({
    code: "EMBEDDING_GENERATION_FAILED",
    message: `Embedding generation failed via the ${provider} provider.`,
    status: 502,
    cause,
  });
}

export function embeddingResponseInvalidError(provider: string, reason: string): AppError {
  return new AppError({
    code: "EMBEDDING_RESPONSE_INVALID",
    message: `The ${provider} provider returned an invalid embedding response: ${reason}`,
    status: 502,
  });
}

export function embeddingConfigurationMismatchError(reason: string): AppError {
  return new AppError({
    code: "EMBEDDING_CONFIGURATION_MISMATCH",
    message: `Embedding batch has inconsistent provider/model/dimensions: ${reason}`,
    status: 500,
  });
}
