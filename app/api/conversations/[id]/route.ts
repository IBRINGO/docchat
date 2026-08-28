import { NextResponse } from "next/server";
import { errorResponse, rateLimitedResponse } from "@/lib/utils/api-response";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";
import { deleteConversation, getConversationWithMessages } from "@/lib/services/conversation-list.service";

export const runtime = "nodejs";

/** Generous limit — a plain read/delete, not an LLM-calling endpoint. Same best-effort, single-instance limiter as /api/chat (see lib/utils/rate-limit.ts). */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const rateLimit = checkRateLimit(`conversations:${clientKeyFromRequest(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds, "conversation_get_request_failed");
  }

  try {
    const { id } = await params;
    const { conversation, messages } = await getConversationWithMessages(id);

    return NextResponse.json({ success: true, conversation, messages });
  } catch (error) {
    return errorResponse(error, "conversation_get_request_failed");
  }
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  const rateLimit = checkRateLimit(`conversations:${clientKeyFromRequest(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds, "conversation_delete_request_failed");
  }

  try {
    const { id } = await params;
    await deleteConversation(id);
    logger.info("conversation_deleted", { conversationId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "conversation_delete_request_failed");
  }
}
