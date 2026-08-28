import { z } from "zod";
import { AppError } from "@/lib/utils/errors";
import { objectIdSchema } from "@/lib/validation/object-id";
import { MAX_DOCUMENT_IDS_PER_REQUEST } from "@/lib/validation/chat.schema";

export interface CreateConversationRequest {
  documentIds: string[];
}

function invalidCreateConversationRequestError(reason: string): AppError {
  return new AppError({
    code: "INVALID_CREATE_CONVERSATION_REQUEST",
    message: `Invalid conversation creation request: ${reason}`,
    status: 400,
  });
}

const createConversationRequestSchema = z.object({
  documentIds: z
    .array(objectIdSchema)
    .min(1, "documentIds must contain at least one document ID")
    .max(MAX_DOCUMENT_IDS_PER_REQUEST, `documentIds must contain at most ${MAX_DOCUMENT_IDS_PER_REQUEST} document IDs`),
});

/**
 * Validates the body of POST /api/conversations (explicit conversation
 * creation, with no first message yet — see ConversationService.createEmptyConversation).
 * Throws INVALID_CREATE_CONVERSATION_REQUEST (400) on any shape violation.
 * Only validates the request's *shape*; whether the named documents actually
 * exist, are ready, and fit the cumulative selection limits is checked
 * separately and server-side by resolveAndValidateDocuments — never trusted
 * from the client.
 */
export function validateCreateConversationRequest(payload: unknown): CreateConversationRequest {
  const parsed = createConversationRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidCreateConversationRequestError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return { documentIds: Array.from(new Set(parsed.data.documentIds)) };
}
