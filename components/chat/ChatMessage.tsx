"use client";

import { useState } from "react";
import { AlertCircle, Check, Copy, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { markdownToPlainText } from "@/lib/utils/markdown";
import { SourceList } from "@/components/chat/SourceList";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import type { ChatMessage as ChatMessageType, ChatMessageStage } from "@/types/chat";

export interface ChatMessageProps {
  message: ChatMessageType;
}

const STAGE_LABEL: Record<ChatMessageStage, string> = {
  retrieving: "Searching selected documents…",
  generating: "Generating response…",
};

function CopyButton({ content }: { content: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdownToPlainText(content));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      setTimeout(() => setCopyState("idle"), 1800);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copyState === "copied" ? "Answer copied to clipboard" : "Copy answer"}
      className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      {copyState === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isEmptyWhileStreaming = message.content.length === 0 && message.status === "streaming";

  return (
    <div className={cn("animate-fade-in-up flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "whitespace-pre-wrap bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
          )}
        >
          {isUser ? (
            message.content
          ) : isEmptyWhileStreaming ? (
            <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              {message.stage === "retrieving" ? <Search className="h-3.5 w-3.5 animate-pulse" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {message.stage ? STAGE_LABEL[message.stage] : "Thinking…"}
            </span>
          ) : (
            <>
              <MarkdownMessage content={message.content} />
              {message.status === "streaming" ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 -mb-0.5 animate-pulse bg-current align-middle" aria-hidden="true" />
              ) : null}
            </>
          )}
        </div>

        {!isUser && message.status === "complete" && message.content.length > 0 ? (
          <div className="mt-1">
            <CopyButton content={message.content} />
          </div>
        ) : null}

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
