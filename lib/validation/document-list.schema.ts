import { z } from "zod";
import { AppError } from "@/lib/utils/errors";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface DocumentListQuery {
  q?: string;
  status?: "processing" | "ready" | "failed";
  page: number;
  limit: number;
}

function invalidDocumentListRequestError(reason: string): AppError {
  return new AppError({
    code: "INVALID_DOCUMENT_LIST_REQUEST",
    message: `Invalid document list request: ${reason}`,
    status: 400,
  });
}

const documentListQuerySchema = z.object({
  q: z.string().trim().min(1, "q must not be empty").max(200, "q must be at most 200 characters").optional(),
  status: z.enum(["processing", "ready", "failed"]),
  page: z.coerce.number().int("page must be an integer").min(1, "page must be at least 1"),
  limit: z.coerce
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`),
}).partial({ status: true, page: true, limit: true });

/**
 * Reads `q`, `status`, `page`, `limit` off a URL's search params and validates them.
 * An absent or blank param is treated as "not provided" (falls back to its default,
 * or stays unset for optional filters) rather than a validation error.
 */
export function parseDocumentListQuery(searchParams: URLSearchParams): DocumentListQuery {
  const raw: Record<string, string> = {};
  for (const key of ["q", "status", "page", "limit"]) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== "") raw[key] = value;
  }

  const parsed = documentListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidDocumentListRequestError(parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  return {
    q: parsed.data.q,
    status: parsed.data.status,
    page: parsed.data.page ?? DEFAULT_PAGE,
    limit: parsed.data.limit ?? DEFAULT_LIMIT,
  };
}
