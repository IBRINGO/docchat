import { logger } from "@/lib/utils/logger";
import type { ExtractedPage } from "@/lib/pdf/types";
import type { ChunkingOptions, DocumentChunk } from "@/lib/rag/types";

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * A boundary is only accepted if it falls at least this fraction of chunkSize
 * past the chunk's start. Without this, a paragraph/sentence break very close
 * to `start` would produce tiny, lopsided chunks instead of a usefully sized one.
 */
const MIN_BOUNDARY_RATIO = 0.3;

const PARAGRAPH_BOUNDARY = /\n[ \t]*\n/;
const SENTENCE_BOUNDARY = /[.!?؟。][ \t\n]/;
const WHITESPACE_BOUNDARY = /\s+/;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Nudges an index back by one if it falls inside a UTF-16 surrogate pair. */
function avoidSurrogateSplit(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  if (isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index))) {
    return index - 1;
  }
  return index;
}

function findLastMatchEnd(text: string, from: number, to: number, pattern: RegExp): number | null {
  const slice = text.slice(from, to);
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);

  let lastEnd: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(slice)) !== null) {
    lastEnd = from + match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return lastEnd;
}

/**
 * Chooses where a chunk should end, within (start, idealEnd]. Tries
 * paragraph, then sentence, then whitespace boundaries, in that order, and
 * only falls back to a hard cut at idealEnd if none qualify.
 */
function pickChunkEnd(text: string, start: number, idealEnd: number, chunkSize: number): number {
  const minBoundary = start + Math.floor(chunkSize * MIN_BOUNDARY_RATIO);

  for (const pattern of [PARAGRAPH_BOUNDARY, SENTENCE_BOUNDARY, WHITESPACE_BOUNDARY]) {
    const end = findLastMatchEnd(text, start, idealEnd, pattern);
    if (end !== null && end > minBoundary) {
      return end;
    }
  }

  return avoidSurrogateSplit(text, idealEnd);
}

/**
 * Chooses where the next chunk should start so it repeats up to `overlap`
 * characters of trailing context from the chunk that just ended, snapped
 * forward to the nearest whitespace boundary rather than a raw character cut.
 */
function pickNextStart(text: string, previousStart: number, end: number, overlap: number): number {
  if (overlap <= 0) {
    return end;
  }

  const desired = Math.max(previousStart, end - overlap);
  const window = text.slice(desired, end);
  const match = WHITESPACE_BOUNDARY.exec(window);
  const candidate = match ? desired + match.index + match[0].length : desired;

  const nextStart = candidate > previousStart ? candidate : end;
  return avoidSurrogateSplit(text, nextStart);
}

/**
 * Splits one page's text into chunks using a deterministic hierarchical
 * strategy (paragraph > sentence > whitespace > hard split). Guarantees
 * forward progress on every iteration, so it terminates even for a single
 * "word" longer than chunkSize.
 */
export function chunkPageText(text: string, chunkSize: number, overlap: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const idealEnd = Math.min(start + chunkSize, trimmed.length);
    const end = idealEnd >= trimmed.length ? trimmed.length : pickChunkEnd(trimmed, start, idealEnd, chunkSize);

    const chunkText = trimmed.slice(start, end).trim();
    if (chunkText.length > 0) {
      chunks.push(chunkText);
    }

    if (end >= trimmed.length) break;

    start = pickNextStart(trimmed, start, end, overlap);
  }

  return chunks;
}

function validateChunkingOptions(chunkSize: number, overlap: number): void {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid chunking configuration: chunkSize must be a positive number, received ${chunkSize}`);
  }
  if (!Number.isFinite(overlap) || overlap < 0) {
    throw new Error(`Invalid chunking configuration: overlap must be zero or greater, received ${overlap}`);
  }
  if (overlap >= chunkSize) {
    throw new Error(
      `Invalid chunking configuration: overlap (${overlap}) must be smaller than chunkSize (${chunkSize})`,
    );
  }
}

/**
 * Chunks an already-normalized document page by page. Chunks never cross a
 * page boundary; chunkIndex is sequential across the whole document (not
 * reset per page) so chunks can be cited back to a document position.
 */
export function chunkDocument(pages: ExtractedPage[], options: ChunkingOptions = {}): DocumentChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP;
  validateChunkingOptions(chunkSize, overlap);

  const startedAt = Date.now();
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    for (const content of chunkPageText(page.text, chunkSize, overlap)) {
      chunks.push({ content, pageNumber: page.pageNumber, chunkIndex });
      chunkIndex += 1;
    }
  }

  logger.info("document_chunked", {
    pageCount: pages.length,
    chunkCount: chunks.length,
    chunkSize,
    overlap,
    durationMs: Date.now() - startedAt,
  });

  return chunks;
}
