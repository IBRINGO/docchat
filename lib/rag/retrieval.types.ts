import type { Nullable } from "@/types/common";

/** A chunk returned to the API client. Deliberately excludes the raw embedding vector and internal provider/model metadata. */
export interface RetrievedChunk {
  id: string;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  score: number;
}

export interface RetrievalResult {
  documentId: string;
  query: string;
  chunks: RetrievedChunk[];
}
