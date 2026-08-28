import { ObjectId, type Collection } from "mongodb";
import { getChunksCollection, getDocumentsCollection } from "@/lib/db/collections";
import { extractPdf } from "@/lib/pdf/extract";
import { normalizeExtractedText } from "@/lib/pdf/normalize";
import { pdfTextNotExtractableError, pdfTooManyPagesError } from "@/lib/pdf/errors";
import { MAX_DOCUMENT_PAGE_COUNT } from "@/lib/config/document-limits";
import { chunkDocument } from "@/lib/rag/chunker";
import { getEmbeddingService, type EmbeddingService } from "@/lib/services/embedding.service";
import { toEmbeddingConfiguration, validateEmbeddingBatchConsistency } from "@/lib/providers/embedding.provider";
import { logger } from "@/lib/utils/logger";
import { AppError } from "@/lib/utils/errors";
import type { Document as DocumentEntity } from "@/types/document";
import type { Chunk } from "@/types/chunk";

export interface IngestDocumentInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  buffer: Buffer;
}

export interface IngestDocumentResult {
  document: DocumentEntity;
}

/** The slice of EmbeddingService this orchestrator actually calls — small enough to fake directly in tests. */
export type EmbeddingGenerator = Pick<EmbeddingService, "generateEmbeddings">;

/** The slice of each Collection this orchestrator actually calls — small enough to fake directly in tests. */
export type DocumentsCollectionLike = Pick<Collection<DocumentEntity>, "insertOne" | "findOneAndUpdate" | "updateOne">;
export type ChunksCollectionLike = Pick<Collection<Chunk>, "insertMany" | "deleteMany">;

function documentIngestionFailedError(cause?: unknown): AppError {
  return new AppError({
    code: "DOCUMENT_INGESTION_FAILED",
    message: "The document could not be ingested.",
    status: 500,
    cause,
  });
}

/**
 * Owns the full PDF -> extract -> normalize -> chunk -> embed -> persist
 * pipeline. Every fallible, in-memory step (extraction, chunking, embedding,
 * consistency checks) runs to completion BEFORE anything is written to
 * MongoDB, so a bad PDF or a provider outage never leaves an orphaned
 * "processing" document behind. Only once a complete, self-consistent result
 * exists in memory does the persistence phase begin — which still uses a
 * brief "processing" status so a failure during that phase (e.g. a dropped
 * connection between the document insert and the chunk insert) can be
 * detected and cleaned up deterministically.
 */
export class DocumentIngestionService {
  constructor(
    private readonly embeddingService: EmbeddingGenerator = getEmbeddingService(),
    private readonly getDocuments: () => Promise<DocumentsCollectionLike> = getDocumentsCollection,
    private readonly getChunks: () => Promise<ChunksCollectionLike> = getChunksCollection,
  ) {}

  async ingest(input: IngestDocumentInput): Promise<IngestDocumentResult> {
    const startedAt = Date.now();
    logger.info("document_ingestion_started", {
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    });

    const extracted = await extractPdf(input.buffer);
    logger.info("document_text_extracted", {
      pageCount: extracted.pageCount,
      extractedPageCount: extracted.pages.length,
    });

    if (extracted.pageCount > MAX_DOCUMENT_PAGE_COUNT) {
      logger.warn("document_ingestion_rejected", {
        reason: "too_many_pages",
        pageCount: extracted.pageCount,
        maxPages: MAX_DOCUMENT_PAGE_COUNT,
      });
      throw pdfTooManyPagesError(extracted.pageCount, MAX_DOCUMENT_PAGE_COUNT);
    }

    const normalizedPages = extracted.pages.map((page) => ({
      ...page,
      text: normalizeExtractedText(page.text),
    }));

    const chunks = chunkDocument(normalizedPages);
    if (chunks.length === 0) {
      // Every page came back empty after normalization/chunking — functionally
      // the same outcome as a PDF with no extractable text, so reuse that error.
      throw pdfTextNotExtractableError();
    }
    logger.info("document_chunking_completed", { chunkCount: chunks.length });

    const embeddingResults = await this.embeddingService.generateEmbeddings(chunks.map((chunk) => chunk.content));

    if (embeddingResults.length !== chunks.length) {
      throw documentIngestionFailedError(
        new Error(`embedding count (${embeddingResults.length}) does not match chunk count (${chunks.length})`),
      );
    }

    // Defense-in-depth: EmbeddingService already validates this internally, but this
    // service accepts an injected EmbeddingGenerator, so it can't assume that guarantee
    // holds for an arbitrary implementation — inconsistent embeddings must never reach persistence.
    validateEmbeddingBatchConsistency(embeddingResults);

    const embeddingConfiguration = toEmbeddingConfiguration(embeddingResults[0]);
    logger.info("document_embedding_completed", {
      provider: embeddingConfiguration.provider,
      model: embeddingConfiguration.model,
      dimensions: embeddingConfiguration.dimensions,
      chunkCount: chunks.length,
    });

    const documentId = new ObjectId();
    const now = new Date();

    const documentRecord: DocumentEntity = {
      _id: documentId,
      name: input.fileName,
      size: input.fileSize,
      mimeType: input.mimeType,
      pageCount: extracted.pageCount,
      chunkCount: chunks.length,
      status: "processing",
      embeddingProvider: embeddingConfiguration.provider,
      embeddingModel: embeddingConfiguration.model,
      embeddingDimensions: embeddingConfiguration.dimensions,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    const chunkRecords: Chunk[] = chunks.map((chunk, index) => ({
      _id: new ObjectId(),
      documentId,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      embedding: embeddingResults[index].vector,
      embeddingProvider: embeddingResults[index].provider,
      embeddingModel: embeddingResults[index].model,
      embeddingDimensions: embeddingResults[index].dimensions,
      createdAt: now,
    }));

    const documentsCollection = await this.getDocuments();
    const chunksCollection = await this.getChunks();

    try {
      await documentsCollection.insertOne(documentRecord);
      await chunksCollection.insertMany(chunkRecords);

      const readyDocument = await documentsCollection.findOneAndUpdate(
        { _id: documentId },
        { $set: { status: "ready", updatedAt: new Date() } },
        { returnDocument: "after" },
      );

      logger.info("document_persistence_completed", {
        documentId: documentId.toString(),
        chunkCount: chunkRecords.length,
        durationMs: Date.now() - startedAt,
      });

      return { document: readyDocument ?? { ...documentRecord, status: "ready" } };
    } catch (error) {
      logger.error("document_ingestion_failed", { documentId: documentId.toString(), error });

      await chunksCollection.deleteMany({ documentId }).catch(() => undefined);
      await documentsCollection
        .updateOne(
          { _id: documentId },
          {
            $set: {
              status: "failed",
              errorCode: "DOCUMENT_INGESTION_FAILED",
              errorMessage: "The document could not be persisted.",
              updatedAt: new Date(),
            },
          },
        )
        .catch(() => undefined);

      throw documentIngestionFailedError(error);
    }
  }
}
