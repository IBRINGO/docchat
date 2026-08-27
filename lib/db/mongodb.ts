import { MongoClient, type Db } from "mongodb";
import { getDbEnv } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function connect(): Promise<MongoClient> {
  const { MONGODB_URI } = getDbEnv();
  const client = new MongoClient(MONGODB_URI);

  return client
    .connect()
    .then((connectedClient) => {
      logger.info("database_connected");
      return connectedClient;
    })
    .catch((error: unknown) => {
      global._mongoClientPromise = undefined;
      logger.error("database_connection_failed", { error });
      throw error;
    });
}

/**
 * Returns a cached, connected MongoClient. The promise is cached on `global`
 * so hot-reload in development and repeated invocations on a warm serverless
 * instance in production reuse the same connection instead of opening a new
 * one per request.
 */
export function getMongoClient(): Promise<MongoClient> {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = connect();
  }
  return global._mongoClientPromise;
}

export async function getDatabase(): Promise<Db> {
  const { MONGODB_DB_NAME } = getDbEnv();
  const client = await getMongoClient();
  return client.db(MONGODB_DB_NAME);
}
