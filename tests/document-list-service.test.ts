import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { listDocuments, type DocumentsQueryCollection } from "@/lib/services/document-list.service";
import type { Document as DocumentEntity } from "@/types/document";

function makeDocument(overrides: Partial<DocumentEntity> = {}): DocumentEntity {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    _id: new ObjectId(),
    name: "report.pdf",
    size: 123,
    mimeType: "application/pdf",
    pageCount: 10,
    chunkCount: 5,
    status: "ready",
    embeddingProvider: "gemini",
    embeddingModel: "gemini-embedding-2",
    embeddingDimensions: 1536,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeCollection(
  records: DocumentEntity[],
  total?: number,
): { collection: DocumentsQueryCollection; findFilter: unknown[]; countFilter: unknown[] } {
  const findFilter: unknown[] = [];
  const countFilter: unknown[] = [];

  const collection = {
    countDocuments: vi.fn(async (filter: unknown) => {
      countFilter.push(filter);
      return total ?? records.length;
    }),
    find: vi.fn((filter: unknown) => {
      findFilter.push(filter);
      return {
        sort: () => ({
          skip: (skip: number) => ({
            limit: (limit: number) => ({
              toArray: async () => records.slice(skip, skip + limit),
            }),
          }),
        }),
      };
    }),
  } as unknown as DocumentsQueryCollection;

  return { collection, findFilter, countFilter };
}

describe("listDocuments", () => {
  it("maps documents to the public summary shape, excluding embedding metadata", async () => {
    const doc = makeDocument();
    const { collection } = fakeCollection([doc]);

    const result = await listDocuments({ page: 1, limit: 20 }, async () => collection);

    expect(result.documents).toEqual([
      {
        id: doc._id.toString(),
        fileName: "report.pdf",
        mimeType: "application/pdf",
        size: 123,
        pageCount: 10,
        chunkCount: 5,
        status: "ready",
        createdAt: doc.createdAt.toISOString(),
      },
    ]);
    expect(result.documents[0]).not.toHaveProperty("embeddingProvider");
    expect(result.documents[0]).not.toHaveProperty("embeddingModel");
    expect(result.documents[0]).not.toHaveProperty("embeddingDimensions");
  });

  it("includes errorMessage only for a failed document", async () => {
    const failed = makeDocument({ status: "failed", errorMessage: "The document could not be persisted." });
    const { collection } = fakeCollection([failed]);

    const result = await listDocuments({ page: 1, limit: 20 }, async () => collection);

    expect(result.documents[0].errorMessage).toBe("The document could not be persisted.");
  });

  it("omits errorMessage for a ready document even if the field were somehow set", async () => {
    const doc = makeDocument({ status: "ready" });
    const { collection } = fakeCollection([doc]);

    const result = await listDocuments({ page: 1, limit: 20 }, async () => collection);

    expect(result.documents[0]).not.toHaveProperty("errorMessage");
  });

  it("builds a status-equality filter when status is provided", async () => {
    const { collection, findFilter } = fakeCollection([]);
    await listDocuments({ status: "ready", page: 1, limit: 20 }, async () => collection);
    expect(findFilter[0]).toEqual({ status: "ready" });
  });

  it("builds a case-insensitive filename regex filter when q is provided", async () => {
    const { collection, findFilter } = fakeCollection([]);
    await listDocuments({ q: "report", page: 1, limit: 20 }, async () => collection);
    expect(findFilter[0]).toEqual({ name: { $regex: "report", $options: "i" } });
  });

  it("escapes regex metacharacters in the search term", async () => {
    const { collection, findFilter } = fakeCollection([]);
    await listDocuments({ q: "a.b*c", page: 1, limit: 20 }, async () => collection);
    expect((findFilter[0] as { name: { $regex: string } }).name.$regex).toBe("a\\.b\\*c");
  });

  it("combines status and q into one filter", async () => {
    const { collection, findFilter } = fakeCollection([]);
    await listDocuments({ q: "report", status: "failed", page: 1, limit: 20 }, async () => collection);
    expect(findFilter[0]).toEqual({ status: "failed", name: { $regex: "report", $options: "i" } });
  });

  it("computes pagination totals and skip/limit correctly", async () => {
    const docs = Array.from({ length: 5 }, (_, i) => makeDocument({ name: `doc-${i}.pdf` }));
    const { collection } = fakeCollection(docs, 42);

    const result = await listDocuments({ page: 2, limit: 5 }, async () => collection);

    expect(result.pagination).toEqual({ page: 2, limit: 5, total: 42, totalPages: 9 });
  });

  it("returns an empty list and zero totalPages when there are no matches", async () => {
    const { collection } = fakeCollection([], 0);
    const result = await listDocuments({ page: 1, limit: 20 }, async () => collection);

    expect(result.documents).toEqual([]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
