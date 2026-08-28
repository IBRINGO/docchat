"use client";

import { AlertCircle, FileStack } from "lucide-react";
import { UploadZone } from "@/components/upload/UploadZone";
import { ProcessingStatus } from "@/components/upload/ProcessingStatus";
import { DocumentInfo } from "@/components/upload/DocumentInfo";
import { ChatContainer } from "@/components/chat/ChatContainer";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { useChat } from "@/hooks/useChat";

export default function Home() {
  const { stage, document, errorMessage, upload, reset } = useDocumentUpload();
  const { messages, isStreaming, sendMessage } = useChat(document?.id ?? null);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 dark:bg-black sm:px-6">
      <div className="flex w-full max-w-3xl flex-1 flex-col gap-6">
        <header className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-zinc-900 dark:text-zinc-100" strokeWidth={1.75} />
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">DocChat</span>
        </header>

        {stage === "idle" || stage === "error" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <UploadZone onFileSelected={upload} />
            {stage === "error" && errorMessage ? (
              <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : null}

        {stage === "uploading" ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <ProcessingStatus />
          </div>
        ) : null}

        {stage === "ready" && document ? (
          <div className="flex flex-1 flex-col gap-4">
            <DocumentInfo document={document} onReset={reset} />
            <ChatContainer documentName={document.fileName} messages={messages} isStreaming={isStreaming} onSend={sendMessage} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
