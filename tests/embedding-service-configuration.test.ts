import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAppError } from "@/lib/utils/errors";

let openaiConfigured = true;
let geminiConfigured = true;

vi.mock("@/lib/config/env", () => ({
  hasOpenAiApiKey: () => openaiConfigured,
  hasGeminiApiKey: () => geminiConfigured,
  requireOpenAiApiKey: () => "test-openai-key",
  requireGeminiApiKey: () => "test-gemini-key",
}));

const { OpenAiEmbeddingProviderMock, openaiGenerateEmbedding, GeminiEmbeddingProviderMock, geminiGenerateEmbedding } = vi.hoisted(
  () => {
    const openaiGenerateEmbedding = vi.fn();
    const geminiGenerateEmbedding = vi.fn();
    return {
      openaiGenerateEmbedding,
      geminiGenerateEmbedding,
      // Arrow functions have no [[Construct]] slot and can't back a `new`-called mock;
      // these must be plain `function` expressions even though they ignore their args.
      OpenAiEmbeddingProviderMock: vi.fn().mockImplementation(function openaiCtor() {
        return { name: "openai", generateEmbedding: openaiGenerateEmbedding, generateEmbeddings: vi.fn() };
      }),
      GeminiEmbeddingProviderMock: vi.fn().mockImplementation(function geminiCtor() {
        return { name: "gemini", generateEmbedding: geminiGenerateEmbedding, generateEmbeddings: vi.fn() };
      }),
    };
  },
);

vi.mock("@/lib/providers/openai-embedding.provider", () => ({
  OpenAiEmbeddingProvider: OpenAiEmbeddingProviderMock,
}));
vi.mock("@/lib/providers/gemini-embedding.provider", () => ({
  GeminiEmbeddingProvider: GeminiEmbeddingProviderMock,
}));

import { EmbeddingService } from "@/lib/services/embedding.service";

/** EmbeddingService's own constructor defaults construct one of each provider (primary/fallback); clear that noise before asserting on calls made by the method under test. */
function freshService(): EmbeddingService {
  const service = new EmbeddingService();
  OpenAiEmbeddingProviderMock.mockClear();
  GeminiEmbeddingProviderMock.mockClear();
  return service;
}

beforeEach(() => {
  openaiConfigured = true;
  geminiConfigured = true;
  openaiGenerateEmbedding.mockReset();
  geminiGenerateEmbedding.mockReset();
});

describe("EmbeddingService.generateEmbeddingForConfiguration", () => {
  it("uses an OpenAI provider pinned to the exact model for an openai-configured document, never Gemini", async () => {
    openaiGenerateEmbedding.mockResolvedValue({
      vector: [0.1, 0.2],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 2,
    });

    const service = freshService();
    const result = await service.generateEmbeddingForConfiguration("What are the objectives?", {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 2,
    });

    expect(OpenAiEmbeddingProviderMock).toHaveBeenCalledWith("text-embedding-3-small");
    expect(GeminiEmbeddingProviderMock).not.toHaveBeenCalled();
    expect(openaiGenerateEmbedding).toHaveBeenCalledWith("What are the objectives?");
    expect(result.provider).toBe("openai");
  });

  it("uses a Gemini provider pinned to the exact model/dimensions for a gemini-configured document, never OpenAI", async () => {
    geminiGenerateEmbedding.mockResolvedValue({
      vector: [0.1, 0.2, 0.3],
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 3,
    });

    const service = freshService();
    const result = await service.generateEmbeddingForConfiguration("What are the objectives?", {
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 3,
    });

    expect(GeminiEmbeddingProviderMock).toHaveBeenCalledWith("gemini-embedding-2", 3);
    expect(OpenAiEmbeddingProviderMock).not.toHaveBeenCalled();
    expect(geminiGenerateEmbedding).toHaveBeenCalledWith("What are the objectives?");
    expect(result.provider).toBe("gemini");
  });

  it("throws EMBEDDING_CONFIGURATION_MISMATCH when the provider returns a different configuration than requested", async () => {
    openaiGenerateEmbedding.mockResolvedValue({
      vector: [0.1],
      provider: "openai",
      model: "some-unexpected-model",
      dimensions: 1,
    });

    const service = freshService();
    await expect(
      service.generateEmbeddingForConfiguration("hello", {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISMATCH");
  });

  it("throws AI_PROVIDER_NOT_CONFIGURED without constructing a provider when the required key is missing", async () => {
    openaiConfigured = false;
    const service = freshService();

    await expect(
      service.generateEmbeddingForConfiguration("hello", {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED");

    expect(OpenAiEmbeddingProviderMock).not.toHaveBeenCalled();
  });

  it("rejects an empty/whitespace-only query without constructing a provider", async () => {
    const service = freshService();

    await expect(
      service.generateEmbeddingForConfiguration("   ", {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 2,
      }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "EMBEDDING_INVALID_INPUT");

    expect(OpenAiEmbeddingProviderMock).not.toHaveBeenCalled();
  });
});
