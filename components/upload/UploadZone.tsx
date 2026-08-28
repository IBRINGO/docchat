"use client";

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/validation/upload.schema";
import { MAX_DOCUMENT_PAGE_COUNT } from "@/lib/config/document-limits";

export interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

const MAX_SIZE_MB = Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));

/**
 * Drag-and-drop / click-to-browse PDF picker — accepts any number of files at
 * once. This component only collects the raw file selection; all validation
 * (per-file extension/size, and every file getting its own visible outcome)
 * happens in hooks/useMultiDocumentUpload.ts via lib/validation/upload-client.ts,
 * so the limits are defined exactly once.
 */
export function UploadZone({ onFilesSelected, disabled = false }: UploadZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      onFilesSelected(Array.from(fileList));
    },
    [onFilesSelected],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files);
    event.target.value = "";
  };

  return (
    <div className="w-full max-w-xl">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Upload PDF documents"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors duration-150",
          disabled ? "cursor-not-allowed border-zinc-200 opacity-60 dark:border-zinc-800" : "cursor-pointer",
          !disabled && isDraggingOver
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
            : !disabled && "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/50",
        )}
      >
        <UploadCloud className={cn("h-9 w-9 text-zinc-400 transition-transform duration-150", isDraggingOver && "scale-110")} strokeWidth={1.5} />
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Drop one or more PDF files here, or click to browse
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            PDF • up to {MAX_SIZE_MB} MB per document • up to {MAX_DOCUMENT_PAGE_COUNT} pages per document
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
