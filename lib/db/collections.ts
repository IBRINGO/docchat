import type { Collection } from "mongodb";
import { getDatabase } from "@/lib/db/mongodb";
import type { Document } from "@/types/document";
import type { Chunk } from "@/types/chunk";
import type { Conversation, Message } from "@/types/conversation";

export const COLLECTIONS = {
  documents: "documents",
  chunks: "chunks",
  conversations: "conversations",
  messages: "messages",
} as const;

export async function getDocumentsCollection(): Promise<Collection<Document>> {
  const db = await getDatabase();
  return db.collection<Document>(COLLECTIONS.documents);
}

export async function getChunksCollection(): Promise<Collection<Chunk>> {
  const db = await getDatabase();
  return db.collection<Chunk>(COLLECTIONS.chunks);
}

export async function getConversationsCollection(): Promise<Collection<Conversation>> {
  const db = await getDatabase();
  return db.collection<Conversation>(COLLECTIONS.conversations);
}

export async function getMessagesCollection(): Promise<Collection<Message>> {
  const db = await getDatabase();
  return db.collection<Message>(COLLECTIONS.messages);
}
