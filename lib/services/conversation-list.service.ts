import { ObjectId, type Collection } from "mongodb";
import { getConversationsCollection, getDocumentsCollection, getMessagesCollection } from "@/lib/db/collections";
import { conversationNotFoundError, invalidConversationIdError } from "@/lib/services/conversation.service";
import type { Conversation, Message, MessageRole, SourceReference } from "@/types/conversation";
import type { Document as DocumentEntity } from "@/types/document";

/** The slice of each collection this module actually calls — small enough to fake directly in tests. */
export type ConversationsQueryCollection = Pick<Collection<Conversation>, "find" | "countDocuments" | "findOne" | "deleteOne">;
export type MessagesQueryCollection = Pick<Collection<Message>, "find" | "deleteMany">;
export type DocumentNameLookupCollection = Pick<Collection<DocumentEntity>, "find">;

export interface ConversationSummary {
  id: string;
  title: string;
  documentIds: string[];
  documentNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ConversationListResult {
  conversations: ConversationSummary[];
  pagination: ConversationListPagination;
}

export interface MessageSourceView {
  documentId: string;
  documentName: string;
  chunkId: string;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  score: number;
}

export interface MessageView {
  id: string;
  role: MessageRole;
  content: string;
  sources: MessageSourceView[];
  createdAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  documentIds: string[];
  documentNames: string[];
  createdAt: string;
  updatedAt: string;
}

function toSourceView(source: SourceReference): MessageSourceView {
  return {
    documentId: source.documentId.toString(),
    documentName: source.documentName,
    chunkId: source.chunkId.toString(),
    content: source.content,
    pageNumber: source.pageNumber,
    chunkIndex: source.chunkIndex,
    score: source.score,
  };
}

/** Looks up document names for a set of document IDs in ONE query, not one per conversation/message — the caller passes in every id it will need names for up front. */
async function lookupDocumentNames(
  documentIds: readonly ObjectId[],
  getDocuments: () => Promise<DocumentNameLookupCollection>,
): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map();
  const documentsCollection = await getDocuments();
  const documents = await documentsCollection.find({ _id: { $in: [...documentIds] } }).toArray();
  return new Map(documents.map((document) => [document._id.toString(), document.name]));
}

/**
 * Lists conversations newest-activity-first, with each one's document names
 * resolved via a single batched lookup across the whole page rather than a
 * query per conversation.
 */
export async function listConversations(
  query: { page: number; limit: number },
  getConversations: () => Promise<ConversationsQueryCollection> = getConversationsCollection,
  getDocuments: () => Promise<DocumentNameLookupCollection> = getDocumentsCollection,
): Promise<ConversationListResult> {
  const collection = await getConversations();
  const skip = (query.page - 1) * query.limit;

  const [total, records] = await Promise.all([
    collection.countDocuments({}),
    collection.find({}).sort({ updatedAt: -1 }).skip(skip).limit(query.limit).toArray(),
  ]);

  const allDocumentIds = Array.from(new Set(records.flatMap((record) => record.documentIds.map((id) => id.toString())))).map(
    (id) => new ObjectId(id),
  );
  const nameById = await lookupDocumentNames(allDocumentIds, getDocuments);

  return {
    conversations: records.map((record) => ({
      id: record._id.toString(),
      title: record.title,
      documentIds: record.documentIds.map((id) => id.toString()),
      documentNames: record.documentIds.map((id) => nameById.get(id.toString()) ?? "Unknown document"),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

/** Loads one conversation's metadata (with document names) and its full message history, ordered oldest-first. */
export async function getConversationWithMessages(
  conversationId: string,
  getConversations: () => Promise<ConversationsQueryCollection> = getConversationsCollection,
  getMessages: () => Promise<MessagesQueryCollection> = getMessagesCollection,
  getDocuments: () => Promise<DocumentNameLookupCollection> = getDocumentsCollection,
): Promise<{ conversation: ConversationDetail; messages: MessageView[] }> {
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(conversationId);
  } catch {
    throw invalidConversationIdError();
  }

  const conversationsCollection = await getConversations();
  const conversation = await conversationsCollection.findOne({ _id: objectId });
  if (!conversation) {
    throw conversationNotFoundError();
  }

  const [nameById, messagesCollection] = await Promise.all([lookupDocumentNames(conversation.documentIds, getDocuments), getMessages()]);
  const messages = await messagesCollection.find({ conversationId: objectId }).sort({ createdAt: 1 }).toArray();

  return {
    conversation: {
      id: conversation._id.toString(),
      title: conversation.title,
      documentIds: conversation.documentIds.map((id) => id.toString()),
      documentNames: conversation.documentIds.map((id) => nameById.get(id.toString()) ?? "Unknown document"),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    messages: messages.map((message) => ({
      id: message._id.toString(),
      role: message.role,
      content: message.content,
      sources: message.sources.map(toSourceView),
      createdAt: message.createdAt.toISOString(),
    })),
  };
}

/** Deletes a conversation and its messages. Best-effort cleanup order: messages first, then the conversation, so a failure never leaves the conversation gone with orphaned messages still visible in isolation — worst case a delete retried later finds the conversation already gone and no-ops. */
export async function deleteConversation(
  conversationId: string,
  getConversations: () => Promise<ConversationsQueryCollection> = getConversationsCollection,
  getMessages: () => Promise<MessagesQueryCollection> = getMessagesCollection,
): Promise<void> {
  let objectId: ObjectId;
  try {
    objectId = new ObjectId(conversationId);
  } catch {
    throw invalidConversationIdError();
  }

  const conversationsCollection = await getConversations();
  const conversation = await conversationsCollection.findOne({ _id: objectId });
  if (!conversation) {
    throw conversationNotFoundError();
  }

  const messagesCollection = await getMessages();
  await messagesCollection.deleteMany({ conversationId: objectId });
  await conversationsCollection.deleteOne({ _id: objectId });
}
