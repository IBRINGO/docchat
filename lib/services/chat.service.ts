import { RetrievalService } from "@/lib/services/retrieval.service";
import { AnswerGenerationService, getAnswerGenerationService } from "@/lib/services/answer.service";
import { buildRagPrompt, noContextAnswer, type RagPrompt } from "@/lib/rag/prompt";
import { logger } from "@/lib/utils/logger";
import { isAppError } from "@/lib/utils/errors";
import { llmGenerationFailedError, llmProviderNotConfiguredError } from "@/lib/providers/llm-errors";
import type { ChatRequest } from "@/lib/validation/chat.schema";
import type { RetrievedChunk } from "@/lib/rag/retrieval.types";

export type ChatStreamEventType = "metadata" | "delta" | "done" | "error";

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  data: Record<string, unknown>;
}

export interface PreparedChat {
  documentId: string;
  query: string;
  sources: RetrievedChunk[];
  /** null means retrieval found no chunks — the LLM is never called in that case (see streamAnswer). */
  prompt: RagPrompt | null;
}

/** The slice of RetrievalService this orchestrator actually calls — small enough to fake directly in tests. */
export type RetrievalRunner = Pick<RetrievalService, "retrieve">;
/** The slice of AnswerGenerationService this orchestrator actually calls — small enough to fake directly in tests. */
export type AnswerGenerator = Pick<AnswerGenerationService, "streamAnswer" | "hasAnyProviderConfigured">;

/**
 * Orchestrates one chat turn: retrieval, then (if there's context) grounded
 * prompt construction and streamed generation. Deliberately split into two
 * methods — see their individual doc comments — so that failures which
 * should produce an ordinary JSON error response (bad request, document not
 * found/not ready, no configured provider) are distinguishable from failures
 * that can only be reported as an in-stream SSE "error" event because the
 * response has already committed to streaming by that point.
 */
export class ChatService {
  constructor(
    private readonly retrievalService: RetrievalRunner = new RetrievalService(),
    private readonly answerService: AnswerGenerator = getAnswerGenerationService(),
  ) {}

  /**
   * Runs retrieval and decides whether there's enough context to call the
   * LLM at all. Throws AppError on any failure. Callers MUST run this to
   * completion BEFORE starting the streaming HTTP response, so retrieval and
   * configuration failures still surface as ordinary JSON error responses
   * with the correct status code.
   */
  async prepare(request: ChatRequest): Promise<PreparedChat> {
    const retrieval = await this.retrievalService.retrieve(request);
    const hasContext = retrieval.chunks.length > 0;

    // Checked here, not inside streamAnswer, so a missing LLM key is a clean
    // 503 JSON response rather than an SSE error event after the stream has
    // already started. Skipped when there's no context — the LLM is never
    // called in that case, so an unconfigured provider isn't actually fatal.
    if (hasContext && !this.answerService.hasAnyProviderConfigured()) {
      throw llmProviderNotConfiguredError("gemini/openai");
    }

    return {
      documentId: retrieval.documentId,
      query: retrieval.query,
      sources: retrieval.chunks,
      prompt: hasContext ? buildRagPrompt(retrieval.query, retrieval.chunks) : null,
    };
  }

  /**
   * Turns a PreparedChat into the SSE event sequence. Never throws — by the
   * time this runs, the HTTP response has already committed to a streaming
   * body, so any failure (including a mid-stream provider failure) is
   * surfaced as an "error" event and the generator ends cleanly, rather than
   * propagating and leaving the response in an inconsistent state.
   */
  async *streamAnswer(prepared: PreparedChat): AsyncGenerator<ChatStreamEvent> {
    yield { type: "metadata", data: { documentId: prepared.documentId, sources: prepared.sources } };

    if (!prepared.prompt) {
      yield { type: "delta", data: { text: noContextAnswer(prepared.query) } };
      yield { type: "done", data: {} };
      return;
    }

    try {
      const answer = await this.answerService.streamAnswer(prepared.prompt);

      for await (const text of answer.chunks) {
        yield { type: "delta", data: { text } };
      }

      yield { type: "done", data: {} };
    } catch (error) {
      logger.error("chat_answer_generation_failed", { documentId: prepared.documentId, error });
      const appError = isAppError(error) ? error : llmGenerationFailedError("unknown", error);
      yield { type: "error", data: { code: appError.code, message: appError.message } };
    }
  }
}
