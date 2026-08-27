import { describe, expect, it } from "vitest";
import { extractPdf } from "@/lib/pdf/extract";
import { isAppError } from "@/lib/utils/errors";
import { buildTestPdf } from "@/tests/helpers/buildTestPdf";

/**
 * These tests double as a small local validation path for the PDF module:
 * they build real (if minimal) PDFs entirely in memory — no fixture file, no
 * network, no external service — and run them through the actual parser.
 */
describe("extractPdf", () => {
  it("extracts text page by page, preserving order and 1-based page numbers", async () => {
    const pdf = buildTestPdf(["Hello World Page One", "Second Page Content Here"]);

    const result = await extractPdf(pdf);

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].pageNumber).toBe(1);
    expect(result.pages[0].text).toContain("Hello World Page One");
    expect(result.pages[1].pageNumber).toBe(2);
    expect(result.pages[1].text).toContain("Second Page Content Here");
  });

  it("skips pages with no meaningful text but keeps true page numbers and total pageCount", async () => {
    const pdf = buildTestPdf(["First page text", "", "Third page text"]);

    const result = await extractPdf(pdf);

    expect(result.pageCount).toBe(3);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 3]);
  });

  it("throws PDF_INVALID_INPUT for an empty buffer", async () => {
    await expect(extractPdf(Buffer.alloc(0))).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "PDF_INVALID_INPUT" && error.status === 422;
    });
  });

  it("throws PDF_UNREADABLE for a buffer that is not a PDF", async () => {
    const garbage = Buffer.from("this is definitely not a pdf file", "utf8");

    await expect(extractPdf(garbage)).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "PDF_UNREADABLE" && error.status === 422;
    });
  });

  it("throws PDF_TEXT_NOT_EXTRACTABLE when no page has usable text", async () => {
    const pdf = buildTestPdf(["", ""]);

    await expect(extractPdf(pdf)).rejects.toSatisfy((error: unknown) => {
      return isAppError(error) && error.code === "PDF_TEXT_NOT_EXTRACTABLE" && error.status === 422;
    });
  });
});
