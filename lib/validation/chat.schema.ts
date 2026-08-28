import { z } from "zod";
import { AppError } from "@/lib/utils/errors";

/** 24 lowercase/uppercase hex characters — MongoDB's ObjectId string format. Checked explicitly here rather than via the driver's own ObjectId.isValid, which also loosely accepts other 12-byte-ish inputs we don't want to treat as valid at the HTTP boundary. */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/** Generous enough for real questions, small enough to bound embedding/prompt cost. */
export const MAX_MESSAGE_LENGTH = 2000;

export interface ChatRequest {
  documentId: string;
  message: string;
}

function invalidChatRequestError(reason: string): AppError {
  return new AppError({
    code: "INVALID_CHAT_REQUEST",
    message: `Invalid chat request: ${reason}`,
    status: 400,
  });
}

const chatRequestSchema = z.object({
  documentId: z.string().regex(OBJECT_ID_PATTERN, "documentId must be a valid MongoDB ObjectId"),
  message: z
    .string()
    .trim()
    .min(1, "message must not be empty")
    .max(MAX_MESSAGE_LENGTH, `message must be at most ${MAX_MESSAGE_LENGTH} characters`),
});

/** Validates a raw chat request body. Throws INVALID_CHAT_REQUEST (400) on any violation. */
export function validateChatRequest(payload: unknown): ChatRequest {
  const parsed = chatRequestSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidChatRequestError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}
