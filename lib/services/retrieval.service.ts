import { ObjectId, type Collection } from "mongodb";
import { getChunksCollection, getDocumentsCollection } from "@/lib/db/collections";
import { vectorSearchChunks, type ChunksAggregateCollection } from "@/lib/db/vector-search";
import { getEmbeddingService, type EmbeddingService } from "@/lib/services/embedding.service";
import type { EmbeddingConfiguration } from "@/lib/providers/embedding.provider";
import { logger } from "@/lib/utils/logger";
import { AppError } from "@/lib/utils/errors";
import type { ChatRequest } from "@/lib/validation/chat.schema";
import type { RetrievalResult } from "@/lib/rag/retrieval.types";
import type { Document as DocumentEntity, DocumentStatus } from "@/types/document";

/** How many chunks are returned per retrieval request. Fixed by design for this sub-deliverable, not client-configurable. */
const TOP_K = 5;

/** The slice of EmbeddingService this orchestrator actually calls — small enough to fake directly in tests. */
export type QueryEmbeddingGenerator = Pick<EmbeddingService, "generateEmbeddingForConfiguration">;

/** The slice of Collection<Document> this orchestrator actually calls — small enough to fake directly in tests. */
export type DocumentLookupCollection = Pick<Collection<DocumentEntity>, "findOne">;

export function invalidDocumentIdError(): AppError {
  return new AppError({
    code: "INVALID_DOCUMENT_ID",
    message: "documentId is not a valid identifier.",
    status: 400,
  });
}

export function documentNotFoundError(): AppError {
  return new AppError({
    code: "DOCUMENT_NOT_FOUND",
    message: "No document was found for the given documentId.",
    status: 404,
  });
}

export function documentNotReadyError(status: DocumentStatus): AppError {
  return new AppError({
    code: "DOCUMENT_NOT_READY",
    message: `The document is not ready for retrieval (status: ${status}).`,
    status: 409,
  });
}

export function embeddingConfigurationMissingError(): AppError {
  return new AppError({
    code: "EMBEDDING_CONFIGURATION_MISSING",
    message: "The document has no embedding configuration recorded.",
    status: 500,
  });
}

/**
 * Orchestrates retrieval for one question against one document: loads the
 * document, reads back the exact embedding configuration it was ingested
 * with, embeds the question in that SAME configuration (never a different
 * provider/model — see EmbeddingService.generateEmbeddingForConfiguration),
 * then runs a scoped Atlas Vector Search. Does not call an LLM; this is the
 * retrieval step only.
 */
export class RetrievalService {
  constructor(
    private readonly embeddingService: QueryEmbeddingGenerator = getEmbeddingService(),
    private readonly getDocuments: () => Promise<DocumentLookupCollection> = getDocumentsCollection,
    private readonly getChunks: () => Promise<ChunksAggregateCollection> = getChunksCollection,
  ) {}

  async retrieve(request: ChatRequest): Promise<RetrievalResult> {
    let documentId: ObjectId;
    try {
      documentId = new ObjectId(request.documentId);
    } catch {
      throw invalidDocumentIdError();
    }

    const documentsCollection = await this.getDocuments();
    const document = await documentsCollection.findOne({ _id: documentId });
    if (!document) {
      throw documentNotFoundError();
    }
    if (document.status !== "ready") {
      throw documentNotReadyError(document.status);
    }
    if (!document.embeddingProvider || !document.embeddingModel || !document.embeddingDimensions) {
      throw embeddingConfigurationMissingError();
    }

    const configuration: EmbeddingConfiguration = {
      provider: document.embeddingProvider,
      model: document.embeddingModel,
      dimensions: document.embeddingDimensions,
    };

    logger.info("retrieval_started", {
      documentId: request.documentId,
      provider: configuration.provider,
      model: configuration.model,
    });

    const queryEmbedding = await this.embeddingService.generateEmbeddingForConfiguration(request.message, configuration);

    const chunksCollection = await this.getChunks();
    const hits = await vectorSearchChunks(chunksCollection, {
      documentId,
      embeddingProvider: configuration.provider,
      embeddingModel: configuration.model,
      queryVector: queryEmbedding.vector,
      limit: TOP_K,
    });

    logger.info("retrieval_completed", {
      documentId: request.documentId,
      resultCount: hits.length,
    });

    return {
      documentId: request.documentId,
      query: request.message,
      chunks: hits.map((hit) => ({
        id: hit.id.toString(),
        content: hit.content,
        pageNumber: hit.pageNumber,
        chunkIndex: hit.chunkIndex,
        score: hit.score,
      })),
    };
  }
}
