import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  ChatService,
  type AnswerGenerator,
  type ConversationRunner,
  type RetrievalRunner,
} from "@/lib/services/chat.service";
import { AppError, isAppError } from "@/lib/utils/errors";
import { noContextAnswer } from "@/lib/rag/prompt";
import type { RetrievalResult, RetrievedChunk } from "@/lib/rag/retrieval.types";
import type { ChatRequest } from "@/lib/validation/chat.schema";
import type { Conversation } from "@/types/conversation";

const DOCUMENT_ID = "507f1f77bcf86cd799439011";
const REQUEST: ChatRequest = { documentIds: [DOCUMENT_ID], message: "What are the objectives?" };

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: "chunk-1",
    documentId: DOCUMENT_ID,
    documentName: "report.pdf",
    content: "Relevant excerpt.",
    pageNumber: 2,
    chunkIndex: 0,
    score: 0.88,
    ...overrides,
  };
}

function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date();
  return {
    _id: new ObjectId(),
    title: "What are the objectives?",
    documentIds: [new ObjectId(DOCUMENT_ID)],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
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

function fakeConversationService(
  overrides: Partial<{
    resolveDocumentContext: ConversationRunner["resolveDocumentContext"];
    createConversation: ConversationRunner["createConversation"];
    persistUserMessage: ConversationRunner["persistUserMessage"];
    persistAssistantMessage: ConversationRunner["persistAssistantMessage"];
  }> = {},
  conversation: Conversation = fakeConversation(),
): ConversationRunner & {
  resolveDocumentContext: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  persistUserMessage: ReturnType<typeof vi.fn>;
  persistAssistantMessage: ReturnType<typeof vi.fn>;
} {
  return {
    resolveDocumentContext: vi.fn(
      overrides.resolveDocumentContext ?? (async (request) => ({ conversation: null, documentIds: request.documentIds })),
    ),
    createConversation: vi.fn(overrides.createConversation ?? (async () => conversation)),
    persistUserMessage: vi.fn(overrides.persistUserMessage ?? (async () => undefined)),
    persistAssistantMessage: vi.fn(overrides.persistAssistantMessage ?? (async () => undefined)),
  };
}

async function collectEvents(service: ChatService, prepared: Awaited<ReturnType<ChatService["prepare"]>>) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  for await (const event of service.streamAnswer(prepared)) events.push(event);
  return events;
}

describe("ChatService.prepare", () => {
  it("creates a new conversation and persists the user message when no conversationId is given", async () => {
    const chunks = [chunk()];
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks });
    const conversation = fakeConversation();
    const conversationService = fakeConversationService({}, conversation);
    const service = new ChatService(retrieval, fakeAnswerService(), conversationService);

    const prepared = await service.prepare(REQUEST);

    expect(conversationService.createConversation).toHaveBeenCalledWith([DOCUMENT_ID], REQUEST.message);
    expect(conversationService.persistUserMessage).toHaveBeenCalledWith(conversation._id, REQUEST.message);
    expect(prepared.conversationId).toBe(conversation._id.toString());
    expect(prepared.prompt).not.toBeNull();
    expect(prepared.sources).toEqual(chunks);
  });

  it("reuses an existing conversation and does not create a new one when conversationId is given", async () => {
    const existing = fakeConversation();
    const conversationService = fakeConversationService({
      resolveDocumentContext: async () => ({ conversation: existing, documentIds: [DOCUMENT_ID] }),
    });
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [chunk()] });
    const service = new ChatService(retrieval, fakeAnswerService(), conversationService);

    const request: ChatRequest = { ...REQUEST, conversationId: existing._id.toString() };
    const prepared = await service.prepare(request);

    expect(conversationService.createConversation).not.toHaveBeenCalled();
    expect(conversationService.persistUserMessage).toHaveBeenCalledWith(existing._id, REQUEST.message);
    expect(prepared.conversationId).toBe(existing._id.toString());
  });

  it("skips prompt construction when retrieval returns no chunks", async () => {
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [] });
    const service = new ChatService(retrieval, fakeAnswerService(), fakeConversationService());

    const prepared = await service.prepare(REQUEST);

    expect(prepared.prompt).toBeNull();
    expect(prepared.sources).toEqual([]);
  });

  it("throws AI_PROVIDER_NOT_CONFIGURED when there is context but no answer provider is configured, without persisting anything", async () => {
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [chunk()] });
    const answerService = fakeAnswerService({ hasAnyProviderConfigured: () => false });
    const conversationService = fakeConversationService();
    const service = new ChatService(retrieval, answerService, conversationService);

    await expect(service.prepare(REQUEST)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED",
    );
    expect(conversationService.createConversation).not.toHaveBeenCalled();
    expect(conversationService.persistUserMessage).not.toHaveBeenCalled();
  });

  it("does not require a configured provider when there is no context to answer from", async () => {
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [] });
    const answerService = fakeAnswerService({ hasAnyProviderConfigured: () => false });
    const service = new ChatService(retrieval, answerService, fakeConversationService());

    await expect(service.prepare(REQUEST)).resolves.toBeDefined();
  });

  it("propagates retrieval failures (e.g. document not found) without creating a conversation or persisting a message", async () => {
    const notFound = new AppError({ code: "DOCUMENT_NOT_FOUND", message: "No document was found.", status: 404 });
    const retrieval = failingRetrieval(notFound);
    const conversationService = fakeConversationService();
    const service = new ChatService(retrieval, fakeAnswerService(), conversationService);

    await expect(service.prepare(REQUEST)).rejects.toBe(notFound);
    expect(conversationService.createConversation).not.toHaveBeenCalled();
    expect(conversationService.persistUserMessage).not.toHaveBeenCalled();
  });

  it("propagates a conversation document-context mismatch from resolveDocumentContext", async () => {
    const mismatch = new AppError({ code: "CONVERSATION_DOCUMENT_CONTEXT_MISMATCH", message: "mismatch", status: 409 });
    const conversationService = fakeConversationService({
      resolveDocumentContext: async () => {
        throw mismatch;
      },
    });
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [] });
    const service = new ChatService(retrieval, fakeAnswerService(), conversationService);

    await expect(service.prepare({ ...REQUEST, conversationId: new ObjectId().toString() })).rejects.toBe(mismatch);
    expect(retrieval.retrieve).not.toHaveBeenCalled();
  });
});

describe("ChatService.streamAnswer", () => {
  it("emits metadata (with conversationId, documentIds, and sources), then deltas, then done, and persists the assistant message", async () => {
    const chunks = [chunk({ id: "a" }), chunk({ id: "b", pageNumber: 5 })];
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks });
    const answerService = fakeAnswerService();
    const conversation = fakeConversation();
    const conversationService = fakeConversationService({}, conversation);
    const service = new ChatService(retrieval, answerService, conversationService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "delta", "done"]);
    expect(events[0].data.conversationId).toBe(conversation._id.toString());
    expect(events[0].data.documentIds).toEqual([DOCUMENT_ID]);
    expect(events[0].data.sources).toEqual(chunks);
    expect(events[1].data.text).toBe("An");
    expect(events[2].data.text).toBe(" answer.");
    expect(conversationService.persistAssistantMessage).toHaveBeenCalledWith(conversation._id, "An answer.", chunks);
  });

  it("does not call the LLM, returns the deterministic no-context answer, and still persists it as the assistant message", async () => {
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [] });
    const answerService = fakeAnswerService();
    const conversation = fakeConversation();
    const conversationService = fakeConversationService({}, conversation);
    const service = new ChatService(retrieval, answerService, conversationService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(answerService.streamAnswer).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "done"]);
    expect(events[0].data.sources).toEqual([]);
    const expectedText = noContextAnswer(REQUEST.message);
    expect(events[1].data.text).toBe(expectedText);
    expect(conversationService.persistAssistantMessage).toHaveBeenCalledWith(conversation._id, expectedText, []);
  });

  it("converts a generation failure into an error event instead of throwing, and does not persist an assistant message", async () => {
    const generationError = new AppError({ code: "LLM_GENERATION_FAILED", message: "boom", status: 502 });
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [chunk()] });
    const conversationService = fakeConversationService();
    const answerService = fakeAnswerService({
      streamAnswer: async () => {
        throw generationError;
      },
    });
    const service = new ChatService(retrieval, answerService, conversationService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "error"]);
    expect(events[1].data.code).toBe("LLM_GENERATION_FAILED");
    expect(conversationService.persistAssistantMessage).not.toHaveBeenCalled();
  });

  it("converts a mid-stream generation failure into an error event, preserving only the partial text on screen but never persisting it", async () => {
    const streamError = new AppError({ code: "LLM_GENERATION_FAILED", message: "connection dropped mid-stream", status: 502 });
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [chunk()] });
    const conversationService = fakeConversationService();
    const answerService = fakeAnswerService({
      streamAnswer: async () => ({
        provider: "gemini" as const,
        model: "gemini-3.6-flash",
        chunks: throwsAfterFirstChunk("partial", streamError),
      }),
    });
    const service = new ChatService(retrieval, answerService, conversationService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "error"]);
    expect(events[1].data.text).toBe("partial");
    expect(events[2].data.code).toBe("LLM_GENERATION_FAILED");
    expect(conversationService.persistAssistantMessage).not.toHaveBeenCalled();
  });

  it("does not fail the response when persisting the assistant message fails after a successful stream", async () => {
    const retrieval = fakeRetrieval({ documentIds: [DOCUMENT_ID], query: REQUEST.message, chunks: [chunk()] });
    const conversationService = fakeConversationService({
      persistAssistantMessage: async () => {
        throw new Error("Mongo write failed");
      },
    });
    const answerService = fakeAnswerService();
    const service = new ChatService(retrieval, answerService, conversationService);

    const prepared = await service.prepare(REQUEST);
    const events = await collectEvents(service, prepared);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "delta", "done"]);
  });
});
