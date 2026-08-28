import { describe, expect, it, vi } from "vitest";
import { ApiError as GeminiApiError } from "@google/genai";
import { GeminiLlmProvider, type GeminiChatClient } from "@/lib/providers/gemini-llm.provider";
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

function fakeClient(
  generateContentStream: (params: { contents: unknown; config: unknown }) => Promise<AsyncIterable<{ text?: string }>>,
): GeminiChatClient {
  return {
    models: { generateContentStream: generateContentStream as unknown as GeminiChatClient["models"]["generateContentStream"] },
  };
}

async function collect(provider: GeminiLlmProvider): Promise<string[]> {
  const collected: string[] = [];
  for await (const text of provider.streamAnswer({ systemPrompt: "SYS", userPrompt: "USER" })) {
    collected.push(text);
  }
  return collected;
}

describe("GeminiLlmProvider", () => {
  it("sends the user prompt as contents and the system prompt as systemInstruction", async () => {
    const generateContentStream = vi.fn(async () => asyncIterable([{ text: "Bonjour" }, { text: " monde" }]));
    const provider = new GeminiLlmProvider(undefined, fakeClient(generateContentStream));

    expect(await collect(provider)).toEqual(["Bonjour", " monde"]);
    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: "USER",
        config: expect.objectContaining({ systemInstruction: "SYS" }),
      }),
    );
  });

  it("skips chunks with no text", async () => {
    const generateContentStream = vi.fn(async () => asyncIterable([{ text: undefined }, { text: "text" }]));
    const provider = new GeminiLlmProvider(undefined, fakeClient(generateContentStream));

    expect(await collect(provider)).toEqual(["text"]);
  });

  it("wraps an unexpected SDK error as LLM_GENERATION_FAILED", async () => {
    const generateContentStream = vi.fn(async () => {
      throw new GeminiApiError({ message: "service unavailable", status: 503 });
    });
    const provider = new GeminiLlmProvider(undefined, fakeClient(generateContentStream));

    await expect(collect(provider)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "LLM_GENERATION_FAILED",
    );
  });
});
