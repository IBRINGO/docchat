import type { ObjectId } from "mongodb";
import type { EmbeddingProvider, Nullable } from "@/types/common";

export type DocumentStatus = "processing" | "ready" | "failed";

export interface Document {
  _id: ObjectId;
  name: string;
  size: number;
  pageCount: Nullable<number>;
  chunkCount: number;
  status: DocumentStatus;
  embeddingProvider: Nullable<EmbeddingProvider>;
  embeddingModel: Nullable<string>;
  createdAt: Date;
  updatedAt: Date;
}
