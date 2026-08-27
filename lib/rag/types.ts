/** A pipeline chunk, produced by `chunkDocument` and not yet persisted or embedded. */
export interface DocumentChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
}

export interface ChunkingOptions {
  /** Target maximum characters per chunk. Defaults to DEFAULT_CHUNK_SIZE. */
  chunkSize?: number;
  /** Characters of trailing context repeated at the start of the next chunk. Defaults to DEFAULT_CHUNK_OVERLAP. */
  overlap?: number;
}
