import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/validation/upload.schema";

/** Mirrors the assessment's stated page limit (~50 pages) for a single document. */
export const MAX_DOCUMENT_PAGE_COUNT = 50;

/**
 * Cumulative limits for an active multi-document chat selection. These are
 * intentionally EQUAL to the single-document limits, not a multiple of them
 * — multi-document support extends what the app can do with the same total
 * processing budget the assessment specifies for one document, it must never
 * let selecting more documents raise the effective ceiling. See README,
 * "Why multi-document support does not multiply the original limits."
 */
export const MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES = MAX_UPLOAD_SIZE_BYTES;
export const MAX_ACTIVE_SELECTION_TOTAL_PAGES = MAX_DOCUMENT_PAGE_COUNT;

/**
 * No cap on the number of selected documents yet — the total size/page
 * limits above are the real constraint, and an arbitrary document-count cap
 * would be redundant with them. Left as an explicit, centralized (currently
 * unenforced) hook so a future limit doesn't require restructuring callers.
 */
export const MAX_ACTIVE_SELECTION_DOCUMENT_COUNT: number | null = null;
