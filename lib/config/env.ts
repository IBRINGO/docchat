import { z } from "zod";

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/config/env.ts must only be imported in server-side code");
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

const dbEnvSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1, "MONGODB_DB_NAME is required"),
});

export type DbEnv = z.infer<typeof dbEnvSchema>;

let cachedDbEnv: DbEnv | undefined;

/**
 * Validates and returns only the environment variables required for database
 * operations. Throws a clear, developer-facing error if they are missing or
 * invalid — unrelated code (e.g. frontend rendering) is unaffected since AI
 * provider keys are not validated here.
 */
export function getDbEnv(): DbEnv {
  assertServer();
  if (cachedDbEnv) return cachedDbEnv;

  const parsed = dbEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid database environment configuration: ${formatIssues(parsed.error)}`);
  }

  cachedDbEnv = parsed.data;
  return cachedDbEnv;
}

const providerEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
});

export type ProviderEnv = z.infer<typeof providerEnvSchema>;

/**
 * Validates the optional AI provider keys. Neither key is required at this
 * stage — embeddings/LLM calls are implemented in a later sub-task — but any
 * value that is present must be non-empty.
 */
export function getProviderEnv(): ProviderEnv {
  assertServer();

  const parsed = providerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid AI provider environment configuration: ${formatIssues(parsed.error)}`);
  }

  return parsed.data;
}
