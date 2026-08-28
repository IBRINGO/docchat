import type { Collection, ObjectId } from "mongodb";
import { getVectorSearchEnv } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { AppError } from "@/lib/utils/errors";
import type { Chunk } from "@/types/chunk";
import type { EmbeddingProvider, Nullable } from "@/types/common";

/** Used when a search doesn't specify its own candidate pool size and MONGODB_VECTOR_NUM_CANDIDATES is unset. Comfortably above the topK=5 the app requests, without over-fetching. */
export const DEFAULT_VECTOR_SEARCH_NUM_CANDIDATES = 50;

/** The slice of Collection<Chunk> this module actually calls — small enough to fake directly in tests. */
export type ChunksAggregateCollection = Pick<Collection<Chunk>, "aggregate">;

export interface VectorSearchParams {
  documentId: ObjectId;
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  queryVector: number[];
  limit: number;
  /** Defaults to MONGODB_VECTOR_NUM_CANDIDATES, then DEFAULT_VECTOR_SEARCH_NUM_CANDIDATES. */
  numCandidates?: number;
}

/** A retrieved chunk plus its similarity score. Never carries the raw embedding vector. */
export interface VectorSearchHit {
  id: ObjectId;
  documentId: ObjectId;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  score: number;
}

interface VectorSearchAggregationResult {
  _id: ObjectId;
  documentId: ObjectId;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  score: number;
}

function vectorSearchFailedError(cause: unknown): AppError {
  return new AppError({
    code: "VECTOR_SEARCH_FAILED",
    message: "The vector search request could not be completed.",
    status: 502,
    cause,
  });
}

/**
 * Runs an Atlas `$vectorSearch` query against the chunks collection, scoped
 * to one document and one exact embedding configuration. The `filter` clause
 * is what prevents cross-document and cross-embedding-space contamination —
 * without it, a query vector could match chunks from an unrelated document,
 * or (worse) chunks embedded by a different provider/model, where the vector
 * space itself isn't comparable. Requires the Atlas index to define
 * `documentId`, `embeddingProvider`, and `embeddingModel` as filter fields
 * (see README).
 */
export async function vectorSearchChunks(
  collection: ChunksAggregateCollection,
  params: VectorSearchParams,
): Promise<VectorSearchHit[]> {
  const { MONGODB_VECTOR_INDEX, MONGODB_VECTOR_NUM_CANDIDATES } = getVectorSearchEnv();
  const numCandidates = params.numCandidates ?? MONGODB_VECTOR_NUM_CANDIDATES ?? DEFAULT_VECTOR_SEARCH_NUM_CANDIDATES;

  logger.info("vector_search_started", {
    documentId: params.documentId.toString(),
    embeddingProvider: params.embeddingProvider,
    embeddingModel: params.embeddingModel,
    limit: params.limit,
    numCandidates,
  });

  try {
    const results = await collection
      .aggregate<VectorSearchAggregationResult>([
        {
          $vectorSearch: {
            index: MONGODB_VECTOR_INDEX,
            path: "embedding",
            queryVector: params.queryVector,
            numCandidates,
            limit: params.limit,
            filter: {
              $and: [
                { documentId: params.documentId },
                { embeddingProvider: params.embeddingProvider },
                { embeddingModel: params.embeddingModel },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            documentId: 1,
            content: 1,
            pageNumber: 1,
            chunkIndex: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();

    logger.info("vector_search_completed", {
      documentId: params.documentId.toString(),
      resultCount: results.length,
    });

    return results.map((result) => ({
      id: result._id,
      documentId: result.documentId,
      content: result.content,
      pageNumber: result.pageNumber,
      chunkIndex: result.chunkIndex,
      score: result.score,
    }));
  } catch (error) {
    logger.error("vector_search_failed", { documentId: params.documentId.toString(), error });
    throw vectorSearchFailedError(error);
  }
}
