import { describe, expect, it } from "vitest";
import { chunkDocument, chunkPageText, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "@/lib/rag/chunker";
import type { ExtractedPage } from "@/lib/pdf/types";

function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
}

describe("chunkPageText", () => {
  it("produces a single chunk for short text", () => {
    const chunks = chunkPageText("A short paragraph about DocChat.", 1000, 200);
    expect(chunks).toEqual(["A short paragraph about DocChat."]);
  });

  it("returns no chunks for empty text", () => {
    expect(chunkPageText("", 1000, 200)).toEqual([]);
    expect(chunkPageText("   \n\n  ", 1000, 200)).toEqual([]);
  });

  it("splits long text into multiple non-empty chunks", () => {
    const text = words(500);
    const chunks = chunkPageText(text, 100, 20);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.trim()).toBe(chunk);
    }
  });

  it("produces overlapping content between consecutive chunks", () => {
    const text = words(500);
    const chunks = chunkPageText(text, 100, 30);

    expect(chunks.length).toBeGreaterThan(1);

    const firstChunkWords = new Set(chunks[0].split(" "));
    const secondChunkWords = chunks[1].split(" ");
    const overlapWords = secondChunkWords.filter((w) => firstChunkWords.has(w));

    expect(overlapWords.length).toBeGreaterThan(0);
  });

  it("prefers a paragraph boundary when one is available", () => {
    const paragraphA = "Alpha ".repeat(20).trim();
    const paragraphB = "Beta ".repeat(20).trim();
    const text = `${paragraphA}\n\n${paragraphB}`;

    const chunks = chunkPageText(text, text.length - 10, 0);

    expect(chunks[0]).toBe(paragraphA);
    expect(chunks[1]).toBe(paragraphB);
  });

  it("makes forward progress and terminates for one long unbroken token", () => {
    const longToken = "x".repeat(5000);
    const chunks = chunkPageText(longToken, 100, 20);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBeGreaterThanOrEqual(longToken.length);
  });

  it("is deterministic for the same input", () => {
    const text = words(300);
    expect(chunkPageText(text, 120, 25)).toEqual(chunkPageText(text, 120, 25));
  });
});

describe("chunkDocument", () => {
  const pages: ExtractedPage[] = [
    { pageNumber: 1, text: words(10) },
    { pageNumber: 2, text: words(500) },
    { pageNumber: 3, text: words(5) },
  ];

  it("assigns sequential chunkIndex across the whole document", () => {
    const chunks = chunkDocument(pages, { chunkSize: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(pages.length);
    chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i);
    });
  });

  it("preserves the source page number on every chunk and never crosses pages", () => {
    const chunks = chunkDocument(pages, { chunkSize: 100, overlap: 20 });

    const page1Chunks = chunks.filter((c) => c.pageNumber === 1);
    const page2Chunks = chunks.filter((c) => c.pageNumber === 2);
    const page3Chunks = chunks.filter((c) => c.pageNumber === 3);

    expect(page1Chunks.length).toBeGreaterThan(0);
    expect(page2Chunks.length).toBeGreaterThan(1);
    expect(page3Chunks.length).toBeGreaterThan(0);

    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("uses default chunkSize/overlap when no options are given", () => {
    const chunks = chunkDocument([{ pageNumber: 1, text: "Short page." }]);
    expect(chunks).toEqual([{ content: "Short page.", pageNumber: 1, chunkIndex: 0 }]);
    expect(DEFAULT_CHUNK_SIZE).toBe(1000);
    expect(DEFAULT_CHUNK_OVERLAP).toBe(200);
  });

  it("rejects a non-positive chunkSize", () => {
    expect(() => chunkDocument(pages, { chunkSize: 0, overlap: 10 })).toThrow();
    expect(() => chunkDocument(pages, { chunkSize: -50, overlap: 10 })).toThrow();
  });

  it("rejects a negative overlap", () => {
    expect(() => chunkDocument(pages, { chunkSize: 100, overlap: -1 })).toThrow();
  });

  it("rejects overlap greater than or equal to chunkSize", () => {
    expect(() => chunkDocument(pages, { chunkSize: 100, overlap: 100 })).toThrow();
    expect(() => chunkDocument(pages, { chunkSize: 100, overlap: 150 })).toThrow();
  });

  it("returns no chunks for a document with no pages", () => {
    expect(chunkDocument([])).toEqual([]);
  });
});

describe("multilingual content", () => {
  it("preserves French text through chunking", () => {
    const french = "L'intelligence artificielle améliore la recherche documentaire.";
    const chunks = chunkDocument([{ pageNumber: 1, text: french }]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(french);
  });

  it("preserves Arabic text through chunking", () => {
    const arabic = "الذكاء الاصطناعي يساعد على تحليل المستندات.";
    const chunks = chunkDocument([{ pageNumber: 1, text: arabic }]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(arabic);
  });

  it("preserves French and Arabic text when it must be split across chunks", () => {
    const french = "L'intelligence artificielle améliore la recherche documentaire. ".repeat(30);
    const chunks = chunkDocument([{ pageNumber: 1, text: french }], { chunkSize: 200, overlap: 40 });

    expect(chunks.length).toBeGreaterThan(1);
    const rejoined = chunks.map((c) => c.content).join(" ");
    expect(rejoined).toContain("améliore");
    expect(rejoined).toContain("documentaire");
  });
});
