import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { logger } from "@/lib/utils/logger";
import { pdfInvalidInputError, pdfTextNotExtractableError, pdfUnreadableError } from "@/lib/pdf/errors";
import type { ExtractedDocument, ExtractedPage } from "@/lib/pdf/types";

// pdf.js does not export TextItem/TextMarkedContent from the package root, so
// the item type is derived structurally from the public PDFPageProxy API.
type TextContentItem = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number];
type RenderableTextItem = Extract<TextContentItem, { str: string }>;

function isRenderableTextItem(item: TextContentItem): item is RenderableTextItem {
  return "str" in item;
}

/**
 * Joins a page's text items into a single string. Items flagged `hasEOL`
 * (pdf.js detected a line break in the original layout) are separated with a
 * newline instead of a space so paragraph structure survives into
 * normalization; everything else is joined with the space that pdf.js's own
 * word-gap heuristics don't otherwise guarantee.
 */
function joinTextItems(items: ReadonlyArray<TextContentItem>): string {
  const parts: string[] = [];
  for (const item of items) {
    if (!isRenderableTextItem(item)) continue;
    parts.push(item.str, item.hasEOL ? "\n" : " ");
  }
  return parts.join("");
}

async function loadDocument(buffer: Buffer): Promise<PDFDocumentProxy> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
  });

  try {
    return await loadingTask.promise;
  } catch (error) {
    throw pdfUnreadableError(error);
  }
}

/**
 * Extracts text from a text-based PDF, page by page, preserving original
 * page order and 1-based page numbers. Pages with no meaningful text are
 * omitted from the result but still counted in `pageCount`. Does not perform
 * OCR — a scanned/image-only PDF fails with PDF_TEXT_NOT_EXTRACTABLE.
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  if (buffer.length === 0) {
    throw pdfInvalidInputError();
  }

  const startedAt = Date.now();
  logger.info("pdf_extraction_started", { sizeBytes: buffer.length });

  const document = await loadDocument(buffer);

  try {
    const pageCount = document.numPages;
    const pages: ExtractedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items);

      if (text.trim().length > 0) {
        pages.push({ pageNumber, text });
      }
    }

    if (pages.length === 0) {
      logger.warn("pdf_extraction_failed", { reason: "no_extractable_text", pageCount });
      throw pdfTextNotExtractableError();
    }

    logger.info("pdf_extraction_completed", {
      pageCount,
      extractedPageCount: pages.length,
      durationMs: Date.now() - startedAt,
    });

    return { pages, pageCount };
  } finally {
    await document.destroy();
  }
}
