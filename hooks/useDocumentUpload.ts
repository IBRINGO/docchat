"use client";

import { useCallback, useState } from "react";
import { uploadDocument, ApiError, type UploadedDocument } from "@/lib/client/api";

export type UploadStage = "idle" | "uploading" | "error";

export interface UseDocumentUploadResult {
  stage: UploadStage;
  errorMessage: string | null;
  upload: (file: File) => Promise<void>;
  dismissError: () => void;
}

/**
 * Drives the upload lifecycle only — it does not own "which document is
 * active" anymore now that documents live in a shared library (see
 * useDocumentLibrary). POST /api/upload runs extraction, chunking,
 * embedding, and persistence in one request/response cycle, so there is no
 * real intermediate progress to report; this only tracks
 * idle → uploading → (idle | error). On success, `onUploaded` is invoked
 * (typically to refresh the library) and the newly uploaded document is
 * deliberately left unselected — the user must pick it explicitly.
 */
export function useDocumentUpload(onUploaded?: (document: UploadedDocument) => void): UseDocumentUploadResult {
  const [stage, setStage] = useState<UploadStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setStage("uploading");
      setErrorMessage(null);

      try {
        const result = await uploadDocument(file);
        onUploaded?.(result);
        setStage("idle");
      } catch (error) {
        setErrorMessage(error instanceof ApiError ? error.message : "The document could not be uploaded.");
        setStage("error");
      }
    },
    [onUploaded],
  );

  const dismissError = useCallback(() => {
    setStage("idle");
    setErrorMessage(null);
  }, []);

  return { stage, errorMessage, upload, dismissError };
}
