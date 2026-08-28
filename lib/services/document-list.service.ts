import type { Collection, Filter } from "mongodb";
import { getDocumentsCollection } from "@/lib/db/collections";
import type { Document as DocumentEntity, DocumentStatus } from "@/types/document";
import type { DocumentListQuery } from "@/lib/validation/document-list.schema";

/** The slice of Collection<Document> this module actually calls — small enough to fake directly in tests. */
export type DocumentsQueryCollection = Pick<Collection<DocumentEntity>, "find" | "countDocuments">;

/** The public shape of one document in a listing — deliberately excludes embedding metadata and internal fields not useful to a document-picker UI. */
export interface DocumentSummary {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  pageCount: number | null;
  chunkCount: number;
  status: DocumentStatus;
  createdAt: string;
  /** Only present for status "failed" — a curated, non-sensitive message (never a raw provider/DB error; see DocumentIngestionService). */
  errorMessage?: string;
}

export interface DocumentListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DocumentListResult {
  documents: DocumentSummary[];
  pagination: DocumentListPagination;
}

/** Escapes regex metacharacters so a filename search term is matched literally, never interpreted as a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSummary(doc: DocumentEntity): DocumentSummary {
  return {
    id: doc._id.toString(),
    fileName: doc.name,
    mimeType: doc.mimeType,
    size: doc.size,
    pageCount: doc.pageCount,
    chunkCount: doc.chunkCount,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    ...(doc.status === "failed" && doc.errorMessage ? { errorMessage: doc.errorMessage } : {}),
  };
}

/**
 * Lists documents with optional filename search (case-insensitive substring)
 * and status filtering, sorted newest-first (matches the existing
 * `documents_createdAt` index — no new index needed for this query shape at
 * this project's scale).
 */
export async function listDocuments(
  query: DocumentListQuery,
  getDocuments: () => Promise<DocumentsQueryCollection> = getDocumentsCollection,
): Promise<DocumentListResult> {
  const collection = await getDocuments();

  const filter: Filter<DocumentEntity> = {};
  if (query.status) filter.status = query.status;
  if (query.q) filter.name = { $regex: escapeRegExp(query.q), $options: "i" };

  const skip = (query.page - 1) * query.limit;

  const [total, records] = await Promise.all([
    collection.countDocuments(filter),
    collection.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).toArray(),
  ]);

  return {
    documents: records.map(toSummary),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}
