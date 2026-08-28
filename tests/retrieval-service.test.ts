import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  RetrievalService,
  type DocumentLookupCollection,
  type QueryEmbeddingGenerator,
} from "@/lib/services/retrieval.service";
import type { ChunksAggregateCollection } from "@/lib/db/vector-search";
import { AppError, isAppError } from "@/lib/utils/errors";
import type { EmbeddingConfiguration, EmbeddingResult } from "@/lib/providers/embedding.provider";
import type { Document as DocumentEntity } from "@/types/document";
import type { ChatRequest } from "@/lib/validation/chat.schema";

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

function fakeDocumentsCollection(document: DocumentEntity | null): DocumentLookupCollection {
  return { findOne: vi.fn(async () => document) } as unknown as DocumentLookupCollection;
}

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

function chatRequestFor(document: DocumentEntity, message = "What are the objectives of the project?"): ChatRequest {
  return { documentId: document._id.toString(), message };
}

describe("RetrievalService", () => {
  it("generates the query embedding using the document's stored embedding configuration", async () => {
    const document = readyDocument({ embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 3 });
    const embeddingService = fakeEmbeddingGenerator(async () => ({
      vector: [0.1, 0.2, 0.3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
    }));
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);
    await service.retrieve(chatRequestFor(document));

    expect(embeddingService.generateEmbeddingForConfiguration).toHaveBeenCalledWith(
      "What are the objectives of the project?",
      { provider: "openai", model: "text-embedding-3-small", dimensions: 3 },
    );
  });

  it("an OpenAI-configured document requests an OpenAI query embedding, not Gemini", async () => {
    const document = readyDocument({ embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 3 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({
      vector: [0.1, 0.2, 0.3],
      ...configuration,
    }));
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);
    await service.retrieve(chatRequestFor(document));

    const [, configuration] = embeddingService.generateEmbeddingForConfiguration.mock.calls[0];
    expect(configuration.provider).toBe("openai");
  });

  it("a Gemini-configured document requests a Gemini query embedding, not OpenAI", async () => {
    const document = readyDocument({ embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 1536 });
    const embeddingService = fakeEmbeddingGenerator(async (_input, configuration) => ({
      vector: new Array(1536).fill(0.01),
      ...configuration,
    }));
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);
    await service.retrieve(chatRequestFor(document));

    const [, configuration] = embeddingService.generateEmbeddingForConfiguration.mock.calls[0];
    expect(configuration.provider).toBe("gemini");
    expect(configuration.model).toBe("gemini-embedding-2");
  });

  it("scopes the vector search filter to the document id, embedding provider, and embedding model", async () => {
    const document = readyDocument({ embeddingProvider: "gemini", embeddingModel: "gemini-embedding-2", embeddingDimensions: 4 });
    const embeddingService = fakeEmbeddingGenerator(async () => ({
      vector: [1, 2, 3, 4],
      provider: "gemini",
      model: "gemini-embedding-2",
      dimensions: 4,
    }));
    const { collection: chunks, aggregate } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);
    await service.retrieve(chatRequestFor(document));

    const pipeline = aggregate.mock.calls[0][0] as Array<Record<string, unknown>>;
    const stage = pipeline[0].$vectorSearch as { queryVector: number[]; filter: { $and: Array<Record<string, unknown>> } };

    expect(stage.queryVector).toEqual([1, 2, 3, 4]);
    expect(stage.filter.$and).toContainEqual({ documentId: document._id });
    expect(stage.filter.$and).toContainEqual({ embeddingProvider: "gemini" });
    expect(stage.filter.$and).toContainEqual({ embeddingModel: "gemini-embedding-2" });
  });

  it("returns top chunks in the public shape, without the raw embedding vector or provider metadata", async () => {
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
    const { collection: chunks } = fakeChunksCollection([row]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);
    const result = await service.retrieve(chatRequestFor(document));

    expect(result.documentId).toBe(document._id.toString());
    expect(result.query).toBe("What are the objectives of the project?");
    expect(result.chunks).toEqual([
      { id: row._id.toString(), content: row.content, pageNumber: row.pageNumber, chunkIndex: row.chunkIndex, score: row.score },
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
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(null), async () => chunks);

    await expect(
      service.retrieve({ documentId: "not-a-valid-id", message: "hello" }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "INVALID_DOCUMENT_ID");
  });

  it("throws DOCUMENT_NOT_FOUND when no document matches the id", async () => {
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection([]);
    const documentId = new ObjectId().toString();

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(null), async () => chunks);

    await expect(
      service.retrieve({ documentId, message: "hello" }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_FOUND");
  });

  it("throws DOCUMENT_NOT_READY when the document status is not ready", async () => {
    const document = readyDocument({ status: "processing" });
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);

    await expect(service.retrieve(chatRequestFor(document))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "DOCUMENT_NOT_READY",
    );
    expect(embeddingService.generateEmbeddingForConfiguration).not.toHaveBeenCalled();
  });

  it("throws EMBEDDING_CONFIGURATION_MISSING when the document has no recorded embedding configuration", async () => {
    const document = readyDocument({ embeddingProvider: null, embeddingModel: null, embeddingDimensions: null });
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new Error("must not be called");
    });
    const { collection: chunks } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);

    await expect(service.retrieve(chatRequestFor(document))).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISSING",
    );
  });

  it("propagates an embedding-generation failure without attempting a vector search", async () => {
    const document = readyDocument();
    const embeddingService = fakeEmbeddingGenerator(async () => {
      throw new AppError({
        code: "AI_PROVIDER_NOT_CONFIGURED",
        message: "No API key configured.",
        status: 503,
      });
    });
    const { collection: chunks, aggregate } = fakeChunksCollection([]);

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);

    await expect(service.retrieve(chatRequestFor(document))).rejects.toSatisfy(
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

    const service = new RetrievalService(embeddingService, async () => fakeDocumentsCollection(document), async () => chunks);

    await expect(service.retrieve(chatRequestFor(document))).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "VECTOR_SEARCH_FAILED" && !error.message.includes("10.0.0.5");
    });
  });
});
