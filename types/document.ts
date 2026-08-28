import type { ObjectId } from "mongodb";
import type { EmbeddingProvider, Nullable } from "@/types/common";

export type DocumentStatus = "processing" | "ready" | "failed";

export interface Document {
  _id: ObjectId;
  name: string;
  size: number;
  mimeType: string;
  pageCount: Nullable<number>;
  chunkCount: number;
  status: DocumentStatus;
  embeddingProvider: Nullable<EmbeddingProvider>;
  embeddingModel: Nullable<string>;
  embeddingDimensions: Nullable<number>;
  errorCode: Nullable<string>;
  errorMessage: Nullable<string>;
  createdAt: Date;
  updatedAt: Date;
}
