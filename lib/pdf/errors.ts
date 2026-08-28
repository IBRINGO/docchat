import { AppError } from "@/lib/utils/errors";

export function pdfInvalidInputError(): AppError {
  return new AppError({
    code: "PDF_INVALID_INPUT",
    message: "The uploaded file is empty or is not a valid PDF.",
    status: 422,
  });
}

export function pdfUnreadableError(cause: unknown): AppError {
  return new AppError({
    code: "PDF_UNREADABLE",
    message: "The uploaded file could not be read as a PDF.",
    status: 422,
    cause,
  });
}

export function pdfTextNotExtractableError(): AppError {
  return new AppError({
    code: "PDF_TEXT_NOT_EXTRACTABLE",
    message:
      "No extractable text was found in this document. Scanned or image-only PDFs are not supported yet.",
    status: 422,
  });
}

export function pdfTooManyPagesError(pageCount: number, maxPages: number): AppError {
  return new AppError({
    code: "PDF_TOO_MANY_PAGES",
    message: `The document has ${pageCount} pages, which exceeds the maximum of ${maxPages} pages.`,
    status: 422,
  });
}
