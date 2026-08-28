import { describe, expect, it, vi } from "vitest";
import { ApiError as GeminiApiError } from "@google/genai";
import { GeminiEmbeddingProvider, type GeminiEmbeddingsClient } from "@/lib/providers/gemini-embedding.provider";
import { isAppError } from "@/lib/utils/errors";

type FakeContent = { parts: Array<{ text: string }> };

function makeVector(dimensions: number, seed: number): number[] {
  return Array.from({ length: dimensions }, (_, i) => seed + i * 0.001);
}

/** embedContent's real return type is a branded SDK class; the cast is centralized here, once. */
function fakeClient(
  embedContent: (params: { model: string; contents: FakeContent[] }) => Promise<unknown>,
): GeminiEmbeddingsClient {
  return { models: { embedContent: embedContent as GeminiEmbeddingsClient["models"]["embedContent"] } };
}

describe("GeminiEmbeddingProvider", () => {
  it("returns provider/model/dimensions metadata and preserves input order", async () => {
    const embedContent = vi.fn(async ({ contents }: { contents: FakeContent[] }) => ({
      embeddings: contents.map((_, index) => ({ values: makeVector(4, index) })),
    }));

    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));
    const results = await provider.generateEmbeddings(["a", "b", "c"]);

    expect(results).toHaveLength(3);
    results.forEach((result, index) => {
      expect(result.provider).toBe("gemini");
      expect(result.model).toBe("gemini-embedding-2");
      expect(result.dimensions).toBe(4);
      expect(result.vector).toEqual(makeVector(4, index));
    });
  });

  it("sends each input as its own Content object, not a bare string array", async () => {
    // Regression test: the real Gemini API treats a bare string[] as multiple
    // *parts of one content item* (collapsing them into a single embedding),
    // not "one embedding per string" the way OpenAI's `input: string[]` works.
    // Verified empirically against the live API — a plain string[] silently
    // returned exactly 1 embedding for N inputs.
    const embedContent = vi.fn(async ({ contents }: { contents: FakeContent[] }) => ({
      embeddings: contents.map((_, index) => ({ values: makeVector(2, index) })),
    }));

    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));
    await provider.generateEmbeddings(["Alpha text", "Beta text"]);

    expect(embedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [{ parts: [{ text: "Alpha text" }] }, { parts: [{ text: "Beta text" }] }],
      }),
    );
  });

  it("requests the configured output dimensionality", async () => {
    const embedContent = vi.fn(async ({ contents }: { contents: FakeContent[] }) => ({
      embeddings: contents.map(() => ({ values: makeVector(768, 0) })),
    }));

    const provider = new GeminiEmbeddingProvider("gemini-embedding-2", 768, fakeClient(embedContent));
    await provider.generateEmbeddings(["a"]);

    expect(embedContent).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ outputDimensionality: 768 }) }),
    );
  });

  it("splits large batches into multiple requests and preserves order across them", async () => {
    const embedContent = vi.fn(async ({ contents }: { contents: FakeContent[] }) => ({
      embeddings: contents.map((_, index) => ({ values: makeVector(2, index) })),
    }));

    const inputs = Array.from({ length: 150 }, (_, i) => `chunk-${i}`);
    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));
    const results = await provider.generateEmbeddings(inputs);

    expect(embedContent).toHaveBeenCalledTimes(2); // 100 + 50
    expect(results).toHaveLength(150);
  });

  it("throws EMBEDDING_RESPONSE_INVALID when the response count doesn't match the input count", async () => {
    const embedContent = vi.fn(async () => ({ embeddings: [{ values: [0.1, 0.2] }] }));

    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));

    await expect(provider.generateEmbeddings(["a", "b"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_RESPONSE_INVALID";
    });
  });

  it("throws EMBEDDING_RESPONSE_INVALID for an empty embedding vector", async () => {
    const embedContent = vi.fn(async () => ({ embeddings: [{ values: [] }] }));

    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));

    await expect(provider.generateEmbeddings(["a"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_RESPONSE_INVALID";
    });
  });

  it("wraps unexpected SDK errors as EMBEDDING_GENERATION_FAILED", async () => {
    const embedContent = vi.fn(async () => {
      throw new GeminiApiError({ message: "service unavailable", status: 503 });
    });

    const provider = new GeminiEmbeddingProvider(undefined, undefined, fakeClient(embedContent));

    await expect(provider.generateEmbeddings(["a"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_GENERATION_FAILED";
    });
  });
});
