import { describe, expect, it, vi } from "vitest";
import { ChatService, type AnswerGenerator, type RetrievalRunner } from "@/lib/services/chat.service";
import { AppError, isAppError } from "@/lib/utils/errors";
import { noContextAnswer } from "@/lib/rag/prompt";
import type { RetrievalResult, RetrievedChunk } from "@/lib/rag/retrieval.types";
import type { ChatRequest } from "@/lib/validation/chat.schema";

const REQUEST: ChatRequest = { documentId: "507f1f77bcf86cd799439011", message: "What are the objectives?" };

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return { id: "chunk-1", content: "Relevant excerpt.", pageNumber: 2, chunkIndex: 0, score: 0.88, ...overrides };
}

function fakeRetrieval(result: RetrievalResult): RetrievalRunner & { retrieve: ReturnType<typeof vi.fn> } {
  return { retrieve: vi.fn(async () => result) };
}

function failingRetrieval(error: unknown): RetrievalRunner & { retrieve: ReturnType<typeof vi.fn> } {
  return {
    retrieve: vi.fn(async () => {
      throw error;
    }),
  };
}

async function* succeedsWith(items: string[]): AsyncGenerator<string> {
  for (const item of items) yield item;
}

async function* throwsAfterFirstChunk(first: string, error: unknown): AsyncGenerator<string> {
  yield first;
  throw error;
}

function fakeAnswerService(
  overrides: Partial<{
    streamAnswer: AnswerGenerator["streamAnswer"];
    hasAnyProviderConfigured: () => boolean;
  }> = {},
): AnswerGenerator & { streamAnswer: ReturnType<typeof vi.fn>; hasAnyProviderConfigured: ReturnType<typeof vi.fn> } {
  return {
    streamAnswer: vi.fn(
      overrides.streamAnswer ??
        (async () => ({ provider: "gemini" as const, model: "gemini-3.6-flash", chunks: succeedsWith(["An", " answer."]) })),
    ),
    hasAnyProviderConfigured: vi.fn(overrides.hasAnyProviderConfigured ?? (() => true)),
  };
}

async function collectEvents(service: ChatService, prepared: Awaited<ReturnType<ChatService["prepare"]>>) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  for await (const event of service.streamAnswer(prepared)) events.push(event);
  return events;
}

describe("ChatService.prepare", () => {
  it("builds a grounded prompt from retrieved chunks", async () => {
    const chunks = [chunk()];
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks });
    const service = new ChatService(retrieval, fakeAnswerService());

    const prepared = await service.prepare(REQUEST);

    expect(prepared.prompt).not.toBeNull();
    expect(prepared.prompt?.systemPrompt).toContain("Relevant excerpt.");
    expect(prepared.sources).toEqual(chunks);
  });

  it("skips prompt construction when retrieval returns no chunks", async () => {
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [] });
    const service = new ChatService(retrieval, fakeAnswerService());

    const prepared = await service.prepare(REQUEST);

    expect(prepared.prompt).toBeNull();
    expect(prepared.sources).toEqual([]);
  });

  it("throws AI_PROVIDER_NOT_CONFIGURED when there is context but no answer provider is configured", async () => {
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [chunk()] });
    const answerService = fakeAnswerService({ hasAnyProviderConfigured: () => false });
    const service = new ChatService(retrieval, answerService);

    await expect(service.prepare(REQUEST)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED",
    );
  });

  it("does not require a configured provider when there is no context to answer from", async () => {
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [] });
    const answerService = fakeAnswerService({ hasAnyProviderConfigured: () => false });
    const service = new ChatService(retrieval, answerService);

    await expect(service.prepare(REQUEST)).resolves.toBeDefined();
  });

  it("propagates retrieval failures (e.g. document not found) unchanged", async () => {
    const notFound = new AppError({ code: "DOCUMENT_NOT_FOUND", message: "No document was found.", status: 404 });
    const retrieval = failingRetrieval(notFound);
    const service = new ChatService(retrieval, fakeAnswerService());

    await expect(service.prepare(REQUEST)).rejects.toBe(notFound);
  });
});

describe("ChatService.streamAnswer", () => {
  it("emits metadata (with sources), then deltas, then done", async () => {
    const chunks = [chunk({ id: "a" }), chunk({ id: "b", pageNumber: 5 })];
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks });
    const answerService = fakeAnswerService();
    const service = new ChatService(retrieval, answerService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "delta", "done"]);
    expect(events[0].data.sources).toEqual(chunks);
    expect(events[0].data.documentId).toBe(REQUEST.documentId);
    expect(events[1].data.text).toBe("An");
    expect(events[2].data.text).toBe(" answer.");
  });

  it("does not call the LLM and returns the deterministic no-context answer when there are no chunks", async () => {
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [] });
    const answerService = fakeAnswerService();
    const service = new ChatService(retrieval, answerService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(answerService.streamAnswer).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "done"]);
    expect(events[0].data.sources).toEqual([]);
    expect(events[1].data.text).toBe(noContextAnswer(REQUEST.message));
  });

  it("converts a generation failure into an error event instead of throwing", async () => {
    const generationError = new AppError({ code: "LLM_GENERATION_FAILED", message: "boom", status: 502 });
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [chunk()] });
    const answerService = fakeAnswerService({
      streamAnswer: async () => {
        throw generationError;
      },
    });
    const service = new ChatService(retrieval, answerService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "error"]);
    expect(events[1].data.code).toBe("LLM_GENERATION_FAILED");
  });

  it("converts a mid-stream generation failure into an error event, without concatenating a second provider's output", async () => {
    const streamError = new AppError({ code: "LLM_GENERATION_FAILED", message: "connection dropped mid-stream", status: 502 });
    const retrieval = fakeRetrieval({ documentId: REQUEST.documentId, query: REQUEST.message, chunks: [chunk()] });
    const answerService = fakeAnswerService({
      streamAnswer: async () => ({
        provider: "gemini" as const,
        model: "gemini-3.6-flash",
        chunks: throwsAfterFirstChunk("partial", streamError),
      }),
    });
    const service = new ChatService(retrieval, answerService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "error"]);
    expect(events[1].data.text).toBe("partial");
    expect(events[2].data.code).toBe("LLM_GENERATION_FAILED");
  });
});
