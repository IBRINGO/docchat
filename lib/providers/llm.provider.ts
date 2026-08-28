export type LLMProviderName = "openai" | "gemini";

export interface AnswerPromptInput {
  systemPrompt: string;
  userPrompt: string;
}

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string;
  /** Yields answer text deltas as they arrive. Every implementation wraps SDK-level failures in an AppError before they reach the caller. */
  streamAnswer(input: AnswerPromptInput): AsyncGenerator<string>;
}
