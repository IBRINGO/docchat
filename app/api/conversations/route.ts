import { NextResponse } from "next/server";
import { AppError } from "@/lib/utils/errors";
import { errorResponse, rateLimitedResponse } from "@/lib/utils/api-response";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/utils/rate-limit";
import { parseConversationListQuery } from "@/lib/validation/conversation-list.schema";
import { validateCreateConversationRequest } from "@/lib/validation/create-conversation.schema";
import { listConversations } from "@/lib/services/conversation-list.service";
import { resolveAndValidateDocuments } from "@/lib/services/document-selection.service";
import { getConversationService } from "@/lib/services/conversation.service";
import type { Conversation } from "@/types/conversation";

export const runtime = "nodejs";

/** Generous limit — this is a plain read, not an LLM-calling endpoint. Same best-effort, single-instance limiter as /api/chat (see lib/utils/rate-limit.ts). */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function malformedRequestBodyError(): AppError {
  return new AppError({
    code: "INVALID_CREATE_CONVERSATION_REQUEST",
    message: "Invalid conversation creation request: request body must be valid JSON.",
    status: 400,
  });
}

function toConversationView(conversation: Conversation) {
  return {
    id: conversation._id.toString(),
    title: conversation.title,
    documentIds: conversation.documentIds.map((id) => id.toString()),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  const rateLimit = checkRateLimit(`conversations:${clientKeyFromRequest(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds, "conversation_list_request_failed");
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = parseConversationListQuery(searchParams);
    const result = await listConversations(query);

    return NextResponse.json({ success: true, conversations: result.conversations, pagination: result.pagination });
  } catch (error) {
    return errorResponse(error, "conversation_list_request_failed");
  }
}

/**
 * Explicitly creates a conversation for a document set, with no first
 * message yet — used right after a successful upload batch so the UI can
 * switch straight into an active, persisted conversation before the user has
 * typed anything (see hooks/useMultiDocumentUpload.ts's onBatchSettled and
 * app/page.tsx's handleUploadBatchSettled). The normal chat flow (POST
 * /api/chat with no conversationId) still creates a conversation implicitly
 * alongside a first message — this route doesn't replace that path, it adds
 * the one this app didn't have: starting a conversation before any message
 * exists.
 */
export async function POST(request: Request): Promise<Response> {
  const rateLimit = checkRateLimit(`conversations:${clientKeyFromRequest(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds, "conversation_create_request_failed");
  }

  try {
    const payload = await request.json().catch(() => {
      throw malformedRequestBodyError();
    });
    const { documentIds } = validateCreateConversationRequest(payload);

    // Never trust the frontend's own selection UI: re-validate that every document exists, is
    // ready, and that the combined selection still respects the cumulative size/page limits.
    await resolveAndValidateDocuments(documentIds);

    const conversation = await getConversationService().createEmptyConversation(documentIds);

    return NextResponse.json({ success: true, conversation: toConversationView(conversation) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "conversation_create_request_failed");
  }
}
