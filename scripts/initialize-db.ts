import { initializeDatabaseIndexes } from "@/lib/db/indexes";
import { getMongoClient } from "@/lib/db/mongodb";

async function main(): Promise<void> {
  try {
    await initializeDatabaseIndexes();
    console.log("Database indexes successfully initialized.");
  } finally {
    // Swallow cleanup failures here — if `initializeDatabaseIndexes` never
    // connected in the first place, retrying the connection just to close it
    // would otherwise throw and replace (mask) the real error above.
    await getMongoClient()
      .then((client) => client.close())
      .catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Failed to initialize database indexes:", error);
    process.exit(1);
  });
