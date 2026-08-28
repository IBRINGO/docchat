import { ObjectId, type Collection } from "mongodb";
import { getConversationsCollection, getMessagesCollection } from "@/lib/db/collections";
import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";
import type { Conversation, Message, SourceReference } from "@/types/conversation";

const MAX_TITLE_LENGTH = 60;
/**
 * Placeholder title for a conversation created explicitly, before any
 * message exists (see createEmptyConversation — used right after a
 * successful document upload, so a conversation can be activated in the UI
 * before the user has typed anything). Deliberately not LLM-generated — see
 * deriveConversationTitle below for why a title is never worth a generation
 * request. persistUserMessage replaces this with a real title, derived from
 * whatever the first user message turns out to be, the moment one arrives.
 */
export const DEFAULT_CONVERSATION_TITLE = "New conversation";

/** The slice of Collection<Conversation> this module actually calls — small enough to fake directly in tests. */
export type ConversationsCollectionLike = Pick<Collection<Conversation>, "insertOne" | "findOne" | "updateOne" | "find" | "countDocuments" | "deleteOne">;
/** The slice of Collection<Message> this module actually calls — small enough to fake directly in tests. */
export type MessagesCollectionLike = Pick<Collection<Message>, "insertOne" | "find" | "deleteMany">;

export function invalidConversationIdError(): AppError {
  return new AppError({
    code: "INVALID_CONVERSATION_ID",
    message: "conversationId is not a valid identifier.",
    status: 400,
  });
}

export function conversationNotFoundError(): AppError {
  return new AppError({
    code: "CONVERSATION_NOT_FOUND",
    message: "No conversation was found for the given id.",
    status: 404,
  });
}

export function conversationDocumentContextMismatchError(): AppError {
  return new AppError({
    code: "CONVERSATION_DOCUMENT_CONTEXT_MISMATCH",
    message:
      "The selected documents do not match this conversation's document context. A conversation's documents are fixed — start a new conversation to chat with a different document selection.",
    status: 409,
  });
}

/** Order-independent comparison of two document ID sets — selecting the same documents in a different order must not count as a mismatch. */
function sameDocumentSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Deterministic conversation title: the first user message, whitespace-
 * collapsed and truncated. Explicitly not an LLM call — a title is not worth
 * a generation request, and determinism makes it trivially testable.
 */
export function deriveConversationTitle(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_TITLE_LENGTH ? normalized : `${normalized.slice(0, MAX_TITLE_LENGTH).trimEnd()}…`;
}

function toSourceReference(chunk: RetrievedChunk): SourceReference {
  return {
    documentId: new ObjectId(chunk.documentId),
    documentName: chunk.documentName,
    chunkId: new ObjectId(chunk.id),
    content: chunk.content,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
  };
}

export interface ResolvedDocumentContext {
  /** null for a brand-new conversation not yet created. */
  conversation: Conversation | null;
  documentIds: string[];
}

/**
 * Owns conversation/message persistence. A conversation's document context
 * is fixed at creation — resolveDocumentContext enforces that an existing
 * conversation only ever continues with the exact document set (order
 * ignored) it was created with; changing documents requires a new
 * conversation. See README, "Conversation/document context rule."
 */
export class ConversationService {
  constructor(
    private readonly getConversations: () => Promise<ConversationsCollectionLike> = getConversationsCollection,
    private readonly getMessages: () => Promise<MessagesCollectionLike> = getMessagesCollection,
  ) {}

  /** Resolves which document context a chat request should use — an existing conversation's (validated against the request), or the request's own for a new conversation. Throws if a conversationId is given but invalid, not found, or its document context doesn't match. */
  async resolveDocumentContext(request: { conversationId?: string; documentIds: string[] }): Promise<ResolvedDocumentContext> {
    if (!request.conversationId) {
      return { conversation: null, documentIds: request.documentIds };
    }

    let conversationId: ObjectId;
    try {
      conversationId = new ObjectId(request.conversationId);
    } catch {
      throw invalidConversationIdError();
    }

    const conversations = await this.getConversations();
    const conversation = await conversations.findOne({ _id: conversationId });
    if (!conversation) {
      throw conversationNotFoundError();
    }

    const storedIds = conversation.documentIds.map((id) => id.toString());
    if (!sameDocumentSet(storedIds, request.documentIds)) {
      throw conversationDocumentContextMismatchError();
    }

    return { conversation, documentIds: storedIds };
  }

  async createConversation(documentIds: string[], firstMessage: string): Promise<Conversation> {
    return this.insertConversation(documentIds, deriveConversationTitle(firstMessage));
  }

  /**
   * Creates a conversation with no messages yet — used to start a
   * conversation explicitly (e.g. immediately after a successful document
   * upload batch, via POST /api/conversations) rather than implicitly
   * alongside a first chat message. Callers are responsible for validating
   * `documentIds` first (see lib/services/document-selection.service.ts) —
   * this mirrors createConversation, which likewise assumes its caller
   * (ChatService, via RetrievalService) already validated them.
   */
  async createEmptyConversation(documentIds: string[]): Promise<Conversation> {
    return this.insertConversation(documentIds, DEFAULT_CONVERSATION_TITLE);
  }

  private async insertConversation(documentIds: string[], title: string): Promise<Conversation> {
    const conversations = await this.getConversations();
    const now = new Date();
    const conversation: Conversation = {
      _id: new ObjectId(),
      title,
      documentIds: documentIds.map((id) => new ObjectId(id)),
      createdAt: now,
      updatedAt: now,
    };

    await conversations.insertOne(conversation);
    logger.info("conversation_created", { conversationId: conversation._id.toString(), documentCount: documentIds.length });
    return conversation;
  }

  async persistUserMessage(conversationId: ObjectId, content: string): Promise<void> {
    const messages = await this.getMessages();
    await messages.insertOne({ _id: new ObjectId(), conversationId, role: "user", content, sources: [], createdAt: new Date() });
    await this.retitleIfPlaceholder(conversationId, content);
    await this.touchConversation(conversationId);
  }

  /**
   * If this conversation still has the placeholder title from
   * createEmptyConversation — meaning no message has retitled it yet — sets
   * a real title derived from this message. A no-op for every other
   * conversation (its title was already set at creation, or already
   * retitled once), enforced atomically via the title in the update filter
   * rather than a separate read-then-write, so this is safe to call on every
   * user message without a race or a double-retitle.
   */
  private async retitleIfPlaceholder(conversationId: ObjectId, message: string): Promise<void> {
    const conversations = await this.getConversations();
    await conversations.updateOne({ _id: conversationId, title: DEFAULT_CONVERSATION_TITLE }, { $set: { title: deriveConversationTitle(message) } });
  }

  async persistAssistantMessage(conversationId: ObjectId, content: string, sources: RetrievedChunk[]): Promise<void> {
    const messages = await this.getMessages();
    await messages.insertOne({
      _id: new ObjectId(),
      conversationId,
      role: "assistant",
      content,
      sources: sources.map(toSourceReference),
      createdAt: new Date(),
    });
    await this.touchConversation(conversationId);
  }

  private async touchConversation(conversationId: ObjectId): Promise<void> {
    const conversations = await this.getConversations();
    await conversations.updateOne({ _id: conversationId }, { $set: { updatedAt: new Date() } });
  }
}

let cachedService: ConversationService | undefined;

export function getConversationService(): ConversationService {
  if (!cachedService) {
    cachedService = new ConversationService();
  }
  return cachedService;
}
