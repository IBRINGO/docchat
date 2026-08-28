import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { OpenAiEmbeddingProvider, type OpenAiEmbeddingsClient } from "@/lib/providers/openai-embedding.provider";
import { isAppError } from "@/lib/utils/errors";

function makeVector(dimensions: number, seed: number): number[] {
  return Array.from({ length: dimensions }, (_, i) => seed + i * 0.001);
}

/**
 * `create`'s real return type is OpenAI's `APIPromise`, which a plain async
 * mock can't structurally satisfy. The cast is centralized here, once, so
 * individual tests can return plain objects/promises without their own casts.
 */
function fakeClient(create: (params: { model: string; input: string[] }) => Promise<unknown>): OpenAiEmbeddingsClient {
  return { embeddings: { create: create as OpenAiEmbeddingsClient["embeddings"]["create"] } };
}

describe("OpenAiEmbeddingProvider", () => {
  it("returns provider/model/dimensions metadata and preserves input order", async () => {
    const create = vi.fn(async ({ input }: { input: string[] }) => ({
      object: "list" as const,
      model: "text-embedding-3-small",
      data: input.map((_, index) => ({
        object: "embedding" as const,
        index,
        embedding: makeVector(4, index),
      })),
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }));

    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));
    const results = await provider.generateEmbeddings(["a", "b", "c"]);

    expect(results).toHaveLength(3);
    results.forEach((result, index) => {
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("text-embedding-3-small");
      expect(result.dimensions).toBe(4);
      expect(result.vector).toEqual(makeVector(4, index));
    });
  });

  it("re-sorts out-of-order API responses by index instead of trusting array position", async () => {
    const create = vi.fn(async ({ input }: { input: string[] }) => ({
      object: "list" as const,
      model: "text-embedding-3-small",
      data: input
        .map((_, index) => ({ object: "embedding" as const, index, embedding: makeVector(3, index) }))
        .reverse(),
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }));

    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));
    const results = await provider.generateEmbeddings(["first", "second"]);

    expect(results[0].vector).toEqual(makeVector(3, 0));
    expect(results[1].vector).toEqual(makeVector(3, 1));
  });

  it("splits large batches into multiple requests and preserves order across them", async () => {
    const create = vi.fn(async ({ input }: { input: string[] }) => ({
      object: "list" as const,
      model: "text-embedding-3-small",
      data: input.map((_, index) => ({ object: "embedding" as const, index, embedding: makeVector(2, index) })),
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }));

    const inputs = Array.from({ length: 250 }, (_, i) => `chunk-${i}`);
    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));
    const results = await provider.generateEmbeddings(inputs);

    expect(create).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(results).toHaveLength(250);
  });

  it("throws EMBEDDING_RESPONSE_INVALID when the response count doesn't match the input count", async () => {
    const create = vi.fn(async () => ({
      object: "list" as const,
      model: "text-embedding-3-small",
      data: [{ object: "embedding" as const, index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }));

    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));

    await expect(provider.generateEmbeddings(["a", "b"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_RESPONSE_INVALID";
    });
  });

  it("throws EMBEDDING_RESPONSE_INVALID for an empty embedding vector", async () => {
    const create = vi.fn(async () => ({
      object: "list" as const,
      model: "text-embedding-3-small",
      data: [{ object: "embedding" as const, index: 0, embedding: [] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }));

    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));

    await expect(provider.generateEmbeddings(["a"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_RESPONSE_INVALID";
    });
  });

  it("wraps unexpected SDK errors as EMBEDDING_GENERATION_FAILED", async () => {
    const create = vi.fn(async () => {
      throw new OpenAI.APIConnectionError({ message: "network blip" });
    });

    const provider = new OpenAiEmbeddingProvider(undefined, fakeClient(create));

    await expect(provider.generateEmbeddings(["a"])).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "EMBEDDING_GENERATION_FAILED";
    });
  });
});
