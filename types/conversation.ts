import type { ObjectId } from "mongodb";
import type { Nullable } from "@/types/common";

export type MessageRole = "user" | "assistant";

/** A persisted, denormalized snapshot of one retrieved chunk — stored on the assistant message so conversation history remains stable even if the source document is later deleted or re-ingested. */
export interface SourceReference {
  documentId: ObjectId;
  documentName: string;
  chunkId: ObjectId;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  score: number;
}

export interface Conversation {
  _id: ObjectId;
  title: string;
  /** Stable for the lifetime of the conversation — see ConversationService, "a conversation has a fixed document context." */
  documentIds: ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  _id: ObjectId;
  conversationId: ObjectId;
  role: MessageRole;
  content: string;
  /** Always empty for role "user". */
  sources: SourceReference[];
  createdAt: Date;
}
