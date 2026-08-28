"use client";

import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

function validateClientSide(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return "Only PDF files are accepted.";
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return "The file exceeds the maximum allowed size of 10 MB.";
  }
  return null;
}

/** Drag-and-drop / click-to-browse PDF picker. Only does lightweight client-side sanity checks — the server remains the authority (MIME, extension, and PDF signature checks in lib/validation/upload.schema.ts). */
export function UploadZone({ onFileSelected, disabled = false }: UploadZoneProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      const validationError = validateClientSide(file);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      setLocalError(null);
      onFileSelected(file);
    },
    [onFileSelected],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    if (disabled) return;
    handleFile(event.dataTransfer.files[0]);
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  return (
    <div className="w-full max-w-xl">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
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
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition-colors",
          disabled ? "cursor-not-allowed border-zinc-200 opacity-60 dark:border-zinc-800" : "cursor-pointer",
          !disabled && isDraggingOver
            ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
            : !disabled && "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900/50",
        )}
      >
        <UploadCloud className="h-9 w-9 text-zinc-400" strokeWidth={1.5} />
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Drop a PDF here, or click to browse
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">PDF only, up to 10 MB</p>
        </div>
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onInputChange} disabled={disabled} />
      </div>
      {localError ? <p className="mt-3 text-sm text-red-600 dark:text-red-400">{localError}</p> : null}
    </div>
  );
}
