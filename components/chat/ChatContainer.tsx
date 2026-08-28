"use client";

import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

export interface ChatContainerProps {
  documentName: string;
  messages: ChatMessageType[];
  isStreaming: boolean;
  onSend: (text: string) => void;
}

export function ChatContainer({ documentName, messages, isStreaming, onSend }: ChatContainerProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400 dark:text-zinc-600">
            <MessageSquare className="h-8 w-8" strokeWidth={1.5} />
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Ask anything about {documentName}</p>
            <p className="max-w-xs text-xs">Answers are grounded strictly in the content of this document.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <ChatInput onSend={onSend} disabled={isStreaming} />
      </div>
    </div>
  );
}
