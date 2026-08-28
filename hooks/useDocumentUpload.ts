"use client";

import { useCallback, useState } from "react";
import { uploadDocument, ApiError, type UploadedDocument } from "@/lib/client/api";

export type UploadStage = "idle" | "uploading" | "ready" | "error";

export interface UseDocumentUploadResult {
  stage: UploadStage;
  document: UploadedDocument | null;
  errorMessage: string | null;
  upload: (file: File) => Promise<void>;
  reset: () => void;
}

/**
 * Drives the upload lifecycle. POST /api/upload runs extraction, chunking,
 * embedding, and persistence in one request/response cycle — there is no
 * real intermediate progress to report, so this only tracks
 * idle → uploading → ready/error. Any finer-grained "stage" copy shown in
 * the UI (see ProcessingStatus) is presentational only, not derived from
 * real backend milestones.
 */
export function useDocumentUpload(): UseDocumentUploadResult {
  const [stage, setStage] = useState<UploadStage>("idle");
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    setStage("uploading");
    setErrorMessage(null);

    try {
      const result = await uploadDocument(file);
      setDocument(result);
      setStage("ready");
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : "The document could not be uploaded.");
      setStage("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setDocument(null);
    setErrorMessage(null);
  }, []);

  return { stage, document, errorMessage, upload, reset };
}
