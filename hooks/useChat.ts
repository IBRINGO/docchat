"use client";

import { useCallback, useRef, useState } from "react";
import { streamChatResponse, ApiError } from "@/lib/client/api";
import type { ChatMessage } from "@/types/chat";

export interface UseChatResult {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
}

let messageIdCounter = 0;
function nextMessageId(): string {
  messageIdCounter += 1;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

/** Owns session-only chat history and drives one streamed request at a time against a single document. */
export function useChat(documentId: string | null): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const isStreamingRef = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!documentId || !trimmed || isStreamingRef.current) return;

      isStreamingRef.current = true;
      setIsStreaming(true);

      const assistantId = nextMessageId();
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", status: "streaming" },
      ]);

      const updateAssistant = (patch: Partial<ChatMessage>): void => {
        setMessages((prev) => prev.map((message) => (message.id === assistantId ? { ...message, ...patch } : message)));
      };

      try {
        await streamChatResponse(documentId, trimmed, {
          onMetadata: (sources) => updateAssistant({ sources }),
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + delta } : message,
              ),
            );
          },
          onDone: () => updateAssistant({ status: "complete" }),
          onError: (message) => updateAssistant({ status: "error", errorMessage: message }),
        });
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Something went wrong while generating the answer.";
        updateAssistant({ status: "error", errorMessage: message });
      } finally {
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    [documentId],
  );

  return { messages, isStreaming, sendMessage };
}
