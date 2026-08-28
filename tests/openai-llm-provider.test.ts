import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { OpenAiLlmProvider, type OpenAiChatClient } from "@/lib/providers/openai-llm.provider";
import { isAppError } from "@/lib/utils/errors";

function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next(): Promise<IteratorResult<T>> {
          if (i < items.length) return { value: items[i++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function deltaChunk(content: string | null): { choices: Array<{ delta: { content: string | null } }> } {
  return { choices: [{ delta: { content } }] };
}

function fakeClient(
  create: (params: { messages: unknown; stream: boolean }) => Promise<AsyncIterable<unknown>>,
): OpenAiChatClient {
  return { chat: { completions: { create: create as unknown as OpenAiChatClient["chat"]["completions"]["create"] } } };
}

async function collect(provider: OpenAiLlmProvider): Promise<string[]> {
  const collected: string[] = [];
  for await (const text of provider.streamAnswer({ systemPrompt: "SYS", userPrompt: "USER" })) {
    collected.push(text);
  }
  return collected;
}

describe("OpenAiLlmProvider", () => {
  it("sends the system and user prompt as messages, with streaming enabled", async () => {
    const create = vi.fn(async () => asyncIterable([deltaChunk("Hello"), deltaChunk(" world")]));
    const provider = new OpenAiLlmProvider(undefined, fakeClient(create));

    expect(await collect(provider)).toEqual(["Hello", " world"]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        messages: [
          { role: "system", content: "SYS" },
          { role: "user", content: "USER" },
        ],
      }),
    );
  });

  it("skips null/empty delta content without yielding empty strings", async () => {
    const create = vi.fn(async () => asyncIterable([deltaChunk(null), deltaChunk("text"), deltaChunk("")]));
    const provider = new OpenAiLlmProvider(undefined, fakeClient(create));

    expect(await collect(provider)).toEqual(["text"]);
  });

  it("wraps an unexpected SDK error as LLM_GENERATION_FAILED", async () => {
    const create = vi.fn(async () => {
      throw new OpenAI.APIConnectionError({ message: "network blip" });
    });
    const provider = new OpenAiLlmProvider(undefined, fakeClient(create));

    await expect(collect(provider)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "LLM_GENERATION_FAILED",
    );
  });

  it("does not wrap an already-structured AppError a second time", async () => {
    const { embeddingInvalidInputError } = await import("@/lib/providers/embedding-errors");
    const original = embeddingInvalidInputError("unreachable in practice, just a stand-in AppError");
    const create = vi.fn(async () => {
      throw original;
    });
    const provider = new OpenAiLlmProvider(undefined, fakeClient(create));

    await expect(collect(provider)).rejects.toBe(original);
  });
});
