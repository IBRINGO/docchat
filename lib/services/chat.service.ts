import { ObjectId } from "mongodb";
import { RetrievalService, type RetrievalRequest } from "@/lib/services/retrieval.service";
import { AnswerGenerationService, getAnswerGenerationService } from "@/lib/services/answer.service";
import { ConversationService, getConversationService } from "@/lib/services/conversation.service";
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
  conversationId: string;
  documentIds: string[];
  query: string;
  sources: RetrievedChunk[];
  /** null means retrieval found no chunks — the LLM is never called in that case (see streamAnswer). */
  prompt: RagPrompt | null;
}

/** The slice of RetrievalService this orchestrator actually calls — small enough to fake directly in tests. */
export type RetrievalRunner = { retrieve(request: RetrievalRequest): ReturnType<RetrievalService["retrieve"]> };
/** The slice of AnswerGenerationService this orchestrator actually calls — small enough to fake directly in tests. */
export type AnswerGenerator = Pick<AnswerGenerationService, "streamAnswer" | "hasAnyProviderConfigured">;
/** The slice of ConversationService this orchestrator actually calls — small enough to fake directly in tests. */
export type ConversationRunner = Pick<
  ConversationService,
  "resolveDocumentContext" | "createConversation" | "persistUserMessage" | "persistAssistantMessage"
>;

/**
 * Orchestrates one chat turn: resolve/validate the conversation's document
 * context, run retrieval, persist the user message, then (if there's
 * context) grounded prompt construction and streamed generation — persisting
 * the complete assistant message only once generation has fully succeeded.
 * Deliberately split into two methods — see their individual doc comments —
 * so that failures which should produce an ordinary JSON error response
 * (bad request, document/conversation not found, document context mismatch,
 * no configured provider) are distinguishable from failures that can only be
 * reported as an in-stream SSE "error" event because the response has
 * already committed to streaming by that point.
 */
export class ChatService {
  constructor(
    private readonly retrievalService: RetrievalRunner = new RetrievalService(),
    private readonly answerService: AnswerGenerator = getAnswerGenerationService(),
    private readonly conversationService: ConversationRunner = getConversationService(),
  ) {}

  /**
   * Resolves the conversation, runs retrieval, and persists the user
   * message. Throws AppError on any failure. Callers MUST run this to
   * completion BEFORE starting the streaming HTTP response, so retrieval,
   * conversation, and configuration failures still surface as ordinary JSON
   * error responses with the correct status code — and so a failure here
   * never leaves an orphaned conversation or a persisted user message with
   * no chance of an answer.
   */
  async prepare(request: ChatRequest): Promise<PreparedChat> {
    const { conversation, documentIds } = await this.conversationService.resolveDocumentContext(request);

    const retrieval = await this.retrievalService.retrieve({ documentIds, message: request.message });
    const hasContext = retrieval.chunks.length > 0;

    // Checked here, not inside streamAnswer, so a missing LLM key is a clean
    // 503 JSON response rather than an SSE error event after the stream has
    // already started. Skipped when there's no context — the LLM is never
    // called in that case, so an unconfigured provider isn't actually fatal.
    if (hasContext && !this.answerService.hasAnyProviderConfigured()) {
      throw llmProviderNotConfiguredError("gemini/openai");
    }

    // Only create the conversation and persist the user message once retrieval has
    // already succeeded — a request that fails validation never leaves an orphaned
    // conversation or a user message with no possible answer behind it.
    const resolvedConversation = conversation ?? (await this.conversationService.createConversation(documentIds, request.message));
    await this.conversationService.persistUserMessage(resolvedConversation._id, request.message);

    return {
      conversationId: resolvedConversation._id.toString(),
      documentIds,
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
   * propagating and leaving the response in an inconsistent state. The
   * assistant's message is persisted only once its full text has been
   * generated successfully — a failed or partial stream is never saved as if
   * it were a complete answer.
   */
  async *streamAnswer(prepared: PreparedChat): AsyncGenerator<ChatStreamEvent> {
    yield {
      type: "metadata",
      data: { conversationId: prepared.conversationId, documentIds: prepared.documentIds, sources: prepared.sources },
    };

    const conversationId = new ObjectId(prepared.conversationId);

    if (!prepared.prompt) {
      const text = noContextAnswer(prepared.query);
      await this.persistAssistantMessageSafely(conversationId, text, prepared.sources);
      yield { type: "delta", data: { text } };
      yield { type: "done", data: {} };
      return;
    }

    try {
      const answer = await this.answerService.streamAnswer(prepared.prompt);
      let fullText = "";

      for await (const text of answer.chunks) {
        fullText += text;
        yield { type: "delta", data: { text } };
      }

      await this.persistAssistantMessageSafely(conversationId, fullText, prepared.sources);
      yield { type: "done", data: {} };
    } catch (error) {
      logger.error("chat_answer_generation_failed", { conversationId: prepared.conversationId, error });
      const appError = isAppError(error) ? error : llmGenerationFailedError("unknown", error);
      yield { type: "error", data: { code: appError.code, message: appError.message } };
    }
  }

  /** The user-visible stream has already fully succeeded by the time this is called — a persistence failure here is a backend consistency issue to log, not something that should retroactively turn a complete, already-delivered answer into an SSE error event. */
  private async persistAssistantMessageSafely(conversationId: ObjectId, content: string, sources: RetrievedChunk[]): Promise<void> {
    try {
      await this.conversationService.persistAssistantMessage(conversationId, content, sources);
    } catch (error) {
      logger.error("assistant_message_persistence_failed", { conversationId: conversationId.toString(), error });
    }
  }
}
