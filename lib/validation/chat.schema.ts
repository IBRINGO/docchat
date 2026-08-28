import { z } from "zod";
import { AppError } from "@/lib/utils/errors";
import { objectIdSchema } from "@/lib/validation/object-id";

/** Generous enough for real questions, small enough to bound embedding/prompt cost. */
export const MAX_MESSAGE_LENGTH = 2000;

/** A defensive cap on how many document IDs one request can name — an API-input sanity bound against a malformed/abusive request body. Distinct from (and much looser than) the size/page-based cumulative selection limits enforced server-side in RetrievalService (see lib/config/document-limits.ts), which are the real business constraint. Also reused by create-conversation.schema.ts — the same sanity bound applies whenever a request names a document set, whether or not a message comes with it. */
export const MAX_DOCUMENT_IDS_PER_REQUEST = 50;

export interface ChatRequest {
  documentIds: string[];
  message: string;
  conversationId?: string;
}

function invalidChatRequestError(reason: string): AppError {
  return new AppError({
    code: "INVALID_CHAT_REQUEST",
    message: `Invalid chat request: ${reason}`,
    status: 400,
  });
}

const chatRequestSchema = z.object({
  documentIds: z
    .array(objectIdSchema)
    .min(1, "documentIds must contain at least one document ID")
    .max(MAX_DOCUMENT_IDS_PER_REQUEST, `documentIds must contain at most ${MAX_DOCUMENT_IDS_PER_REQUEST} document IDs`),
  message: z
    .string()
    .trim()
    .min(1, "message must not be empty")
    .max(MAX_MESSAGE_LENGTH, `message must be at most ${MAX_MESSAGE_LENGTH} characters`),
  conversationId: objectIdSchema.optional(),
});

/**
 * Validates a raw chat request body. Throws INVALID_CHAT_REQUEST (400) on
 * any violation. Duplicate document IDs are normalized (deduplicated,
 * first-seen order preserved) rather than rejected — an accidental repeat
 * in the request isn't a meaningfully different, let alone invalid, request.
 */
export function validateChatRequest(payload: unknown): ChatRequest {
  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidChatRequestError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return {
    documentIds: Array.from(new Set(parsed.data.documentIds)),
    message: parsed.data.message,
    conversationId: parsed.data.conversationId,
  };
}
