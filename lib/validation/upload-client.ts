import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/validation/upload.schema";

/**
 * Lightweight, client-safe pre-validation for a file the user just picked —
 * extension and size only. This is NOT the authority: the server always
 * re-validates independently (MIME type, extension, size, and the PDF
 * magic-byte signature — see validateUploadedFile in upload.schema.ts), since
 * a client-side check can't read the file's actual bytes cheaply and can be
 * bypassed entirely. This exists purely so the upload queue can reject an
 * obviously-wrong file instantly, without a round trip, using the same
 * MAX_UPLOAD_SIZE_BYTES constant the server enforces — never a duplicated
 * literal.
 */
export interface ClientFileInfo {
  name: string;
  size: number;
}

export interface ClientFileValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateFileClientSide(file: ClientFileInfo): ClientFileValidationResult {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return { valid: false, reason: "Only PDF files are accepted." };
  }
  if (file.size === 0) {
    return { valid: false, reason: "This file is empty." };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return { valid: false, reason: `The file exceeds the maximum allowed size of ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB.` };
  }
  return { valid: true };
}
