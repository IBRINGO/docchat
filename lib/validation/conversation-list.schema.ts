import { z } from "zod";
import { AppError } from "@/lib/utils/errors";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ConversationListQuery {
  page: number;
  limit: number;
}

function invalidConversationListRequestError(reason: string): AppError {
  return new AppError({
    code: "INVALID_CONVERSATION_LIST_REQUEST",
    message: `Invalid conversation list request: ${reason}`,
    status: 400,
  });
}

const conversationListQuerySchema = z
  .object({
    page: z.coerce.number().int("page must be an integer").min(1, "page must be at least 1"),
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`),
  })
  .partial();

/** Reads `page`/`limit` off a URL's search params and validates them — an absent or blank param falls back to its default. */
export function parseConversationListQuery(searchParams: URLSearchParams): ConversationListQuery {
  const raw: Record<string, string> = {};
  for (const key of ["page", "limit"]) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== "") raw[key] = value;
  }

  const parsed = conversationListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidConversationListRequestError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return { page: parsed.data.page ?? DEFAULT_PAGE, limit: parsed.data.limit ?? DEFAULT_LIMIT };
}
