"use client";

import { useCallback, useEffect, useState } from "react";
import { listConversations, ApiError } from "@/lib/client/api";
import type { ConversationSummary } from "@/lib/services/conversation-list.service";

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  isLoading: boolean;
  errorMessage: string | null;
  refresh: () => void;
}

const CONVERSATIONS_PAGE_LIMIT = 50;

/** Owns the conversation history sidebar's list state — a single page is enough at this project's scale, refreshed after every new message. */
export function useConversations(): UseConversationsResult {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const result = await listConversations({ limit: CONVERSATIONS_PAGE_LIMIT });
        if (!cancelled) setConversations(result.conversations);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof ApiError ? error.message : "The conversation history could not be loaded.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return { conversations, isLoading, errorMessage, refresh };
}
