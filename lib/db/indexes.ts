import { getChunksCollection, getDocumentsCollection } from "@/lib/db/collections";
import { logger } from "@/lib/utils/logger";

/**
 * Creates the normal (non-vector-search) indexes required by the ingestion
 * pipeline. `createIndex` is idempotent — MongoDB no-ops when an equivalent
 * index already exists — so this is safe to call on every deploy. It is not
 * invoked automatically by any query path; callers must run it explicitly
 * (e.g. from a setup script). Atlas Vector Search indexes are configured
 * separately in Atlas, not here.
 */
export async function initializeDatabaseIndexes(): Promise<void> {
  const documents = await getDocumentsCollection();
  const chunks = await getChunksCollection();

  await Promise.all([
    documents.createIndex({ createdAt: -1 }, { name: "documents_createdAt" }),
    chunks.createIndex({ documentId: 1 }, { name: "chunks_documentId" }),
    chunks.createIndex(
      { documentId: 1, chunkIndex: 1 },
      { name: "chunks_documentId_chunkIndex", unique: true },
    ),
  ]);

  logger.info("database_indexes_initialized");
}
