import { beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { AnswerGenerationService } from "@/lib/services/answer.service";
import { isAppError } from "@/lib/utils/errors";
import type { LLMProvider } from "@/lib/providers/llm.provider";

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

async function* succeedsWith(items: string[]): AsyncGenerator<string> {
  for (const item of items) yield item;
}

async function* throwsAfterFirstChunk(first: string, error: unknown): AsyncGenerator<string> {
  yield first;
  throw error;
}

/** A generator that fails on its very first pull, before any output — built without `function*` so there's no unreachable "no yield" body. */
function throwsImmediately(error: unknown): AsyncGenerator<string> {
  const generator = {
    async next(): Promise<IteratorResult<string>> {
      throw error;
    },
    async return(): Promise<IteratorResult<string>> {
      return { value: undefined, done: true };
    },
    async throw(): Promise<IteratorResult<string>> {
      throw error;
    },
    [Symbol.asyncIterator]() {
      return generator as unknown as AsyncGenerator<string>;
    },
  };
  return generator as unknown as AsyncGenerator<string>;
}

function fakeProvider(
  name: "openai" | "gemini",
  model: string,
  gen: () => AsyncGenerator<string>,
): LLMProvider & { streamAnswer: ReturnType<typeof vi.fn> } {
  return { name, model, streamAnswer: vi.fn(gen) };
}

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const item of stream) result.push(item);
  return result;
}

const recoverableError = () => new OpenAI.APIConnectionError({ message: "network blip" });
const nonRecoverableError = () => new OpenAI.APIError(400, {}, "Bad Request", new Headers());

const PROMPT = { systemPrompt: "SYS", userPrompt: "USER" };

describe("AnswerGenerationService", () => {
  it("uses the primary provider on success and never calls the fallback", async () => {
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => succeedsWith(["Hello", " world"]));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["should not run"]));
    const service = new AnswerGenerationService(primary, fallback);

    const answer = await service.streamAnswer(PROMPT);

    expect(answer.provider).toBe("gemini");
    expect(answer.model).toBe("gemini-3.6-flash");
    expect(await collect(answer.chunks)).toEqual(["Hello", " world"]);
    expect(fallback.streamAnswer).not.toHaveBeenCalled();
  });

  it("falls back to the secondary provider when the primary fails before any output, and the failure is recoverable", async () => {
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => throwsImmediately(recoverableError()));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["fallback answer"]));
    const service = new AnswerGenerationService(primary, fallback);

    const answer = await service.streamAnswer(PROMPT);

    expect(answer.provider).toBe("openai");
    expect(await collect(answer.chunks)).toEqual(["fallback answer"]);
  });

  it("does not fall back on a non-recoverable primary failure", async () => {
    const thrown = nonRecoverableError();
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => throwsImmediately(thrown));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["should not run"]));
    const service = new AnswerGenerationService(primary, fallback);

    await expect(service.streamAnswer(PROMPT)).rejects.toBe(thrown);
    expect(fallback.streamAnswer).not.toHaveBeenCalled();
  });

  it("does not switch providers once output has already started streaming from the primary", async () => {
    const failure = recoverableError();
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => throwsAfterFirstChunk("partial answer", failure));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["should not run"]));
    const service = new AnswerGenerationService(primary, fallback);

    const answer = await service.streamAnswer(PROMPT);
    expect(answer.provider).toBe("gemini");

    const collected: string[] = [];
    await expect(
      (async () => {
        for await (const text of answer.chunks) collected.push(text);
      })(),
    ).rejects.toBe(failure);

    expect(collected).toEqual(["partial answer"]);
    expect(fallback.streamAnswer).not.toHaveBeenCalled();
  });

  it("throws AI_PROVIDER_NOT_CONFIGURED when neither provider has an API key", async () => {
    openaiConfigured = false;
    geminiConfigured = false;
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => succeedsWith(["x"]));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["x"]));
    const service = new AnswerGenerationService(primary, fallback);

    await expect(service.streamAnswer(PROMPT)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED",
    );
  });

  it("does not attempt a fallback that is itself unconfigured, surfacing the primary's real error", async () => {
    openaiConfigured = false;
    const thrown = recoverableError();
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => throwsImmediately(thrown));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["should not run"]));
    const service = new AnswerGenerationService(primary, fallback);

    await expect(service.streamAnswer(PROMPT)).rejects.toBe(thrown);
    expect(fallback.streamAnswer).not.toHaveBeenCalled();
  });

  it("uses the fallback provider directly (not as a retry) when only it is configured", async () => {
    geminiConfigured = false;
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => succeedsWith(["should not run"]));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["direct answer"]));
    const service = new AnswerGenerationService(primary, fallback);

    const answer = await service.streamAnswer(PROMPT);

    expect(primary.streamAnswer).not.toHaveBeenCalled();
    expect(answer.provider).toBe("openai");
    expect(await collect(answer.chunks)).toEqual(["direct answer"]);
  });

  it("hasAnyProviderConfigured reflects whether either provider currently has a key", () => {
    const primary = fakeProvider("gemini", "gemini-3.6-flash", () => succeedsWith(["x"]));
    const fallback = fakeProvider("openai", "gpt-4o-mini", () => succeedsWith(["x"]));
    const service = new AnswerGenerationService(primary, fallback);

    expect(service.hasAnyProviderConfigured()).toBe(true);

    openaiConfigured = false;
    geminiConfigured = false;
    expect(service.hasAnyProviderConfigured()).toBe(false);
  });
});
