// MUST be the first import in this file: it synchronously sets globalThis.DOMMatrix as its
// module body runs, and ESM evaluates static imports depth-first in source order — so this
// guarantees the polyfill is in place before pdfjs-dist's own module body (imported next) runs
// its module-top-level `new DOMMatrix()` call. See that module's doc comment for the full story
// (root cause: a Vercel-only crash, "ReferenceError: DOMMatrix is not defined").
import "@/lib/pdf/node-polyfills";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import { logger } from "@/lib/utils/logger";
import { pdfInvalidInputError, pdfTextNotExtractableError, pdfUnreadableError } from "@/lib/pdf/errors";
import type { ExtractedDocument, ExtractedPage } from "@/lib/pdf/types";

declare global {
  var pdfjsWorker: typeof import("pdfjs-dist/legacy/build/pdf.worker.mjs") | undefined;
}

/**
 * pdf.js has no real Worker thread to hand off to in Node, so it falls back
 * to dynamically importing its own worker module by a path relative to
 * wherever pdf.mjs itself ended up ("./pdf.worker.mjs"). That's fine
 * unbundled, but Next.js's bundler (Turbopack) relocates pdf.mjs into
 * .next/.../chunks/ without carrying pdf.worker.mjs along, so the relative
 * import 404s ("Setting up fake worker failed"). pdf.js checks
 * `globalThis.pdfjsWorker` before attempting that dynamic import, so
 * statically importing the worker module ourselves — which the bundler
 * resolves correctly, since it's a static import, not a runtime path —
 * and registering it here skips the broken lookup entirely.
 */
globalThis.pdfjsWorker = pdfjsWorker;

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
    logger.error("pdf_extraction_failed", { reason: "unreadable", error });
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
