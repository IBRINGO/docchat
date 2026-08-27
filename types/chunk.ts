import type { ObjectId } from "mongodb";
import type { EmbeddingProvider, Nullable } from "@/types/common";

export interface Chunk {
  _id: ObjectId;
  documentId: ObjectId;
  content: string;
  pageNumber: Nullable<number>;
  chunkIndex: number;
  embedding: Nullable<number[]>;
  embeddingProvider: Nullable<EmbeddingProvider>;
  embeddingModel: Nullable<string>;
  embeddingDimensions: Nullable<number>;
  createdAt: Date;
}
