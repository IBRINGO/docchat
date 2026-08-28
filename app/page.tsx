"use client";

import { useCallback, useState } from "react";
import { AlertCircle, FileStack, Info, MessageSquare, X } from "lucide-react";
import { UploadZone } from "@/components/upload/UploadZone";
import { UploadQueueList } from "@/components/upload/UploadQueueList";
import { DocumentLibrary } from "@/components/documents/DocumentLibrary";
import { SelectedDocumentsSummary } from "@/components/documents/SelectedDocumentsSummary";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { ConversationSidebar } from "@/components/conversations/ConversationSidebar";
import { useMultiDocumentUpload, type UploadBatchResult } from "@/hooks/useMultiDocumentUpload";
import { useDocumentLibrary } from "@/hooks/useDocumentLibrary";
import { useDocumentSelection } from "@/hooks/useDocumentSelection";
import { useConversations } from "@/hooks/useConversations";
import { useChat } from "@/hooks/useChat";
import { getConversation, deleteConversation, createConversation, ApiError } from "@/lib/client/api";
import type { ChatMessage } from "@/types/chat";

export default function Home() {
  const library = useDocumentLibrary();
  const selection = useDocumentSelection(library.documents);
  const chat = useChat();
  const conversations = useConversations();
  const [conversationError, setConversationError] = useState<string | null>(null);

  const handleFileUploaded = useCallback(() => {
    // A newly uploaded document is deliberately left unselected until the whole upload batch
    // settles — see handleUploadBatchSettled, which decides the resulting selection at once.
    library.refresh();
  }, [library]);

  /**
   * Fires once per upload action (not per file — see useMultiDocumentUpload's
   * onBatchSettled) once every file in that batch has either succeeded or
   * failed. Implements the "upload → new conversation" flow: the batch's
   * successfully-uploaded documents become the active selection and get one
   * new persisted conversation, which becomes the active chat — never one
   * conversation per file, and never a conversation at all if nothing in the
   * batch succeeded. If conversation creation fails (e.g. the combined
   * selection violates the cumulative size/page limits), the uploaded
   * documents are left exactly as they are — still uploaded, visible in the
   * library — and a clear, non-destructive error explains what happened; the
   * currently active conversation, if any, is never touched by any of this.
   */
  const handleUploadBatchSettled = useCallback(
    async (result: UploadBatchResult) => {
      library.refresh();

      const readyDocumentIds = result.succeeded.map((item) => item.documentId).filter((id): id is string => id !== null);
      if (readyDocumentIds.length === 0) return;

      setConversationError(null);
      try {
        const conversation = await createConversation(readyDocumentIds);
        selection.setSelection(readyDocumentIds);
        chat.loadConversation(conversation.id, conversation.documentIds, []);
        conversations.refresh();
      } catch (error) {
        const detail = error instanceof ApiError ? error.message : "Please select them manually to start a chat.";
        setConversationError(
          `${readyDocumentIds.length === 1 ? "Your document" : "Your documents"} uploaded successfully, but starting a new conversation failed: ${detail}`,
        );
      }
    },
    [library, selection, chat, conversations],
  );

  const upload = useMultiDocumentUpload(handleFileUploaded, handleUploadBatchSettled);

  const handleSend = useCallback(
    async (text: string) => {
      await chat.sendMessage(selection.selectedIds, text);
      conversations.refresh();
    },
    [chat, selection.selectedIds, conversations],
  );

  const handleSelectConversation = useCallback(
    async (conversationId: string) => {
      setConversationError(null);
      try {
        const { conversation, messages } = await getConversation(conversationId);
        selection.setSelection(conversation.documentIds);
        const restoredMessages: ChatMessage[] = messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          status: "complete",
          sources: message.sources.map((source) => ({
            id: source.chunkId,
            documentId: source.documentId,
            documentName: source.documentName,
            content: source.content,
            pageNumber: source.pageNumber,
            chunkIndex: source.chunkIndex,
            score: source.score,
          })),
        }));
        chat.loadConversation(conversation.id, conversation.documentIds, restoredMessages);
      } catch (error) {
        setConversationError(error instanceof ApiError ? error.message : "The conversation could not be loaded.");
      }
    },
    [selection, chat],
  );

  const handleNewChat = useCallback(() => {
    chat.startNewChat();
  }, [chat]);

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      setConversationError(null);
      try {
        await deleteConversation(conversationId);
        if (chat.conversationId === conversationId) chat.startNewChat();
        conversations.refresh();
      } catch (error) {
        setConversationError(error instanceof ApiError ? error.message : "The conversation could not be deleted.");
      }
    },
    [chat, conversations],
  );

  const selectedDocuments = library.documents.filter((doc) => selection.selectedIds.includes(doc.id));
  const selectionDiverged = chat.hasDocumentSelectionDiverged(selection.selectedIds);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black lg:flex-row">
      <aside className="w-full shrink-0 border-b border-zinc-200 p-4 dark:border-zinc-800 lg:h-auto lg:w-72 lg:border-b-0 lg:border-r">
        <ConversationSidebar
          conversations={conversations.conversations}
          isLoading={conversations.isLoading}
          activeConversationId={chat.conversationId}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onDelete={handleDeleteConversation}
        />
      </aside>

      <div className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6">
        <div className="flex w-full max-w-3xl flex-1 flex-col gap-6">
          <header className="flex items-center gap-2">
            <FileStack className="h-5 w-5 text-zinc-900 dark:text-zinc-100" strokeWidth={1.75} />
            <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">DocChat</span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">Chat with your documents</span>
          </header>

          {conversationError ? (
            <p className="animate-fade-in-up flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              {conversationError}
              <button type="button" onClick={() => setConversationError(null)} aria-label="Dismiss" className="ml-1 text-red-400 hover:text-red-600 dark:hover:text-red-300">
                <X className="h-3.5 w-3.5" />
              </button>
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <UploadZone onFilesSelected={upload.addFiles} />
            <UploadQueueList items={upload.items} onRemove={upload.removeItem} onRetry={upload.retryItem} />
            {upload.items.length > 0 && !upload.isBusy ? (
              <button
                type="button"
                onClick={upload.clearFinished}
                className="self-start text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                Clear finished uploads
              </button>
            ) : null}
          </div>

          <SelectedDocumentsSummary
            count={selection.selectedIds.length}
            documentNames={selectedDocuments.map((doc) => doc.fileName)}
            totals={selection.totals}
            rejection={selection.lastRejection}
            onDismissRejection={selection.dismissRejection}
          />

          {selectionDiverged ? (
            <p className="animate-fade-in-up flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <Info className="h-4 w-4 shrink-0" />
              Document selection changed. Sending a message will start a new conversation with the selected documents.
            </p>
          ) : null}

          {selection.selectedIds.length > 0 ? (
            <ChatContainer
              documentNames={selectedDocuments.map((doc) => doc.fileName)}
              messages={chat.messages}
              isStreaming={chat.isStreaming}
              onSend={handleSend}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-zinc-200 py-14 text-center text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
              <MessageSquare className="h-7 w-7" strokeWidth={1.5} />
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Select one or more ready documents to start chatting</p>
              <p className="max-w-xs text-xs">Answers are grounded strictly in the content of the documents you select.</p>
            </div>
          )}

          <DocumentLibrary
            documents={library.documents}
            isLoading={library.isLoading}
            search={library.search}
            onSearchChange={library.setSearch}
            statusFilter={library.statusFilter}
            onStatusFilterChange={library.setStatusFilter}
            selectedIds={selection.selectedIds}
            canSelect={selection.canSelect}
            onToggle={selection.toggle}
            hasMore={library.hasMore}
            onLoadMore={library.loadMore}
          />
        </div>
      </div>
    </div>
  );
}
