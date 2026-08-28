import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  deleteConversation,
  getConversationWithMessages,
  listConversations,
  type ConversationsQueryCollection,
  type DocumentNameLookupCollection,
  type MessagesQueryCollection,
} from "@/lib/services/conversation-list.service";
import { isAppError } from "@/lib/utils/errors";
import type { Conversation, Message } from "@/types/conversation";
import type { Document as DocumentEntity } from "@/types/document";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return { _id: new ObjectId(), title: "Test conversation", documentIds: [new ObjectId()], createdAt: now, updatedAt: now, ...overrides };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: new ObjectId(),
    conversationId: new ObjectId(),
    role: "user",
    content: "hello",
    sources: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function fakeConversationsFind(records: Conversation[], total: number): ConversationsQueryCollection {
  return {
    countDocuments: vi.fn(async () => total),
    find: vi.fn(() => ({
      sort: () => ({
        skip: (skip: number) => ({
          limit: (limit: number) => ({ toArray: async () => records.slice(skip, skip + limit) }),
        }),
      }),
    })),
    findOne: vi.fn(async () => null),
    deleteOne: vi.fn(async () => ({ acknowledged: true, deletedCount: 1 })),
  } as unknown as ConversationsQueryCollection;
}

function fakeDocumentsLookup(documents: DocumentEntity[]): DocumentNameLookupCollection {
  return {
    find: vi.fn((filter: { _id: { $in: ObjectId[] } }) => ({
      toArray: async () => {
        const ids = filter._id.$in.map((id) => id.toString());
        return documents.filter((doc) => ids.includes(doc._id.toString()));
      },
    })),
  } as unknown as DocumentNameLookupCollection;
}

function makeDocument(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  const now = new Date();
  return {
    _id: new ObjectId(),
    name: "report.pdf",
    size: 100,
    mimeType: "application/pdf",
    pageCount: 1,
    chunkCount: 1,
    status: "ready",
    embeddingProvider: "gemini",
    embeddingModel: "gemini-embedding-2",
    embeddingDimensions: 1536,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("listConversations", () => {
  it("resolves document names for each conversation via one batched lookup", async () => {
    const document = makeDocument({ name: "Architecture.pdf" });
    const conversation = makeConversation({ documentIds: [document._id] });
    const conversations = fakeConversationsFind([conversation], 1);
    const documentsLookup = fakeDocumentsLookup([document]);
    const findSpy = documentsLookup.find as ReturnType<typeof vi.fn>;

    const result = await listConversations({ page: 1, limit: 20 }, async () => conversations, async () => documentsLookup);

    expect(result.conversations).toEqual([
      {
        id: conversation._id.toString(),
        title: conversation.title,
        documentIds: [document._id.toString()],
        documentNames: ["Architecture.pdf"],
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
    ]);
    expect(findSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to a placeholder name for a document that no longer exists", async () => {
    const conversation = makeConversation({ documentIds: [new ObjectId()] });
    const conversations = fakeConversationsFind([conversation], 1);
    const documentsLookup = fakeDocumentsLookup([]);

    const result = await listConversations({ page: 1, limit: 20 }, async () => conversations, async () => documentsLookup);
    expect(result.conversations[0].documentNames).toEqual(["Unknown document"]);
  });

  it("computes pagination totals correctly", async () => {
    const conversations = fakeConversationsFind([], 42);
    const documentsLookup = fakeDocumentsLookup([]);

    const result = await listConversations({ page: 2, limit: 20 }, async () => conversations, async () => documentsLookup);
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 42, totalPages: 3 });
  });
});

describe("getConversationWithMessages", () => {
  it("throws INVALID_CONVERSATION_ID for a malformed id", async () => {
    await expect(
      getConversationWithMessages("not-valid", async () => fakeConversationsFind([], 0), async () => ({}) as MessagesQueryCollection, async () =>
        fakeDocumentsLookup([]),
      ),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "INVALID_CONVERSATION_ID");
  });

  it("throws CONVERSATION_NOT_FOUND when no conversation matches", async () => {
    const conversations = fakeConversationsFind([], 0);
    await expect(
      getConversationWithMessages(
        new ObjectId().toString(),
        async () => conversations,
        async () => ({}) as MessagesQueryCollection,
        async () => fakeDocumentsLookup([]),
      ),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "CONVERSATION_NOT_FOUND");
  });

  it("returns messages ordered oldest-first with document names resolved", async () => {
    const document = makeDocument({ name: "Spec.pdf" });
    const conversation = makeConversation({ documentIds: [document._id] });
    const conversations = fakeConversationsFind([], 0);
    (conversations.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(conversation);

    const first = makeMessage({ role: "user", content: "hi", conversationId: conversation._id, createdAt: new Date("2026-08-01T00:00:00Z") });
    const second = makeMessage({
      role: "assistant",
      content: "hello",
      conversationId: conversation._id,
      createdAt: new Date("2026-08-01T00:01:00Z"),
      sources: [
        {
          documentId: document._id,
          documentName: "Spec.pdf",
          chunkId: new ObjectId(),
          content: "excerpt",
          pageNumber: 1,
          chunkIndex: 0,
          score: 0.9,
        },
      ],
    });

    const messagesCollection = {
      find: vi.fn(() => ({ sort: () => ({ toArray: async () => [first, second] }) })),
    } as unknown as MessagesQueryCollection;

    const result = await getConversationWithMessages(
      conversation._id.toString(),
      async () => conversations,
      async () => messagesCollection,
      async () => fakeDocumentsLookup([document]),
    );

    expect(result.conversation.documentNames).toEqual(["Spec.pdf"]);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(result.messages[1].sources[0]).toMatchObject({ documentName: "Spec.pdf", content: "excerpt", score: 0.9 });
  });
});

describe("deleteConversation", () => {
  it("throws CONVERSATION_NOT_FOUND when the conversation doesn't exist", async () => {
    const conversations = fakeConversationsFind([], 0);
    await expect(
      deleteConversation(new ObjectId().toString(), async () => conversations, async () => ({}) as MessagesQueryCollection),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "CONVERSATION_NOT_FOUND");
  });

  it("deletes the conversation's messages before deleting the conversation itself", async () => {
    const conversation = makeConversation();
    const conversations = fakeConversationsFind([], 0);
    (conversations.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(conversation);
    const deleteMany = vi.fn(async () => ({ acknowledged: true, deletedCount: 2 }));
    const messagesCollection = { deleteMany } as unknown as MessagesQueryCollection;

    await deleteConversation(conversation._id.toString(), async () => conversations, async () => messagesCollection);

    expect(deleteMany).toHaveBeenCalledWith({ conversationId: conversation._id });
    expect(conversations.deleteOne).toHaveBeenCalledWith({ _id: conversation._id });
  });
});
