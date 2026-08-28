import { getChunksCollection, getDocumentsCollection } from "@/lib/db/collections";
import { vectorSearchChunks, type ChunksAggregateCollection } from "@/lib/db/vector-search";
import { getEmbeddingService, type EmbeddingService } from "@/lib/services/embedding.service";
import type { EmbeddingConfiguration } from "@/lib/providers/embedding.provider";
import { resolveAndValidateDocuments, type DocumentLookupCollection } from "@/lib/services/document-selection.service";
import { logger } from "@/lib/utils/logger";
import { AppError } from "@/lib/utils/errors";
import type { RetrievalResult } from "@/lib/rag/retrieval.types";
import type { Document as DocumentEntity } from "@/types/document";

// Re-exported for callers/tests that reason about retrieval failures — the actual definitions
// live in document-selection.service.ts, shared with POST /api/conversations' explicit
// conversation-creation path (see that module's doc comment for why).
export {
  invalidDocumentIdError,
  documentNotFoundError,
  documentNotReadyError,
  documentSelectionLimitExceededError,
  type DocumentLookupCollection,
} from "@/lib/services/document-selection.service";

/** Chunks returned per embedding-configuration group, and the bound on the final merged/globally-ranked result. Fixed by design, not client-configurable — keeps the prompt bounded regardless of how many documents are selected (see README, "Result merging"). */
const TOP_K_PER_GROUP = 5;
const GLOBAL_TOP_K = 5;

export interface RetrievalRequest {
  documentIds: string[];
  message: string;
}

/** The slice of EmbeddingService this orchestrator actually calls — small enough to fake directly in tests. */
export type QueryEmbeddingGenerator = Pick<EmbeddingService, "generateEmbeddingForConfiguration">;

export function embeddingConfigurationMissingError(): AppError {
  return new AppError({
    code: "EMBEDDING_CONFIGURATION_MISSING",
    message: "A selected document has no embedding configuration recorded.",
    status: 500,
  });
}

interface EmbeddingConfigurationGroup {
  configuration: EmbeddingConfiguration;
  documents: DocumentEntity[];
}

/** Groups documents by embeddingProvider+embeddingModel+embeddingDimensions — vectors from different providers/models are never comparable, even at equal dimensions, so each group must be queried and embedded independently (see README, "Embedding configuration grouping"). */
function groupByEmbeddingConfiguration(documents: readonly DocumentEntity[]): EmbeddingConfigurationGroup[] {
  const groups = new Map<string, EmbeddingConfigurationGroup>();

  for (const document of documents) {
    if (!document.embeddingProvider || !document.embeddingModel || !document.embeddingDimensions) {
      throw embeddingConfigurationMissingError();
    }

    const key = `${document.embeddingProvider}:${document.embeddingModel}:${document.embeddingDimensions}`;
    const existing = groups.get(key);
    if (existing) {
      existing.documents.push(document);
    } else {
      groups.set(key, {
        configuration: {
          provider: document.embeddingProvider,
          model: document.embeddingModel,
          dimensions: document.embeddingDimensions,
        },
        documents: [document],
      });
    }
  }

  return Array.from(groups.values());
}

/**
 * Orchestrates retrieval for one question against one or more documents.
 * Documents may have been embedded under different provider/model
 * configurations (e.g. one via Gemini, another via the OpenAI fallback) — so
 * retrieval groups the selected documents by their exact embedding
 * configuration, generates ONE query embedding per group (never a single
 * embedding blindly reused across incompatible vector spaces), runs a
 * separately-scoped Atlas Vector Search per group, and merges the results
 * into one bounded, globally-ranked list. Does not call an LLM; this is the
 * retrieval step only.
 */
export class RetrievalService {
  constructor(
    private readonly embeddingService: QueryEmbeddingGenerator = getEmbeddingService(),
    private readonly getDocuments: () => Promise<DocumentLookupCollection> = getDocumentsCollection,
    private readonly getChunks: () => Promise<ChunksAggregateCollection> = getChunksCollection,
  ) {}

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const uniqueIds = Array.from(new Set(request.documentIds));
    const documents = await resolveAndValidateDocuments(request.documentIds, this.getDocuments);

    const groups = groupByEmbeddingConfiguration(documents);
    const documentNameById = new Map(documents.map((document) => [document._id.toString(), document.name]));

    logger.info("retrieval_started", {
      documentIds: uniqueIds,
      groupCount: groups.length,
      groups: groups.map((group) => ({ provider: group.configuration.provider, model: group.configuration.model, documentCount: group.documents.length })),
    });

    const chunksCollection = await this.getChunks();

    const groupHits = await Promise.all(
      groups.map(async (group) => {
        const queryEmbedding = await this.embeddingService.generateEmbeddingForConfiguration(request.message, group.configuration);
        return vectorSearchChunks(chunksCollection, {
          documentIds: group.documents.map((document) => document._id),
          embeddingProvider: group.configuration.provider,
          embeddingModel: group.configuration.model,
          queryVector: queryEmbedding.vector,
          limit: TOP_K_PER_GROUP,
        });
      }),
    );

    // Merge strategy: each group already returns its own top-K sorted by Atlas's
    // vectorSearchScore, which (for the cosine similarity metric this app's index
    // uses) is normalized to a fixed 0-1 scale by Atlas itself, independent of the
    // underlying embedding model — see README "Result merging and ranking" for why
    // this makes a global sort-by-score-then-slice a reasonable, simple, and
    // deterministic merge without needing an extra per-group rescaling step.
    const merged = groupHits
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, GLOBAL_TOP_K);

    logger.info("retrieval_completed", {
      documentIds: uniqueIds,
      groupCount: groups.length,
      candidateCount: groupHits.flat().length,
      mergedResultCount: merged.length,
    });

    return {
      documentIds: uniqueIds,
      query: request.message,
      chunks: merged.map((hit) => ({
        id: hit.id.toString(),
        documentId: hit.documentId.toString(),
        documentName: documentNameById.get(hit.documentId.toString()) ?? "Unknown document",
        content: hit.content,
        pageNumber: hit.pageNumber,
        chunkIndex: hit.chunkIndex,
        score: hit.score,
      })),
    };
  }
}
