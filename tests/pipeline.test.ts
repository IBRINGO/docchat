import { describe, expect, it } from "vitest";
import { normalizeExtractedText } from "@/lib/pdf/normalize";
import { chunkDocument } from "@/lib/rag/chunker";
import type { ExtractedPage } from "@/lib/pdf/types";

/**
 * Mirrors the future orchestration flow (extract -> normalize -> chunk ->
 * [embeddings, not yet implemented]) end to end at the string level, without
 * a real PDF, to confirm French and Arabic content survives both stages.
 */
describe("normalize -> chunk pipeline", () => {
  it("preserves French content through normalization and chunking", () => {
    const rawPages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "L'intelligence   artificielle\n\n\naméliore la recherche documentaire.   ",
      },
    ];

    const normalizedPages = rawPages.map((page) => ({
      ...page,
      text: normalizeExtractedText(page.text),
    }));
    const chunks = chunkDocument(normalizedPages);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("L'intelligence artificielle\n\naméliore la recherche documentaire.");
    expect(chunks[0].pageNumber).toBe(1);
  });

  it("preserves Arabic content through normalization and chunking", () => {
    const rawPages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: "الذكاء   الاصطناعي\r\nيساعد على تحليل المستندات.",
      },
    ];

    const normalizedPages = rawPages.map((page) => ({
      ...page,
      text: normalizeExtractedText(page.text),
    }));
    const chunks = chunkDocument(normalizedPages);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("الذكاء الاصطناعي");
    expect(chunks[0].content).toContain("تحليل المستندات");
  });

  it("keeps per-page numbering intact across a multi-page, multilingual document", () => {
    const rawPages: ExtractedPage[] = [
      { pageNumber: 1, text: "L'IA aide à comprendre les documents." },
      { pageNumber: 2, text: "الذكاء الاصطناعي يساعد على تحليل المستندات." },
    ];

    const normalizedPages = rawPages.map((page) => ({
      ...page,
      text: normalizeExtractedText(page.text),
    }));
    const chunks = chunkDocument(normalizedPages);

    expect(chunks.map((c) => c.pageNumber)).toEqual([1, 2]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });
});
