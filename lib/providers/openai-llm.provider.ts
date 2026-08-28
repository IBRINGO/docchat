import OpenAI from "openai";
import { requireOpenAiApiKey } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { llmGenerationFailedError } from "@/lib/providers/llm-errors";
import type { AnswerPromptInput, LLMProvider } from "@/lib/providers/llm.provider";

/**
 * A current, low-cost, widely available chat-completions model that supports
 * streaming under the installed SDK version (openai@^6.49.0). No preview/
 * experimental model is used, so behavior stays stable across runs.
 */
export const OPENAI_DEFAULT_CHAT_MODEL = "gpt-4o-mini";

/** The slice of the OpenAI SDK this provider actually uses — small enough to fake directly in tests. */
export interface OpenAiChatClient {
  chat: {
    completions: {
      create: OpenAI["chat"]["completions"]["create"];
    };
  };
}

export class OpenAiLlmProvider implements LLMProvider {
  readonly name = "openai" as const;
  private client: OpenAiChatClient | undefined;

  constructor(
    readonly model: string = OPENAI_DEFAULT_CHAT_MODEL,
    client?: OpenAiChatClient,
  ) {
    this.client = client;
  }

  private getClient(): OpenAiChatClient {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: requireOpenAiApiKey() });
    }
    return this.client;
  }

  async *streamAnswer(input: AnswerPromptInput): AsyncGenerator<string> {
    const startedAt = Date.now();
    logger.info("llm_generation_started", { provider: this.name, model: this.model });

    try {
      const client = this.getClient();
      const stream = await client.chat.completions.create({
        model: this.model,
        stream: true,
        temperature: 0.1,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
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
