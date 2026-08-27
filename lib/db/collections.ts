import type { Collection } from "mongodb";
import { getDatabase } from "@/lib/db/mongodb";
import type { Document } from "@/types/document";
import type { Chunk } from "@/types/chunk";

export const COLLECTIONS = {
  documents: "documents",
  chunks: "chunks",
} as const;

export async function getDocumentsCollection(): Promise<Collection<Document>> {
  const db = await getDatabase();
  return db.collection<Document>(COLLECTIONS.documents);
}

export async function getChunksCollection(): Promise<Collection<Chunk>> {
  const db = await getDatabase();
  return db.collection<Chunk>(COLLECTIONS.chunks);
}
