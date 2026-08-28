import type { Nullable } from "@/types/common";

/** A chunk returned to the API client. Deliberately excludes the raw embedding vector and internal provider/model metadata. Carries documentId/documentName so a multi-document answer's sources are attributable. */
export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  score: number;
}

export interface RetrievalResult {
  documentIds: string[];
  query: string;
  chunks: RetrievedChunk[];
}
