import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "streaming" | "complete" | "error";

/** Client-side chat history entry. Session-only (React state) — not persisted. */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  sources?: RetrievedChunk[];
  status?: ChatMessageStatus;
  errorMessage?: string;
}
