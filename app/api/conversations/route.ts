import { NextResponse } from "next/server";
import { errorResponse, rateLimitedResponse } from "@/lib/utils/api-response";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/utils/rate-limit";
import { parseConversationListQuery } from "@/lib/validation/conversation-list.schema";
import { listConversations } from "@/lib/services/conversation-list.service";

export const runtime = "nodejs";

/** Generous limit — this is a plain read, not an LLM-calling endpoint. Same best-effort, single-instance limiter as /api/chat (see lib/utils/rate-limit.ts). */
const RATE_LIMIT_MAX_REQUESTS = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

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
