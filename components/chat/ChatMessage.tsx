"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SourceList } from "@/components/chat/SourceList";
import type { ChatMessage as ChatMessageType } from "@/types/chat";

export interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
            isUser
              ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
          )}
        >
          {message.content.length > 0 ? (
            message.content
          ) : message.status === "streaming" ? (
            <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </span>
          ) : null}
          {message.status === "streaming" && message.content.length > 0 ? (
            <span className="ml-0.5 inline-block h-4 w-1.5 -mb-0.5 animate-pulse bg-current align-middle" />
          ) : null}
        </div>

        {message.status === "error" ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" />
            {message.errorMessage ?? "Something went wrong."}
          </p>
        ) : null}

        {!isUser && message.sources && message.sources.length > 0 ? (
          <div className="w-full">
            <SourceList sources={message.sources} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
