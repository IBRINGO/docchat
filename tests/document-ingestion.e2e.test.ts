import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  DocumentIngestionService,
  type ChunksCollectionLike,
  type DocumentsCollectionLike,
} from "@/lib/services/document-ingestion.service";
import { buildTestPdf } from "@/tests/helpers/buildTestPdf";
import type { EmbeddingResult } from "@/lib/providers/embedding.provider";
import type { Chunk } from "@/types/chunk";
import type { Document as DocumentEntity } from "@/types/document";

/**
 * Exercises the real pipeline end to end — real extractPdf (pdfjs-dist)
 * against an in-memory synthetic PDF, real normalizeExtractedText, real
 * chunkDocument — with only the embedding provider and MongoDB collections
 * faked. No network, no API key, no database required.
 */
describe("DocumentIngestionService (real PDF -> extract -> normalize -> chunk -> fake embed/persist)", () => {
  it("ingests a real synthetic multi-page PDF end to end", async () => {
    const pdf = buildTestPdf(["Hello World Page One", "Second Page Content Here"]);

    const embeddingCalls: string[][] = [];
    const embeddingService = {
      generateEmbeddings: vi.fn(async (inputs: string[]): Promise<EmbeddingResult[]> => {
        embeddingCalls.push(inputs);
        return inputs.map((_, i) => ({
          vector: [i * 0.1, i * 0.2],
          provider: "openai" as const,
          model: "text-embedding-3-small",
          dimensions: 2,
        }));
      }),
    };

    let insertedDocument: DocumentEntity | undefined;
    let insertedChunks: Chunk[] = [];

    // Cast at this one boundary: Collection's real methods are heavily overloaded
    // (e.g. findOneAndUpdate's `includeResultMetadata` variants), which a plain
    // fake can't satisfy for every overload simultaneously — the same pattern
    // used for the OpenAI/Gemini SDK-client fakes elsewhere in this test suite.
    const documents = {
      insertOne: vi.fn(async (doc: DocumentEntity) => {
        insertedDocument = doc;
        return { acknowledged: true, insertedId: doc._id };
      }),
      findOneAndUpdate: vi.fn(async () => {
        if (insertedDocument) insertedDocument.status = "ready";
        return insertedDocument ?? null;
      }),
      updateOne: vi.fn(async () => ({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null })),
    } as unknown as DocumentsCollectionLike;

    const chunks = {
      insertMany: vi.fn(async (docs: Chunk[]) => {
        insertedChunks = docs;
        return { acknowledged: true, insertedCount: docs.length, insertedIds: {} };
      }),
      deleteMany: vi.fn(async () => ({ acknowledged: true, deletedCount: 0 })),
    } as unknown as ChunksCollectionLike;

    const service = new DocumentIngestionService(embeddingService, async () => documents, async () => chunks);

    const { document } = await service.ingest({
      fileName: "sample.pdf",
      mimeType: "application/pdf",
      fileSize: pdf.length,
      buffer: pdf,
    });

    expect(document.status).toBe("ready");
    expect(document.pageCount).toBe(2);
    expect(document.chunkCount).toBe(2);
    expect(document.embeddingProvider).toBe("openai");

    // Real extraction really ran: the embedding service received real extracted+normalized text.
    expect(embeddingCalls[0].some((text) => text.includes("Hello World Page One"))).toBe(true);
    expect(embeddingCalls[0].some((text) => text.includes("Second Page Content Here"))).toBe(true);

    expect(insertedChunks).toHaveLength(2);
    expect(insertedChunks[0].pageNumber).toBe(1);
    expect(insertedChunks[1].pageNumber).toBe(2);
    expect(insertedChunks.every((c) => c.documentId instanceof ObjectId)).toBe(true);
  });
});
