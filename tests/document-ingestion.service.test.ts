import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  DocumentIngestionService,
  type ChunksCollectionLike,
  type DocumentsCollectionLike,
  type EmbeddingGenerator,
} from "@/lib/services/document-ingestion.service";
import { isAppError } from "@/lib/utils/errors";
import type { ExtractedDocument } from "@/lib/pdf/types";
import type { EmbeddingResult } from "@/lib/providers/embedding.provider";
import type { Document as DocumentEntity } from "@/types/document";
import type { Chunk } from "@/types/chunk";

vi.mock("@/lib/pdf/extract", () => ({
  extractPdf: vi.fn(),
}));

import { extractPdf } from "@/lib/pdf/extract";

const mockedExtractPdf = vi.mocked(extractPdf);

function twoPageExtractedDocument(): ExtractedDocument {
  return {
    pageCount: 2,
    pages: [
      { pageNumber: 1, text: "First page content about DocChat." },
      { pageNumber: 2, text: "Second page content about ingestion." },
    ],
  };
}

function fakeEmbeddingGenerator(
  impl?: (inputs: string[]) => Promise<EmbeddingResult[]>,
): EmbeddingGenerator & { generateEmbeddings: ReturnType<typeof vi.fn> } {
  const defaultImpl = async (inputs: string[]): Promise<EmbeddingResult[]> =>
    inputs.map((_, i) => ({ vector: [i, i + 1], provider: "openai" as const, model: "text-embedding-3-small", dimensions: 2 }));

  return { generateEmbeddings: vi.fn(impl ?? defaultImpl) };
}

function fakeDocumentsCollection(
  overrides: Partial<DocumentsCollectionLike> = {},
): DocumentsCollectionLike & { [K in keyof DocumentsCollectionLike]: ReturnType<typeof vi.fn> } {
  return {
    insertOne: vi.fn(async () => ({ acknowledged: true, insertedId: new ObjectId() })),
    findOneAndUpdate: vi.fn(async (): Promise<DocumentEntity | null> => null),
    updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null })),
    ...overrides,
  } as never;
}

function fakeChunksCollection(
  overrides: Partial<ChunksCollectionLike> = {},
): ChunksCollectionLike & { [K in keyof ChunksCollectionLike]: ReturnType<typeof vi.fn> } {
  return {
    insertMany: vi.fn(async (docs: Chunk[]) => ({
      acknowledged: true,
      insertedCount: docs.length,
      insertedIds: {},
    })),
    deleteMany: vi.fn(async () => ({ acknowledged: true, deletedCount: 0 })),
    ...overrides,
  } as never;
}

describe("DocumentIngestionService", () => {
  it("extracts, chunks, embeds, and persists — chunk content maps 1:1 to embeddings in order", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const embeddingService = fakeEmbeddingGenerator();
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(
      embeddingService,
      async () => documents,
      async () => chunks,
    );

    await service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") });

    expect(embeddingService.generateEmbeddings).toHaveBeenCalledWith([
      "First page content about DocChat.",
      "Second page content about ingestion.",
    ]);

    const insertedChunks = chunks.insertMany.mock.calls[0][0] as Chunk[];
    expect(insertedChunks).toHaveLength(2);
    expect(insertedChunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(insertedChunks.map((c) => c.pageNumber)).toEqual([1, 2]);
    expect(insertedChunks.map((c) => c.embedding)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("stores the document's embeddingConfiguration matching the embedding provider's result", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const embeddingService = fakeEmbeddingGenerator(async (inputs) =>
      inputs.map(() => ({ vector: [0.1, 0.2, 0.3], provider: "gemini" as const, model: "gemini-embedding-2", dimensions: 3 })),
    );
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(embeddingService, async () => documents, async () => chunks);
    await service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") });

    const insertedDocument = documents.insertOne.mock.calls[0][0] as DocumentEntity;
    expect(insertedDocument.embeddingProvider).toBe("gemini");
    expect(insertedDocument.embeddingModel).toBe("gemini-embedding-2");
    expect(insertedDocument.embeddingDimensions).toBe(3);
    expect(insertedDocument.pageCount).toBe(2);
    expect(insertedDocument.chunkCount).toBe(2);
    expect(insertedDocument.status).toBe("processing"); // the initial insert, before the ready update
  });

  it("marks the document ready after a successful persistence", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(fakeEmbeddingGenerator(), async () => documents, async () => chunks);
    const result = await service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") });

    expect(documents.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "ready" }) }),
      expect.anything(),
    );
    expect(result.document.status).toBe("ready");
  });

  it("fails when the embedding count does not match the chunk count", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const embeddingService = fakeEmbeddingGenerator(async () => [
      { vector: [1], provider: "openai", model: "text-embedding-3-small", dimensions: 1 },
    ]);
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(embeddingService, async () => documents, async () => chunks);

    await expect(
      service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "DOCUMENT_INGESTION_FAILED");

    expect(documents.insertOne).not.toHaveBeenCalled();
  });

  it("fails before persistence when the embedding batch has an inconsistent provider/model/dimensions", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const embeddingService = fakeEmbeddingGenerator(async () => [
      { vector: [1, 2], provider: "openai", model: "text-embedding-3-small", dimensions: 2 },
      { vector: [1, 2, 3], provider: "openai", model: "text-embedding-3-small", dimensions: 3 },
    ]);
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(embeddingService, async () => documents, async () => chunks);

    await expect(
      service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "EMBEDDING_CONFIGURATION_MISMATCH");

    expect(documents.insertOne).not.toHaveBeenCalled();
    expect(chunks.insertMany).not.toHaveBeenCalled();
  });

  it("cleans up on a chunk-insertion failure: deletes any inserted chunks and marks the document failed", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection({
      insertMany: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });

    const service = new DocumentIngestionService(fakeEmbeddingGenerator(), async () => documents, async () => chunks);

    await expect(
      service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "DOCUMENT_INGESTION_FAILED");

    expect(documents.insertOne).toHaveBeenCalledTimes(1);
    expect(chunks.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ documentId: expect.any(ObjectId) }));
    expect(documents.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(ObjectId) }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) }),
    );
    // The "ready" update must never fire once persistence has already failed.
    expect(documents.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("does not expose the raw underlying persistence error", async () => {
    mockedExtractPdf.mockResolvedValue(twoPageExtractedDocument());
    const documents = fakeDocumentsCollection({
      insertOne: vi.fn(async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:27017 — internal connection string leaked here");
      }),
    });
    const chunks = fakeChunksCollection();

    const service = new DocumentIngestionService(fakeEmbeddingGenerator(), async () => documents, async () => chunks);

    await expect(
      service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") }),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        isAppError(error) &&
        error.code === "DOCUMENT_INGESTION_FAILED" &&
        !error.message.includes("ECONNREFUSED") &&
        !error.message.includes("10.0.0.1")
      );
    });
  });

  it("never touches the database when extraction fails", async () => {
    const { pdfTextNotExtractableError } = await import("@/lib/pdf/errors");
    mockedExtractPdf.mockRejectedValue(pdfTextNotExtractableError());

    const documents = fakeDocumentsCollection();
    const chunks = fakeChunksCollection();
    const service = new DocumentIngestionService(fakeEmbeddingGenerator(), async () => documents, async () => chunks);

    await expect(
      service.ingest({ fileName: "a.pdf", mimeType: "application/pdf", fileSize: 1234, buffer: Buffer.from("x") }),
    ).rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "PDF_TEXT_NOT_EXTRACTABLE");

    expect(documents.insertOne).not.toHaveBeenCalled();
    expect(chunks.insertMany).not.toHaveBeenCalled();
  });
});
