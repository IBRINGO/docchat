import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { vectorSearchChunks, DEFAULT_VECTOR_SEARCH_NUM_CANDIDATES, type ChunksAggregateCollection } from "@/lib/db/vector-search";
import { isAppError } from "@/lib/utils/errors";

interface FakeRow {
  _id: ObjectId;
  documentId: ObjectId;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  score: number;
}

function fakeChunksCollection(rows: FakeRow[] = []): { collection: ChunksAggregateCollection; aggregate: ReturnType<typeof vi.fn> } {
  const aggregate = vi.fn(() => ({ toArray: async () => rows }));
  return { collection: { aggregate } as unknown as ChunksAggregateCollection, aggregate };
}

function fakeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    _id: new ObjectId(),
    documentId: new ObjectId(),
    content: "Some retrieved chunk text.",
    pageNumber: 1,
    chunkIndex: 0,
    score: 0.87,
    ...overrides,
  };
}

describe("vectorSearchChunks", () => {
  it("scopes the query to documentIds, embeddingProvider, and embeddingModel", async () => {
    const documentId = new ObjectId();
    const { collection, aggregate } = fakeChunksCollection([]);

    await vectorSearchChunks(collection, {
      documentIds: [documentId],
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      queryVector: [0.1, 0.2, 0.3],
      limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const vectorSearchStage = pipeline[0].$vectorSearch as {
      path: string;
      queryVector: number[];
      limit: number;
      numCandidates: number;
      filter: { $and: Array<Record<string, unknown>> };
    };

    expect(vectorSearchStage.path).toBe("embedding");
    expect(vectorSearchStage.queryVector).toEqual([0.1, 0.2, 0.3]);
    expect(vectorSearchStage.limit).toBe(5);
    expect(vectorSearchStage.filter.$and).toContainEqual({ documentId: { $in: [documentId] } });
    expect(vectorSearchStage.filter.$and).toContainEqual({ embeddingProvider: "openai" });
    expect(vectorSearchStage.filter.$and).toContainEqual({ embeddingModel: "text-embedding-3-small" });
  });

  it("scopes the query to multiple document IDs sharing one embedding configuration", async () => {
    const documentA = new ObjectId();
    const documentB = new ObjectId();
    const { collection, aggregate } = fakeChunksCollection([]);

    await vectorSearchChunks(collection, {
      documentIds: [documentA, documentB],
      embeddingProvider: "gemini",
      embeddingModel: "gemini-embedding-2",
      queryVector: [0.1],
      limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const vectorSearchStage = pipeline[0].$vectorSearch as { filter: { $and: Array<Record<string, unknown>> } };
    expect(vectorSearchStage.filter.$and).toContainEqual({ documentId: { $in: [documentA, documentB] } });
  });

  it("defaults numCandidates when none is provided", async () => {
    const { collection, aggregate } = fakeChunksCollection([]);

    await vectorSearchChunks(collection, {
      documentIds: [new ObjectId()],
      embeddingProvider: "gemini",
      embeddingModel: "gemini-embedding-2",
      queryVector: [0.1],
      limit: 5,
    });

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const vectorSearchStage = pipeline[0].$vectorSearch as { numCandidates: number };
    expect(vectorSearchStage.numCandidates).toBe(DEFAULT_VECTOR_SEARCH_NUM_CANDIDATES);
  });

  it("honors an explicit numCandidates override", async () => {
    const { collection, aggregate } = fakeChunksCollection([]);

    await vectorSearchChunks(collection, {
      documentIds: [new ObjectId()],
      embeddingProvider: "gemini",
      embeddingModel: "gemini-embedding-2",
      queryVector: [0.1],
      limit: 5,
      numCandidates: 77,
    });

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const vectorSearchStage = pipeline[0].$vectorSearch as { numCandidates: number };
    expect(vectorSearchStage.numCandidates).toBe(77);
  });

  it("maps aggregation results to hits without leaking unexpected fields", async () => {
    const row = fakeRow();
    const { collection } = fakeChunksCollection([row]);

    const hits = await vectorSearchChunks(collection, {
      documentIds: [row.documentId],
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      queryVector: [0.1],
      limit: 5,
    });

    expect(hits).toEqual([
      {
        id: row._id,
        documentId: row.documentId,
        content: row.content,
        pageNumber: row.pageNumber,
        chunkIndex: row.chunkIndex,
        score: row.score,
      },
    ]);
  });

  it("converts an aggregation failure into a structured VECTOR_SEARCH_FAILED error, without leaking the raw cause", async () => {
    const aggregate = vi.fn(() => ({
      toArray: async () => {
        throw new Error("Index 'chunks_vector_index' not found — internal Atlas cluster detail leaked here");
      },
    }));
    const collection = { aggregate } as unknown as ChunksAggregateCollection;

    await expect(
      vectorSearchChunks(collection, {
        documentIds: [new ObjectId()],
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        queryVector: [0.1],
        limit: 5,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isAppError(error) &&
        error.code === "VECTOR_SEARCH_FAILED" &&
        !error.message.includes("chunks_vector_index") &&
        !error.message.includes("Atlas cluster")
      );
    });
  });
});
