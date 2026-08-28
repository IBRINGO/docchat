import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  ConversationService,
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  type ConversationsCollectionLike,
  type MessagesCollectionLike,
} from "@/lib/services/conversation.service";
import { isAppError } from "@/lib/utils/errors";
import type { Conversation, Message } from "@/types/conversation";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

function fakeConversationsCollection(overrides: Partial<ConversationsCollectionLike> = {}): ConversationsCollectionLike & {
  [K in keyof ConversationsCollectionLike]: ReturnType<typeof vi.fn>;
} {
  return {
    insertOne: vi.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() })),
    findOne: vi.fn(async (): Promise<Conversation | null> => null),
    updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null })),
    find: vi.fn(),
    countDocuments: vi.fn(async () => 0),
    deleteOne: vi.fn(async () => ({ acknowledged: true, deletedCount: 1 })),
    ...overrides,
  } as never;
}

function fakeMessagesCollection(overrides: Partial<MessagesCollectionLike> = {}): MessagesCollectionLike & {
  [K in keyof MessagesCollectionLike]: ReturnType<typeof vi.fn>;
} {
  return {
    insertOne: vi.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() })),
    find: vi.fn(),
    deleteMany: vi.fn(async () => ({ acknowledged: true, deletedCount: 0 })),
    ...overrides,
  } as never;
}

function fakeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date();
  return { _id: new ObjectId(), title: "Test conversation", documentIds: [new ObjectId()], createdAt: now, updatedAt: now, ...overrides };
}

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: new ObjectId().toString(),
    documentId: new ObjectId().toString(),
    documentName: "report.pdf",
    content: "Relevant excerpt.",
    pageNumber: 2,
    chunkIndex: 0,
    score: 0.9,
    ...overrides,
  };
}

describe("deriveConversationTitle", () => {
  it("uses the full message when it's within the length limit", () => {
    expect(deriveConversationTitle("What are the main objectives of this project?")).toBe(
      "What are the main objectives of this project?",
    );
  });

  it("truncates a long message deterministically with an ellipsis", () => {
    const long = "a".repeat(100);
    const title = deriveConversationTitle(long);
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title.endsWith("…")).toBe(true);
  });

  it("collapses internal whitespace", () => {
    expect(deriveConversationTitle("What   is\n\nthis about?")).toBe("What is this about?");
  });

  it("is deterministic for the same input", () => {
    const message = "What are the objectives?";
    expect(deriveConversationTitle(message)).toBe(deriveConversationTitle(message));
  });
});

describe("ConversationService.resolveDocumentContext", () => {
  it("returns the request's own documentIds and a null conversation when no conversationId is given", async () => {
    const service = new ConversationService(async () => fakeConversationsCollection(), async () => fakeMessagesCollection());
    const result = await service.resolveDocumentContext({ documentIds: ["a", "b"] });

    expect(result.conversation).toBeNull();
    expect(result.documentIds).toEqual(["a", "b"]);
  });

  it("throws INVALID_CONVERSATION_ID for a malformed conversationId", async () => {
    const service = new ConversationService(async () => fakeConversationsCollection(), async () => fakeMessagesCollection());

    await expect(service.resolveDocumentContext({ conversationId: "not-valid", documentIds: [] })).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "INVALID_CONVERSATION_ID",
    );
  });

  it("throws CONVERSATION_NOT_FOUND when no conversation matches", async () => {
    const conversations = fakeConversationsCollection({ findOne: vi.fn(async () => null) });
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());

    await expect(
      service.resolveDocumentContext({ conversationId: new ObjectId().toString(), documentIds: [] }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "CONVERSATION_NOT_FOUND");
  });

  it("returns the conversation's stored documentIds when the requested set matches, regardless of order", async () => {
    const docA = new ObjectId();
    const docB = new ObjectId();
    const conversation = fakeConversation({ documentIds: [docA, docB] });
    const conversations = fakeConversationsCollection({ findOne: vi.fn(async () => conversation) });
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());

    const result = await service.resolveDocumentContext({
      conversationId: conversation._id.toString(),
      documentIds: [docB.toString(), docA.toString()],
    });

    expect(result.conversation).toBe(conversation);
    expect(result.documentIds.sort()).toEqual([docA.toString(), docB.toString()].sort());
  });

  it("throws CONVERSATION_DOCUMENT_CONTEXT_MISMATCH when the requested document set differs from the conversation's", async () => {
    const conversation = fakeConversation({ documentIds: [new ObjectId()] });
    const conversations = fakeConversationsCollection({ findOne: vi.fn(async () => conversation) });
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());

    await expect(
      service.resolveDocumentContext({ conversationId: conversation._id.toString(), documentIds: [new ObjectId().toString()] }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "CONVERSATION_DOCUMENT_CONTEXT_MISMATCH");
  });

  it("treats a different-length document set as a mismatch even if it's a subset", async () => {
    const docA = new ObjectId();
    const docB = new ObjectId();
    const conversation = fakeConversation({ documentIds: [docA, docB] });
    const conversations = fakeConversationsCollection({ findOne: vi.fn(async () => conversation) });
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());

    await expect(
      service.resolveDocumentContext({ conversationId: conversation._id.toString(), documentIds: [docA.toString()] }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "CONVERSATION_DOCUMENT_CONTEXT_MISMATCH");
  });
});

describe("ConversationService — creation and persistence", () => {
  it("creates a conversation with a title derived from the first message and the given documentIds", async () => {
    const conversations = fakeConversationsCollection();
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());
    const docId = new ObjectId().toString();

    const conversation = await service.createConversation([docId], "What are the objectives of the project?");

    expect(conversation.title).toBe("What are the objectives of the project?");
    expect(conversation.documentIds.map((id) => id.toString())).toEqual([docId]);
    expect(conversations.insertOne).toHaveBeenCalledWith(conversation);
  });

  it("persists a user message with no sources and touches the conversation's updatedAt", async () => {
    const conversations = fakeConversationsCollection();
    const messages = fakeMessagesCollection();
    const service = new ConversationService(async () => conversations, async () => messages);
    const conversationId = new ObjectId();

    await service.persistUserMessage(conversationId, "hello");

    expect(messages.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId, role: "user", content: "hello", sources: [] }),
    );
    expect(conversations.updateOne).toHaveBeenCalledWith(
      { _id: conversationId },
      expect.objectContaining({ $set: expect.objectContaining({ updatedAt: expect.any(Date) }) }),
    );
  });

  it("persists an assistant message with its sources converted to stored SourceReferences", async () => {
    const conversations = fakeConversationsCollection();
    const messages = fakeMessagesCollection();
    const service = new ConversationService(async () => conversations, async () => messages);
    const conversationId = new ObjectId();
    const source = chunk();

    await service.persistAssistantMessage(conversationId, "the answer", [source]);

    const inserted = messages.insertOne.mock.calls[0][0] as Message;
    expect(inserted.role).toBe("assistant");
    expect(inserted.content).toBe("the answer");
    expect(inserted.sources).toHaveLength(1);
    expect(inserted.sources[0]).toMatchObject({
      documentName: source.documentName,
      content: source.content,
      pageNumber: source.pageNumber,
      chunkIndex: source.chunkIndex,
      score: source.score,
    });
    expect(inserted.sources[0].documentId.toString()).toBe(source.documentId);
    expect(inserted.sources[0].chunkId.toString()).toBe(source.id);
  });
});

describe("ConversationService.createEmptyConversation", () => {
  it("creates a conversation with the placeholder title and exactly the given documentIds, with no message yet", async () => {
    const conversations = fakeConversationsCollection();
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());
    const docA = new ObjectId().toString();
    const docB = new ObjectId().toString();

    const conversation = await service.createEmptyConversation([docA, docB]);

    expect(conversation.title).toBe(DEFAULT_CONVERSATION_TITLE);
    expect(conversation.documentIds.map((id) => id.toString())).toEqual([docA, docB]);
    expect(conversations.insertOne).toHaveBeenCalledWith(conversation);
  });

  it("never mutates or deletes any other conversation — only inserts the new one", async () => {
    const conversations = fakeConversationsCollection();
    const service = new ConversationService(async () => conversations, async () => fakeMessagesCollection());

    await service.createEmptyConversation([new ObjectId().toString()]);

    expect(conversations.insertOne).toHaveBeenCalledTimes(1);
    expect(conversations.updateOne).not.toHaveBeenCalled();
    expect(conversations.deleteOne).not.toHaveBeenCalled();
  });
});

describe("ConversationService.persistUserMessage — placeholder retitling", () => {
  it("retitles a conversation that still has the placeholder title when its first message is persisted", async () => {
    const conversations = fakeConversationsCollection();
    const messages = fakeMessagesCollection();
    const service = new ConversationService(async () => conversations, async () => messages);
    const conversationId = new ObjectId();

    await service.persistUserMessage(conversationId, "What is the total budget for this project?");

    expect(conversations.updateOne).toHaveBeenCalledWith(
      { _id: conversationId, title: DEFAULT_CONVERSATION_TITLE },
      { $set: { title: "What is the total budget for this project?" } },
    );
  });

  it("still touches updatedAt alongside the conditional retitle attempt", async () => {
    const conversations = fakeConversationsCollection();
    const messages = fakeMessagesCollection();
    const service = new ConversationService(async () => conversations, async () => messages);
    const conversationId = new ObjectId();

    await service.persistUserMessage(conversationId, "hello");

    expect(conversations.updateOne).toHaveBeenCalledWith(
      { _id: conversationId },
      expect.objectContaining({ $set: expect.objectContaining({ updatedAt: expect.any(Date) }) }),
    );
  });

  it("attempts the conditional retitle even for a conversation that already has a real title — the {_id, title: placeholder} filter itself is what makes this a no-op server-side, not client logic", async () => {
    // The fake collection here doesn't simulate Mongo's filter matching (that's the real driver's
    // job) — this test documents and locks in the exact filter shape ConversationService sends,
    // which is what actually guarantees a no-op against a conversation whose title has already
    // moved on from the placeholder.
    const conversations = fakeConversationsCollection();
    const messages = fakeMessagesCollection();
    const service = new ConversationService(async () => conversations, async () => messages);
    const conversationId = new ObjectId();

    await service.persistUserMessage(conversationId, "a second message");

    const retitleCall = conversations.updateOne.mock.calls.find(
      (call) => (call[0] as { title?: string }).title === DEFAULT_CONVERSATION_TITLE,
    );
    expect(retitleCall).toBeDefined();
    expect(retitleCall?.[0]).toEqual({ _id: conversationId, title: DEFAULT_CONVERSATION_TITLE });
  });
});
