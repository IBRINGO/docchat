import type { RetrievedChunk } from "@/lib/rag/retrieval.types";
import type { DocumentListPagination, DocumentSummary } from "@/lib/services/document-list.service";
import type { ConversationListPagination, ConversationSummary, MessageView } from "@/lib/services/conversation-list.service";
import { parseSseBuffer } from "@/lib/client/sse";

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

interface ErrorPayload {
  success: false;
  error: { code: string; message: string };
}

export interface UploadedDocument {
  id: string;
  fileName: string;
  status: "processing" | "ready" | "failed";
  pageCount: number | null;
  chunkCount: number;
  embeddingConfiguration: { provider: string; model: string; dimensions: number } | null;
}

function isErrorPayload(payload: unknown): payload is ErrorPayload {
  return typeof payload === "object" && payload !== null && (payload as { success?: unknown }).success === false;
}

/** Uploads a PDF to POST /api/upload. The single request covers extraction, chunking, embedding, and persistence server-side — there is no intermediate progress to report. */
export async function uploadDocument(file: File): Promise<UploadedDocument> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", { method: "POST", body: formData });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The document could not be uploaded.");
  }

  return (payload as { document: UploadedDocument }).document;
}

export interface UploadWithProgressCallbacks {
  /** Fires repeatedly while the request body is being sent — 0 to 100. */
  onProgress?: (percent: number) => void;
  /** Fires once when the request body has fully reached the server and the response (extraction/chunking/embedding/persistence) is pending. */
  onUploadComplete?: () => void;
}

export interface UploadWithProgressHandle {
  promise: Promise<UploadedDocument>;
  abort: () => void;
}

/**
 * Same contract as uploadDocument, but via XMLHttpRequest so genuine
 * client-observable progress is available: `onProgress` tracks bytes of the
 * request body actually sent (the "uploading" phase), and `onUploadComplete`
 * marks the moment the browser has finished sending — after that point the
 * server is doing extraction/chunking/embedding/persistence with no further
 * client-visible signal until the response arrives (the "processing" phase).
 * Used by hooks/useMultiDocumentUpload.ts to drive real, honest per-file
 * queue states instead of a single opaque "uploading" spinner.
 */
export function uploadDocumentWithProgress(file: File, callbacks: UploadWithProgressCallbacks = {}): UploadWithProgressHandle {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  formData.append("file", file);

  const promise = new Promise<UploadedDocument>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) callbacks.onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    xhr.upload.addEventListener("load", () => callbacks.onUploadComplete?.());
    xhr.addEventListener("load", () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && !isErrorPayload(payload)) {
        resolve((payload as { document: UploadedDocument }).document);
      } else {
        const error = isErrorPayload(payload) ? payload.error : undefined;
        reject(new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The document could not be uploaded."));
      }
    });
    xhr.addEventListener("error", () => reject(new ApiError("NETWORK_ERROR", "A network error occurred while uploading.")));
    xhr.addEventListener("abort", () => reject(new ApiError("UPLOAD_ABORTED", "The upload was cancelled.")));
    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

export interface ListDocumentsParams {
  q?: string;
  status?: "processing" | "ready" | "failed";
  page?: number;
  limit?: number;
}

export interface ListDocumentsResult {
  documents: DocumentSummary[];
  pagination: DocumentListPagination;
}

/** Fetches GET /api/documents with optional search/status/pagination params. */
export async function listDocuments(params: ListDocumentsParams = {}): Promise<ListDocumentsResult> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.status) searchParams.set("status", params.status);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();
  const response = await fetch(`/api/documents${query ? `?${query}` : ""}`);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The document list could not be loaded.");
  }

  return payload as ListDocumentsResult;
}

export interface ListConversationsResult {
  conversations: ConversationSummary[];
  pagination: ConversationListPagination;
}

/** Fetches GET /api/conversations, newest activity first. */
export async function listConversations(params: { page?: number; limit?: number } = {}): Promise<ListConversationsResult> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();
  const response = await fetch(`/api/conversations${query ? `?${query}` : ""}`);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The conversation history could not be loaded.");
  }

  return payload as ListConversationsResult;
}

export interface ConversationDetailView {
  id: string;
  title: string;
  documentIds: string[];
  documentNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GetConversationResult {
  conversation: ConversationDetailView;
  messages: MessageView[];
}

/** Fetches GET /api/conversations/:id — full metadata plus ordered message history. */
export async function getConversation(conversationId: string): Promise<GetConversationResult> {
  const response = await fetch(`/api/conversations/${conversationId}`);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The conversation could not be loaded.");
  }

  return payload as GetConversationResult;
}

export interface CreatedConversation {
  id: string;
  title: string;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Explicitly creates a conversation for a document set via POST /api/conversations,
 * before any message exists — used right after a successful upload batch (see
 * hooks/useMultiDocumentUpload.ts's onBatchSettled). The server validates the
 * document set itself (existence, ready status, cumulative limits); this
 * throws ApiError with the server's message if that validation fails.
 */
export async function createConversation(documentIds: string[]): Promise<CreatedConversation> {
  const response = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The conversation could not be created.");
  }

  return (payload as { conversation: CreatedConversation }).conversation;
}

/** Deletes a conversation and its messages via DELETE /api/conversations/:id. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || isErrorPayload(payload)) {
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? "The conversation could not be deleted.");
  }
}

export interface ChatMetadata {
  conversationId: string;
  documentIds: string[];
  sources: RetrievedChunk[];
}

export interface ChatStreamCallbacks {
  onMetadata?: (metadata: ChatMetadata) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export interface StreamChatRequest {
  documentIds: string[];
  message: string;
  /** Omit to start a new conversation. */
  conversationId?: string;
}

/** Sends a question to POST /api/chat and streams the SSE response, invoking the matching callback per event. Resolves once the stream ends (on "done" or after the response body closes). */
export async function streamChatResponse(request: StreamChatRequest, callbacks: ChatStreamCallbacks): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const error = isErrorPayload(payload) ? payload.error : undefined;
    throw new ApiError(error?.code ?? "UNKNOWN_ERROR", error?.message ?? `The request failed (${response.status}).`);
  }

  if (!response.body) {
    throw new ApiError("STREAM_UNAVAILABLE", "Streaming is not supported in this environment.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      switch (event.type) {
        case "metadata": {
          const data = event.data as { conversationId?: string; documentIds?: string[]; sources?: RetrievedChunk[] };
          if (data.conversationId) {
            callbacks.onMetadata?.({ conversationId: data.conversationId, documentIds: data.documentIds ?? [], sources: data.sources ?? [] });
          }
          break;
        }
        case "delta": {
          const data = event.data as { text?: string };
          if (data.text) callbacks.onDelta?.(data.text);
          break;
        }
        case "done": {
          callbacks.onDone?.();
          break;
        }
        case "error": {
          const data = event.data as { message?: string };
          callbacks.onError?.(data.message ?? "The assistant could not generate an answer.");
          break;
        }
        default:
          break;
      }
    }
  }
}
