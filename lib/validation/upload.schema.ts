import { AppError } from "@/lib/utils/errors";

/** Matches the assessment's stated PDF size limit (~10 MB). */
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXTENSION = ".pdf";
/** Some HTTP clients can't infer a MIME type and fall back to the generic binary type; the PDF signature check below is the real authority either way. */
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "application/octet-stream"]);
const PDF_MAGIC_BYTES = Buffer.from("%PDF-", "ascii");

export interface UploadedFileMetadata {
  name: string;
  type: string;
  size: number;
}

export function fileMissingError(): AppError {
  return new AppError({
    code: "FILE_MISSING",
    message: "No file was provided, or the uploaded file is empty.",
    status: 400,
  });
}

export function invalidFileTypeError(): AppError {
  return new AppError({
    code: "INVALID_FILE_TYPE",
    message: "Only PDF files are accepted.",
    status: 415,
  });
}

export function fileTooLargeError(): AppError {
  return new AppError({
    code: "FILE_TOO_LARGE",
    message: `The file exceeds the maximum allowed size of ${Math.floor(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB.`,
    status: 413,
  });
}

export function invalidPdfFileError(): AppError {
  return new AppError({
    code: "INVALID_PDF_FILE",
    message: "The file does not appear to be a valid PDF.",
    status: 422,
  });
}

function hasPdfExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(ALLOWED_EXTENSION);
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC_BYTES.length).equals(PDF_MAGIC_BYTES);
}

/**
 * Validates an uploaded file defensively before it reaches the ingestion
 * pipeline. MIME type and extension are both easy to spoof, so the PDF
 * magic-byte signature is checked too — that's the real authority. Throws
 * a specific AppError for the first check that fails.
 */
export function validateUploadedFile(metadata: UploadedFileMetadata, buffer: Buffer): void {
  if (metadata.size === 0 || buffer.length === 0) {
    throw fileMissingError();
  }
  if (metadata.size > MAX_UPLOAD_SIZE_BYTES) {
    throw fileTooLargeError();
  }
  if (!ALLOWED_MIME_TYPES.has(metadata.type)) {
    throw invalidFileTypeError();
  }
  if (!hasPdfExtension(metadata.name)) {
    throw invalidFileTypeError();
  }
  if (!hasPdfSignature(buffer)) {
    throw invalidPdfFileError();
  }
}
