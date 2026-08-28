import { GoogleGenAI } from "@google/genai";
import { requireGeminiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { llmGenerationFailedError } from "@/lib/providers/llm-errors";
import type { AnswerPromptInput, LLMProvider } from "@/lib/providers/llm.provider";

/**
 * `gemini-3.6-flash`: fast, supports streaming and a `systemInstruction`
 * config field under the installed SDK version (@google/genai@^2.19.0).
 * `gemini-2.5-flash` was the natural choice from documentation alone, but a
 * live API call against it returned a 404 telling new API keys to use
 * `gemini-3.6-flash` instead — confirmed against the real Gemini API, not
 * just docs, since model availability shifts over time in ways static
 * knowledge can't track.
 */
export const GEMINI_DEFAULT_CHAT_MODEL = "gemini-3.6-flash";

/** The slice of the Gemini SDK this provider actually uses — small enough to fake directly in tests. */
export interface GeminiChatClient {
  models: {
    generateContentStream: GoogleGenAI["models"]["generateContentStream"];
  };
}

export class GeminiLlmProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private client: GeminiChatClient | undefined;

  constructor(
    readonly model: string = GEMINI_DEFAULT_CHAT_MODEL,
    client?: GeminiChatClient,
  ) {
    this.client = client;
  }

  private getClient(): GeminiChatClient {
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
    }
    return this.client;
  }

  async *streamAnswer(input: AnswerPromptInput): AsyncGenerator<string> {
    const startedAt = Date.now();
    logger.info("llm_generation_started", { provider: this.name, model: this.model });

    try {
      const client = this.getClient();
      const stream = await client.models.generateContentStream({
        model: this.model,
        contents: input.userPrompt,
        config: {
          systemInstruction: input.systemPrompt,
          temperature: 0.1,
        },
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield text;
      }

      logger.info("llm_generation_completed", {
        provider: this.name,
        model: this.model,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error("llm_generation_failed", { provider: this.name, model: this.model, error });
      if (isAppError(error)) throw error;
      throw llmGenerationFailedError(this.name, error);
    }
  }
}
