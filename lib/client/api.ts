import type { RetrievedChunk } from "@/lib/rag/retrieval.types";
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

export interface ChatStreamCallbacks {
  onMetadata?: (sources: RetrievedChunk[]) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

/** Sends a question to POST /api/chat and streams the SSE response, invoking the matching callback per event. Resolves once the stream ends (on "done" or after the response body closes). */
export async function streamChatResponse(documentId: string, message: string, callbacks: ChatStreamCallbacks): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId, message }),
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
          const data = event.data as { sources?: RetrievedChunk[] };
          callbacks.onMetadata?.(data.sources ?? []);
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
