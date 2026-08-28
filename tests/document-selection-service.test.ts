import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  resolveAndValidateDocuments,
  type DocumentLookupCollection,
} from "@/lib/services/document-selection.service";
import { isAppError } from "@/lib/utils/errors";
import { MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES } from "@/lib/config/document-limits";
import type { Document as DocumentEntity } from "@/types/document";

function readyDocument(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  const now = new Date();
  return {
    _id: new ObjectId(),
    name: "resume.pdf",
    size: 1234,
    mimeType: "application/pdf",
    pageCount: 2,
    chunkCount: 4,
    status: "ready",
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 3,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeDocumentsCollection(documents: DocumentEntity[]): { collection: DocumentLookupCollection; find: ReturnType<typeof vi.fn> } {
  const find = vi.fn((filter: { _id: { $in: ObjectId[] } }) => ({
    toArray: async () => {
      const ids = filter._id.$in.map((id) => id.toString());
      return documents.filter((doc) => ids.includes(doc._id.toString()));
    },
  }));
  return { collection: { find } as unknown as DocumentLookupCollection, find };
}

/**
 * Shared, service-level tests for the validation RetrievalService and
 * POST /api/conversations both delegate to — see
 * lib/services/document-selection.service.ts's doc comment for why this was
 * extracted rather than duplicated. RetrievalService's own tests
 * (tests/retrieval-service.test.ts) already exercise these same rules
 * end-to-end through retrieve(); these focus on the shared function directly.
 */
describe("resolveAndValidateDocuments", () => {
  it("returns the matching documents for a valid, ready selection", async () => {
    const doc = readyDocument();
    const { collection } = fakeDocumentsCollection([doc]);

    const result = await resolveAndValidateDocuments([doc._id.toString()], async () => collection);

    expect(result).toEqual([doc]);
  });

  it("deduplicates document IDs before querying", async () => {
    const doc = readyDocument();
    const { collection, find } = fakeDocumentsCollection([doc]);
    const id = doc._id.toString();

    const result = await resolveAndValidateDocuments([id, id, id], async () => collection);

    expect(result).toHaveLength(1);
    const filter = find.mock.calls[0][0] as { _id: { $in: ObjectId[] } };
    expect(filter._id.$in).toHaveLength(1);
  });

  it("throws INVALID_DOCUMENT_ID for a malformed id", async () => {
    const { collection } = fakeDocumentsCollection([]);

    await expect(resolveAndValidateDocuments(["not-an-object-id"], async () => collection)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "INVALID_DOCUMENT_ID",
    );
  });

  it("throws DOCUMENT_NOT_FOUND when a requested document doesn't exist", async () => {
    const doc = readyDocument();
    const { collection } = fakeDocumentsCollection([doc]);
    const missingId = new ObjectId().toString();

    await expect(resolveAndValidateDocuments([doc._id.toString(), missingId], async () => collection)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_FOUND",
    );
  });

  it("throws DOCUMENT_NOT_READY when a requested document isn't ready", async () => {
    const doc = readyDocument({ status: "processing" });
    const { collection } = fakeDocumentsCollection([doc]);

    await expect(resolveAndValidateDocuments([doc._id.toString()], async () => collection)).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_READY",
    );
  });

  it("throws DOCUMENT_SELECTION_LIMIT_EXCEEDED when the combined selection exceeds the cumulative size limit", async () => {
    const docA = readyDocument({ size: MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES });
    const docB = readyDocument({ size: 1 });
    const { collection } = fakeDocumentsCollection([docA, docB]);

    await expect(
      resolveAndValidateDocuments([docA._id.toString(), docB._id.toString()], async () => collection),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "DOCUMENT_SELECTION_LIMIT_EXCEEDED");
  });
});
