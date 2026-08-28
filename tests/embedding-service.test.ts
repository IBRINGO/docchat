import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { EmbeddingService } from "@/lib/services/embedding.service";
import { AppError, isAppError } from "@/lib/utils/errors";
import type { EmbeddingProvider, EmbeddingResult } from "@/lib/providers/embedding.provider";

let openaiConfigured = true;
let geminiConfigured = true;

vi.mock("@/lib/config/env", () => ({
  hasOpenAiApiKey: () => openaiConfigured,
  hasGeminiApiKey: () => geminiConfigured,
}));

beforeEach(() => {
  openaiConfigured = true;
  geminiConfigured = true;
});

function resultsFor(provider: "openai" | "gemini", model: string, dimensions: number, inputs: string[]): EmbeddingResult[] {
  return inputs.map((_, i) => ({ vector: Array(dimensions).fill(i), provider, model, dimensions }));
}

function stubProvider(
  name: "openai" | "gemini",
  impl: (inputs: string[]) => Promise<EmbeddingResult[]>,
): EmbeddingProvider {
  return {
    name,
    generateEmbedding: async (input) => (await impl([input]))[0],
    generateEmbeddings: vi.fn(impl),
  };
}

const recoverableError = () =>
  new AppError({
    code: "EMBEDDING_GENERATION_FAILED",
    message: "network blip",
    status: 502,
    cause: new OpenAI.APIConnectionError({ message: "network blip" }),
  });

const nonRecoverableError = () =>
  new AppError({
    code: "EMBEDDING_GENERATION_FAILED",
    message: "bad request",
    status: 502,
    cause: new OpenAI.APIError(400, {}, "Bad Request", new Headers()),
  });

describe("EmbeddingService", () => {
  it("uses the primary provider on success and never calls the fallback", async () => {
    const openai = stubProvider("openai", async (inputs) => resultsFor("openai", "text-embedding-3-small", 3, inputs));
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));

    const service = new EmbeddingService(openai, gemini);
    const results = await service.generateEmbeddings(["a", "b"]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.provider === "openai" && r.model === "text-embedding-3-small")).toBe(true);
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("falls back to gemini on a recoverable primary failure, returning only gemini vectors", async () => {
    const openai = stubProvider("openai", async () => {
      throw recoverableError();
    });
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));

    const service = new EmbeddingService(openai, gemini);
    const results = await service.generateEmbeddings(["a", "b"]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.provider === "gemini" && r.dimensions === 1536)).toBe(true);
  });

  it("preserves input order through a fallback", async () => {
    const openai = stubProvider("openai", async () => {
      throw recoverableError();
    });
    const gemini = stubProvider("gemini", async (inputs) =>
      inputs.map((text, i) => ({ vector: [i], provider: "gemini" as const, model: "gemini-embedding-2", dimensions: 1 })),
    );

    const service = new EmbeddingService(openai, gemini);
    const results = await service.generateEmbeddings(["first", "second", "third"]);

    expect(results.map((r) => r.vector[0])).toEqual([0, 1, 2]);
  });

  it("does not fall back on a non-recoverable primary failure", async () => {
    const thrown = nonRecoverableError();
    const openai = stubProvider("openai", async () => {
      throw thrown;
    });
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));

    const service = new EmbeddingService(openai, gemini);

    await expect(service.generateEmbeddings(["a"])).rejects.toBe(thrown);
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("does not fall back when the failure is an unrecognized error shape (config/programmer error)", async () => {
    const configError = new AppError({ code: "EMBEDDING_RESPONSE_INVALID", message: "malformed response", status: 502 });
    const openai = stubProvider("openai", async () => {
      throw configError;
    });
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));

    const service = new EmbeddingService(openai, gemini);

    await expect(service.generateEmbeddings(["a"])).rejects.toBe(configError);
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("rejects empty input arrays without calling any provider", async () => {
    const openai = stubProvider("openai", async (inputs) => resultsFor("openai", "text-embedding-3-small", 3, inputs));
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));
    const service = new EmbeddingService(openai, gemini);

    await expect(service.generateEmbeddings([])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_INVALID_INPUT";
    });
    expect(openai.generateEmbeddings).not.toHaveBeenCalled();
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only strings without calling any provider", async () => {
    const openai = stubProvider("openai", async (inputs) => resultsFor("openai", "text-embedding-3-small", 3, inputs));
    const service = new EmbeddingService(openai, stubProvider("gemini", async (i) => resultsFor("gemini", "m", 1, i)));

    await expect(service.generateEmbeddings(["valid", "   \n  "])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_INVALID_INPUT";
    });
    expect(openai.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("throws AI_PROVIDER_NOT_CONFIGURED when neither provider has an API key", async () => {
    openaiConfigured = false;
    geminiConfigured = false;

    const openai = stubProvider("openai", async (inputs) => resultsFor("openai", "text-embedding-3-small", 3, inputs));
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));
    const service = new EmbeddingService(openai, gemini);

    await expect(service.generateEmbeddings(["a"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED";
    });
    expect(openai.generateEmbeddings).not.toHaveBeenCalled();
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("uses gemini directly (not as a 'fallback') when only gemini is configured", async () => {
    openaiConfigured = false;
    geminiConfigured = true;

    const openai = stubProvider("openai", async (inputs) => resultsFor("openai", "text-embedding-3-small", 3, inputs));
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));
    const service = new EmbeddingService(openai, gemini);

    const results = await service.generateEmbeddings(["a"]);

    expect(openai.generateEmbeddings).not.toHaveBeenCalled();
    expect(results[0].provider).toBe("gemini");
  });

  it("does not attempt a fallback that is itself unconfigured, and surfaces the primary's real error", async () => {
    geminiConfigured = false;

    const thrown = recoverableError();
    const openai = stubProvider("openai", async () => {
      throw thrown;
    });
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));
    const service = new EmbeddingService(openai, gemini);

    // Gemini isn't configured, so there's nothing to fall back to — the informative
    // failure is OpenAI's own (transient) error, not a misleading "not configured".
    await expect(service.generateEmbeddings(["a"])).rejects.toBe(thrown);
    expect(gemini.generateEmbeddings).not.toHaveBeenCalled();
  });

  it("rejects a batch with inconsistent provider/model/dimensions across results", async () => {
    const inconsistentOpenai = stubProvider("openai", async () => [
      { vector: [1, 2, 3], provider: "openai", model: "text-embedding-3-small", dimensions: 3 },
      { vector: [1, 2], provider: "openai", model: "text-embedding-3-small", dimensions: 2 },
    ]);
    const gemini = stubProvider("gemini", async (inputs) => resultsFor("gemini", "gemini-embedding-2", 1536, inputs));
    const service = new EmbeddingService(inconsistentOpenai, gemini);

    await expect(service.generateEmbeddings(["a", "b"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISMATCH";
    });
  });

  it("rejects a fallback batch with an inconsistent provider across results", async () => {
    const openai = stubProvider("openai", async () => {
      throw recoverableError();
    });
    const inconsistentGemini = stubProvider("gemini", async () => [
      { vector: [1], provider: "gemini", model: "gemini-embedding-2", dimensions: 1 },
      { vector: [1], provider: "openai", model: "gemini-embedding-2", dimensions: 1 },
    ]);
    const service = new EmbeddingService(openai, inconsistentGemini);

    await expect(service.generateEmbeddings(["a", "b"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISMATCH";
    });
  });
});
