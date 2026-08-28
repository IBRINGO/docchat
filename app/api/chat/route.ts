import { AppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { errorResponse, rateLimitedResponse } from "@/lib/utils/api-response";
import { validateChatRequest } from "@/lib/validation/chat.schema";
import { ChatService, type ChatStreamEvent, type PreparedChat } from "@/lib/services/chat.service";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/utils/rate-limit";

// MongoDB, OpenAI, and Gemini SDKs are all Node-only — this route cannot run on the Edge runtime.
export const runtime = "nodejs";

/** Best-effort per-instance limit (see lib/utils/rate-limit.ts) — bounds accidental hammering, not a production abuse defense. */
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function malformedRequestBodyError(): AppError {
  return new AppError({
    code: "INVALID_CHAT_REQUEST",
    message: "Invalid chat request: request body must be valid JSON.",
    status: 400,
  });
}

function sseEvent(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  const rateLimit = checkRateLimit(`chat:${clientKeyFromRequest(request)}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds, "chat_request_failed");
  }

  const chatService = new ChatService();
  let prepared: PreparedChat;

  try {
    const payload = await request.json().catch(() => {
      throw malformedRequestBodyError();
    });
    const chatRequest = validateChatRequest(payload);
    prepared = await chatService.prepare(chatRequest);
  } catch (error) {
    return errorResponse(error, "chat_request_failed");
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of chatService.streamAnswer(prepared)) {
          controller.enqueue(encoder.encode(sseEvent(event)));
        }
      } catch (error) {
        // chatService.streamAnswer converts its own known failures into "error" events and
        // does not throw; this is a last-resort guard against anything truly unexpected.
        logger.error("chat_stream_failed", { error });
        controller.enqueue(
          encoder.encode(
            sseEvent({ type: "error", data: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
