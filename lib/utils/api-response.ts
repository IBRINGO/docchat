import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";

/**
 * Shared shape for a failed API route response: `{success:false, error:{code,message}}`.
 * An AppError's own code/message/status are trusted and returned as-is (they're already
 * curated to be client-safe); anything else is logged in full server-side and collapsed
 * into a generic 500 so raw stack traces / provider / MongoDB detail never reach the client.
 */
export function errorResponse(error: unknown, logEvent: string): Response {
  if (isAppError(error)) {
    logger.warn(logEvent, { code: error.code, status: error.status });
    return NextResponse.json(
      { success: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  logger.error(logEvent, { error });
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}

/** Shared 429 response shape for every rate-limited route (see lib/utils/rate-limit.ts). */
export function rateLimitedResponse(retryAfterSeconds: number, logEvent: string): Response {
  const error = new AppError({ code: "RATE_LIMITED", message: "Too many requests. Please try again shortly.", status: 429 });
  logger.warn(logEvent, { code: error.code, status: error.status });
  return NextResponse.json(
    { success: false, error: { code: error.code, message: error.message } },
    { status: error.status, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
