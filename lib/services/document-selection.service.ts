import { ObjectId, type Collection } from "mongodb";
import { getDocumentsCollection } from "@/lib/db/collections";
import { validateSelectionSet, type SelectableDocument } from "@/lib/validation/document-selection";
import { AppError } from "@/lib/utils/errors";
import type { Document as DocumentEntity, DocumentStatus } from "@/types/document";

/** The slice of Collection<Document> this module actually calls — small enough to fake directly in tests. */
export type DocumentLookupCollection = Pick<Collection<DocumentEntity>, "find">;

export function invalidDocumentIdError(): AppError {
  return new AppError({
    code: "INVALID_DOCUMENT_ID",
    message: "One or more documentIds are not valid identifiers.",
    status: 400,
  });
}

export function documentNotFoundError(): AppError {
  return new AppError({
    code: "DOCUMENT_NOT_FOUND",
    message: "One or more of the selected documents could not be found.",
    status: 404,
  });
}

export function documentNotReadyError(status: DocumentStatus): AppError {
  return new AppError({
    code: "DOCUMENT_NOT_READY",
    message: `One or more of the selected documents is not ready for retrieval (status: ${status}).`,
    status: 409,
  });
}

export function documentSelectionLimitExceededError(reason: "MAX_TOTAL_SIZE" | "MAX_TOTAL_PAGES" | "MAX_TOTAL_SIZE_AND_PAGES"): AppError {
  const messages: Record<typeof reason, string> = {
    MAX_TOTAL_SIZE: "The selected documents exceed the maximum combined size allowed for one chat request.",
    MAX_TOTAL_PAGES: "The selected documents exceed the maximum combined page count allowed for one chat request.",
    MAX_TOTAL_SIZE_AND_PAGES: "The selected documents exceed both the maximum combined size and page count allowed for one chat request.",
  };
  return new AppError({ code: "DOCUMENT_SELECTION_LIMIT_EXCEEDED", message: messages[reason], status: 400 });
}

/**
 * Resolves and validates a set of document IDs against everything a document
 * selection must satisfy before it can be used for anything — chat retrieval
 * (lib/services/retrieval.service.ts) or explicitly creating a conversation
 * (POST /api/conversations): every ID must be a valid ObjectId, every
 * document must exist, every document must be "ready", and the combined
 * selection must respect the cumulative size/page limits
 * (lib/config/document-limits.ts). Extracted here so both callers share one
 * implementation instead of re-validating the same rules two different ways —
 * the frontend's own selection UI is never trusted as the sole authority.
 * Duplicate IDs are deduplicated, not rejected.
 */
export async function resolveAndValidateDocuments(
  documentIds: string[],
  getDocuments: () => Promise<DocumentLookupCollection> = getDocumentsCollection,
): Promise<DocumentEntity[]> {
  const uniqueIds = Array.from(new Set(documentIds));

  let objectIds: ObjectId[];
  try {
    objectIds = uniqueIds.map((id) => new ObjectId(id));
  } catch {
    throw invalidDocumentIdError();
  }

  const documentsCollection = await getDocuments();
  const documents = await documentsCollection.find({ _id: { $in: objectIds } }).toArray();

  if (documents.length !== objectIds.length) {
    throw documentNotFoundError();
  }

  const notReady = documents.find((document) => document.status !== "ready");
  if (notReady) {
    throw documentNotReadyError(notReady.status);
  }

  const selectable: SelectableDocument[] = documents.map((document) => ({
    id: document._id.toString(),
    status: document.status,
    size: document.size,
    pageCount: document.pageCount,
  }));
  const selectionValidation = validateSelectionSet(selectable);
  if (!selectionValidation.valid) {
    throw documentSelectionLimitExceededError(selectionValidation.reason!);
  }

  return documents;
}
