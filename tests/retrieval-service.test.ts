import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  RetrievalService,
  type DocumentLookupCollection,
  type QueryEmbeddingGenerator,
  type RetrievalRequest,
} from "@/lib/services/retrieval.service";
import type { ChunksAggregateCollection } from "@/lib/db/vector-search";
import { AppError, isAppError } from "@/lib/utils/errors";
import { MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES } from "@/lib/config/document-limits";
import type { EmbeddingConfiguration, EmbeddingResult } from "@/lib/providers/embedding.provider";
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

function fakeDocumentsCollection(documents: DocumentEntity[]): DocumentLookupCollection {
  return {
    find: vi.fn((filter: { _id: { $in: ObjectId[] } }) => ({
      toArray: async () => {
        const ids = filter._id.$in.map((id) => id.toString());
        return documents.filter((doc) => ids.includes(doc._id.toString()));
      },
    })),
  } as unknown as DocumentLookupCollection;
}

interface FakeRow {
  _id: ObjectId;
  documentId: ObjectId;
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  score: number;
}

/** Returns rows keyed by which embeddingProvider the vector search's filter targets — robust to Promise.all's non-deterministic call ordering across embedding-configuration groups. */
function fakeChunksCollection(
  rowsByProvider: Record<string, FakeRow[]>,
): { collection: ChunksAggregateCollection; aggregate: ReturnType<typeof vi.fn> } {
  const aggregate = vi.fn((pipeline: Array<Record<string, unknown>>) => {
    const stage = pipeline[0].$vectorSearch as { filter: { $and: Array<Record<string, unknown>> } };
    const providerClause = stage.filter.$and.find((clause) => "embeddingProvider" in clause) as { embeddingProvider: string };
    const rows = rowsByProvider[providerClause.embeddingProvider] ?? [];
    return { toArray: async () => rows };
  });
  return { collection: { aggregate } as unknown as ChunksAggregateCollection, aggregate };
}

function failingChunksCollection(cause: unknown): ChunksAggregateCollection {
  return {
    aggregate: vi.fn(() => ({
      toArray: async () => {
        throw cause;
      },
    })),
  } as unknown as ChunksAggregateCollection;
}

function fakeEmbeddingGenerator(
  impl: (input: string, configuration: EmbeddingConfiguration) => Promise<EmbeddingResult>,
): QueryEmbeddingGenerator & { generateEmbeddingForConfiguration: ReturnType<typeof vi.fn> } {
  return { generateEmbeddingForConfiguration: vi.fn(impl) };
}

function requestFor(documents: DocumentEntity[], message = "What are the objectives of the project?"): RetrievalRequest {
  return { documentIds: documents.map((doc) => doc._id.toString()), message };
}

describe("RetrievalService — single document (backward compatible)", () => {
  it("generates the query embedding using the document's stored embedding configuration", async () => {
    const document = readyDocument({ embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 3 });
    const embeddingService = fakeEmbeddingGenerator(async () => ({
      vector: [0.1, 0.2, 0.3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
    }));
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);
    await service.retrieve(requestFor([document]));

    expect(embeddingService.generateEmbeddingForConfiguration).toHaveBeenCalledWith(
      "What are the objectives of the project?",
      { provider: "openai", model: "text-embedding-3-small", dimensions: 3 },
    );
  });

  it("returns top chunks in the public shape, including documentId/documentName, without the raw embedding vector or provider metadata", async () => {
    const document = readyDocument();
    const embeddingService = fakeEmbeddingGenerator(async () => ({
      vector: [0.1, 0.2, 0.3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
    }));
    const row: FakeRow = {
      _id: new ObjectId(),
      documentId: document._id,
      content: "Relevant chunk text.",
      pageNumber: 2,
      chunkIndex: 5,
      score: 0.93,
    };
    const { collection: chunks } = fakeChunksCollection({ openai: [row] });

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);
    const result = await service.retrieve(requestFor([document]));

    expect(result.documentIds).toEqual([document._id.toString()]);
    expect(result.query).toBe("What are the objectives of the project?");
    expect(result.chunks).toEqual([
      {
        id: row._id.toString(),
        documentId: document._id.toString(),
        documentName: document.name,
        content: row.content,
        pageNumber: row.pageNumber,
        chunkIndex: row.chunkIndex,
        score: row.score,
      },
    ]);
    result.chunks.forEach((chunk) => {
      expect(chunk).not.toHaveProperty("embedding");
      expect(chunk).not.toHaveProperty("vector");
      expect(chunk).not.toHaveProperty("embeddingProvider");
    });
  });

  it("rejects a documentId that is not a valid ObjectId", async () => {
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([]), async () => chunks);

    await expect(
      service.retrieve({ documentIds: ["not-a-valid-id"], message: "hello" }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "INVALID_DOCUMENT_ID");
  });

  it("throws DOCUMENT_NOT_FOUND when no document matches the id", async () => {
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection({});
    const documentId = new ObjectId().toString();

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([]), async () => chunks);

    await expect(
      service.retrieve({ documentIds: [documentId], message: "hello" }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_FOUND");
  });

  it("throws DOCUMENT_NOT_READY when the document status is not ready", async () => {
    const document = readyDocument({ status: "processing" });
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);

    await expect(service.retrieve(requestFor([document]))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_READY",
    );
    expect(embeddingService.generateEmbeddingForConfiguration).not.toHaveBeenCalled();
  });

  it("throws EMBEDDING_CONFIGURATION_MISSING when the document has no recorded embedding configuration", async () => {
    const document = readyDocument({ embeddingProvider: null, embeddingModel: null, embeddingDimensions: null });
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);

    await expect(service.retrieve(requestFor([document]))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISSING",
    );
  });

  it("propagates an embedding-generation failure without attempting a vector search", async () => {
    const document = readyDocument();
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new AppError({ code: "AI_PROVIDER_NOT_CONFIGURED", message: "No API key configured.", status: 503 });
    });
    const { collection: chunks, aggregate } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);

    await expect(service.retrieve(requestFor([document]))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "AI_PROVIDER_NOT_CONFIGURED",
    );
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("converts a vector search failure into a structured VECTOR_SEARCH_FAILED error, without leaking the raw cause", async () => {
    const document = readyDocument();
    const embeddingService = fakeEmbeddingGenerator(async () => ({
      vector: [0.1, 0.2, 0.3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
    }));
    const chunks = failingChunksCollection(new Error("connection reset by peer at 10.0.0.5:27017"));

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([document]), async () => chunks);

    await expect(service.retrieve(requestFor([document]))).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "VECTOR_SEARCH_FAILED" && !error.message.includes("10.0.0.5");
    });
  });
});

describe("RetrievalService — multiple documents, same embedding configuration", () => {
  it("queries once for both documents and merges their results", async () => {
    const documentA = readyDocument({ name: "a.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 3 });
    const documentB = readyDocument({ name: "b.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 3 });
    const embeddingService = fakeEmbeddingGenerator(async () => ({ vector: [0.1, 0.2, 0.3], provider: "openai", model: "text-embedding-3-small", dimensions: 3 }));
    const rowA: FakeRow = { _id: new ObjectId(), documentId: documentA._id, content: "From A", pageNumber: 1, chunkIndex: 0, score: 0.9 };
    const rowB: FakeRow = { _id: new ObjectId(), documentId: documentB._id, content: "From B", pageNumber: 1, chunkIndex: 0, score: 0.85 };
    const { collection: chunks, aggregate } = fakeChunksCollection({ openai: [rowA, rowB] });

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([documentA, documentB]), async () => chunks);
    const result = await service.retrieve(requestFor([documentA, documentB]));

    expect(embeddingService.generateEmbeddingForConfiguration).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(result.chunks.map((c) => c.documentName).sort()).toEqual(["a.pdf", "b.pdf"]);
  });
});

describe("RetrievalService — multiple documents, different embedding configurations", () => {
  it("generates a separate query embedding per configuration group, never reusing one embedding across groups", async () => {
    const openaiDoc = readyDocument({ name: "openai.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536 });
    const geminiDoc = readyDocument({ name: "gemini.pdf", embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({
      vector: configuration.provider === "openai" ? [1, 0, 0] : [0, 1, 0],
      ...configuration,
    }));
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([openaiDoc, geminiDoc]), async () => chunks);
    await service.retrieve(requestFor([openaiDoc, geminiDoc]));

    expect(embeddingService.generateEmbeddingForConfiguration).toHaveBeenCalledTimes(2);
    const configurationsUsed = embeddingService.generateEmbeddingForConfiguration.mock.calls.map((call) => call[1].provider).sort();
    expect(configurationsUsed).toEqual(["gemini", "openai"]);
  });

  it("restricts each group's vector search to only the documents in that group — never mixing incompatible vectors", async () => {
    const openaiDoc = readyDocument({ name: "openai.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536 });
    const geminiDoc = readyDocument({ name: "gemini.pdf", embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({
      vector: configuration.provider === "openai" ? [1, 0, 0] : [0, 1, 0],
      ...configuration,
    }));
    const { collection: chunks, aggregate } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([openaiDoc, geminiDoc]), async () => chunks);
    await service.retrieve(requestFor([openaiDoc, geminiDoc]));

    expect(aggregate).toHaveBeenCalledTimes(2);
    const stages = aggregate.mock.calls.map((call) => {
      const pipeline = call[0] as Array<Record<string, unknown>>;
      return pipeline[0].$vectorSearch as { filter: { $and: Array<Record<string, unknown>> } };
    });

    const openaiStage = stages.find((s) => s.filter.$and.some((c) => (c as { embeddingProvider?: string }).embeddingProvider === "openai"))!;
    const geminiStage = stages.find((s) => s.filter.$and.some((c) => (c as { embeddingProvider?: string }).embeddingProvider === "gemini"))!;

    expect(openaiStage.filter.$and).toContainEqual({ documentId: { $in: [openaiDoc._id] } });
    expect(geminiStage.filter.$and).toContainEqual({ documentId: { $in: [geminiDoc._id] } });
  });

  it("merges results from every group into one globally-ranked, bounded top-K", async () => {
    const openaiDoc = readyDocument({ name: "openai.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536 });
    const geminiDoc = readyDocument({ name: "gemini.pdf", embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({
      vector: [0.1],
      ...configuration,
    }));

    const openaiRows: FakeRow[] = [
      { _id: new ObjectId(), documentId: openaiDoc._id, content: "openai-1", pageNumber: 1, chunkIndex: 0, score: 0.92 },
      { _id: new ObjectId(), documentId: openaiDoc._id, content: "openai-2", pageNumber: 1, chunkIndex: 1, score: 0.6 },
    ];
    const geminiRows: FakeRow[] = [
      { _id: new ObjectId(), documentId: geminiDoc._id, content: "gemini-1", pageNumber: 1, chunkIndex: 0, score: 0.89 },
      { _id: new ObjectId(), documentId: geminiDoc._id, content: "gemini-2", pageNumber: 1, chunkIndex: 1, score: 0.81 },
    ];
    const { collection: chunks } = fakeChunksCollection({ openai: openaiRows, gemini: geminiRows });

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([openaiDoc, geminiDoc]), async () => chunks);
    const result = await service.retrieve(requestFor([openaiDoc, geminiDoc]));

    // Globally sorted by score, descending, across both groups.
    expect(result.chunks.map((c) => c.content)).toEqual(["openai-1", "gemini-1", "gemini-2", "openai-2"]);
    expect(result.chunks.map((c) => c.score)).toEqual([0.92, 0.89, 0.81, 0.6]);
  });

  it("bounds the final merged result even when every group individually returns its own top-K", async () => {
    const openaiDoc = readyDocument({ name: "openai.pdf", embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536 });
    const geminiDoc = readyDocument({ name: "gemini.pdf", embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({ vector: [0.1], ...configuration }));

    const makeRows = (doc: DocumentEntity, prefix: string): FakeRow[] =>
      Array.from({ length: 5 }, (_, i) => ({
        _id: new ObjectId(),
        documentId: doc._id,
        content: `${prefix}-${i}`,
        pageNumber: 1,
        chunkIndex: i,
        score: 0.9 - i * 0.01,
      }));

    const { collection: chunks } = fakeChunksCollection({
      openai: makeRows(openaiDoc, "openai"),
      gemini: makeRows(geminiDoc, "gemini"),
    });

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([openaiDoc, geminiDoc]), async () => chunks);
    const result = await service.retrieve(requestFor([openaiDoc, geminiDoc]));

    // 10 total candidates (5 per group) collapse to a single bounded global top-K.
    expect(result.chunks.length).toBeLessThanOrEqual(5);
  });
});

describe("RetrievalService — cumulative selection limits", () => {
  it("rejects a selection whose combined size exceeds the cumulative limit, without ever calling the embedding service", async () => {
    const documentA = readyDocument({ size: MAX_ACTIVE_SELECTION_TOTAL_SIZE_BYTES, pageCount: 1 });
    const documentB = readyDocument({ size: 1, pageCount: 1 });
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection({});

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection([documentA, documentB]), async () => chunks);

    await expect(service.retrieve(requestFor([documentA, documentB]))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "DOCUMENT_SELECTION_LIMIT_EXCEEDED",
    );
    expect(embeddingService.generateEmbeddingForConfiguration).not.toHaveBeenCalled();
  });
});
