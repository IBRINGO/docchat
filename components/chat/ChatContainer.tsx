"use client";

import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { formatDocumentNameList } from "@/lib/utils/format";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

export interface ChatContainerProps {
  documentNames: string[];
  messages: ChatMessageType[];
  isStreaming: boolean;
  onSend: (text: string) => void;
}

/** Distance (px) from the bottom within which the view still counts as "at the bottom" — small enough to feel exact, large enough to absorb rounding. */
const NEAR_BOTTOM_THRESHOLD_PX = 96;

export function ChatContainer({ documentNames, messages, isStreaming, onSend }: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  };

  useEffect(() => {
    // Only auto-scroll if the reader hadn't already scrolled up to review earlier messages —
    // a manual scroll-up is never fought with an automatic jump back down.
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? "auto" : "smooth", block: "end" });
  }, [messages, isStreaming]);

  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 ? (
          <div className="animate-fade-in flex h-full flex-col items-center justify-center gap-2 text-center text-zinc-400 dark:text-zinc-600">
            <MessageSquare className="h-8 w-8" strokeWidth={1.5} />
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">New conversation</p>
            <p className="max-w-xs text-xs">Your documents are ready. Ask anything about {formatDocumentNameList(documentNames)}.</p>
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
