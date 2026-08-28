"use client";

import { useCallback, useRef, useState } from "react";
import { streamChatResponse, ApiError, type ChatMetadata } from "@/lib/client/api";
import type { ChatMessage } from "@/types/chat";

export interface UseChatResult {
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (documentIds: string[], text: string) => Promise<void>;
  /** Restores an existing conversation's messages and document context — see app/page.tsx, "load conversation". */
  loadConversation: (conversationId: string, documentIds: string[], messages: ChatMessage[]) => void;
  /** Clears the active conversation. Document selection is left untouched — the next message starts a new conversation with whatever is currently selected. */
  startNewChat: () => void;
  /** True if there's an active conversation whose document context differs from `documentIds` — sending now would start a fresh conversation rather than continuing this one. */
  hasDocumentSelectionDiverged: (documentIds: string[]) => boolean;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

function sameDocumentSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Owns one active conversation's messages and streaming state. A
 * conversation's document context is fixed once created (mirrors the
 * backend rule — see ConversationService); if the caller sends a message
 * with a document selection that no longer matches the active conversation,
 * this starts a fresh conversation rather than sending a request the server
 * would reject anyway.
 */
export function useChat(): UseChatResult {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationDocumentIds, setConversationDocumentIds] = useState<string[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);

  const hasDocumentSelectionDiverged = useCallback(
    (documentIds: string[]) => conversationId !== null && conversationDocumentIds !== null && !sameDocumentSet(conversationDocumentIds, documentIds),
    [conversationId, conversationDocumentIds],
  );

  const sendMessage = useCallback(
    async (documentIds: string[], text: string) => {
      const trimmed = text.trim();
      if (documentIds.length === 0 || !trimmed || isStreamingRef.current) return;

      const continuingConversation = conversationId !== null && conversationDocumentIds !== null && sameDocumentSet(conversationDocumentIds, documentIds);

      isStreamingRef.current = true;
      setIsStreaming(true);

      const assistantId = nextMessageId();
      const userMessage: ChatMessage = { id: nextMessageId(), role: "user", content: trimmed };
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
        stage: "retrieving",
      };

      if (continuingConversation) {
        setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      } else {
        // Selection diverged from the active conversation (or there wasn't one) — start fresh rather
        // than sending a conversationId the server would reject as a document-context mismatch.
        setConversationId(null);
        setConversationDocumentIds(null);
        setMessages([userMessage, assistantPlaceholder]);
      }

      const updateAssistant = (patch: Partial<ChatMessage>): void => {
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)));
      };

      try {
        await streamChatResponse(
          { documentIds, message: trimmed, conversationId: continuingConversation ? (conversationId ?? undefined) : undefined },
          {
            onMetadata: (metadata: ChatMetadata) => {
              setConversationId(metadata.conversationId);
              setConversationDocumentIds(metadata.documentIds);
              updateAssistant({ sources: metadata.sources, stage: "generating" });
            },
            onDelta: (delta) => {
              setMessages((prev) =>
                prev.map((message) => (message.id === assistantId ? { ...message, content: message.content + delta } : message)),
              );
            },
            onDone: () => updateAssistant({ status: "complete" }),
            onError: (message) => updateAssistant({ status: "error", errorMessage: message }),
          },
        );
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Something went wrong while generating the answer.";
        updateAssistant({ status: "error", errorMessage: message });
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    [conversationId, conversationDocumentIds],
  );

  const loadConversation = useCallback((id: string, documentIds: string[], restoredMessages: ChatMessage[]) => {
    setConversationId(id);
    setConversationDocumentIds(documentIds);
    setMessages(restoredMessages);
  }, []);

  const startNewChat = useCallback(() => {
    setConversationId(null);
    setConversationDocumentIds(null);
    setMessages([]);
  }, []);

  return { conversationId, messages, isStreaming, sendMessage, loadConversation, startNewChat, hasDocumentSelectionDiverged };
}
