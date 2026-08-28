import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "streaming" | "complete" | "error";
/**
 * Only set while status is "streaming" and no answer text has arrived yet.
 * These map to real, client-observable phases of POST /api/chat, not
 * fabricated backend progress: "retrieving" covers everything the server
 * does before its first SSE event (document/context resolution + vector
 * search), and "generating" covers the gap between that first `metadata`
 * event and the first `delta` (the LLM's time-to-first-token). See
 * hooks/useChat.ts.
 */
export type ChatMessageStage = "retrieving" | "generating";

/** Client-side chat history entry. Session-only (React state) — not persisted. */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  sources?: RetrievedChunk[];
  status?: ChatMessageStatus;
  stage?: ChatMessageStage;
  errorMessage?: string;
}
