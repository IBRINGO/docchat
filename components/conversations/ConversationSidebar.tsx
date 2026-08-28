"use client";

import { MessageSquarePlus, MessageSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ConversationSummary } from "@/lib/services/conversation-list.service";

export interface ConversationSidebarProps {
  conversations: ConversationSummary[];
  isLoading: boolean;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onDelete: (conversationId: string) => void;
}

function ConversationSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <li key={i} className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </ul>
  );
}

/** Left-column conversation history: New Chat action plus the conversation list. Selecting a conversation restores its document context and messages (see app/page.tsx); deleting removes it and its messages permanently. */
export function ConversationSidebar({ conversations, isLoading, activeConversationId, onSelect, onNewChat, onDelete }: ConversationSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-4">
      <button
        type="button"
        onClick={onNewChat}
        className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <MessageSquarePlus className="h-4 w-4" />
        New chat
      </button>

      <div>
        <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">CONVERSATIONS</h2>

        {isLoading && conversations.length === 0 ? (
          <ConversationSkeleton />
        ) : conversations.length === 0 ? (
          <p className="px-1 text-xs text-zinc-400 dark:text-zinc-600">No conversations yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-1.5 rounded-xl px-2.5 py-2 transition-colors",
                      isActive ? "bg-zinc-900 dark:bg-zinc-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-900",
                    )}
                  >
                    <button type="button" onClick={() => onSelect(conversation.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-zinc-50 dark:text-zinc-900" : "text-zinc-400")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm", isActive ? "text-zinc-50 dark:text-zinc-900" : "text-zinc-700 dark:text-zinc-300")}>
                          {conversation.title}
                        </span>
                        <span className={cn("block truncate text-xs", isActive ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400 dark:text-zinc-600")}>
                          {conversation.documentNames.join(", ")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(conversation.id)}
                      aria-label={`Delete conversation "${conversation.title}"`}
                      className={cn(
                        "shrink-0 rounded-lg p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
                        isActive ? "text-zinc-300 hover:text-white dark:text-zinc-600 dark:hover:text-zinc-900" : "text-zinc-400 hover:text-red-600 dark:hover:text-red-400",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
