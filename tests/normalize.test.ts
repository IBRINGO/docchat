import { describe, expect, it } from "vitest";
import { normalizeExtractedText } from "@/lib/pdf/normalize";

describe("normalizeExtractedText", () => {
  it("collapses excessive spaces", () => {
    expect(normalizeExtractedText("Hello     World")).toBe("Hello World");
  });

  it("collapses excessive blank lines while keeping a single paragraph break", () => {
    const input = "Paragraph one.\n\n\n\n\nParagraph two.";
    expect(normalizeExtractedText(input)).toBe("Paragraph one.\n\nParagraph two.");
  });

  it("normalizes CRLF and CR line endings to LF", () => {
    expect(normalizeExtractedText("Line one\r\nLine two\rLine three")).toBe(
      "Line one\nLine two\nLine three",
    );
  });

  it("strips non-printing control characters", () => {
    const nullChar = String.fromCharCode(0);
    const verticalTab = String.fromCharCode(11);
    const withControlChars = `Hello${nullChar} ${verticalTab}World`;
    expect(normalizeExtractedText(withControlChars)).toBe("Hello World");
  });

  it("preserves French accented characters", () => {
    const french = "L'intelligence artificielle améliore la recherche documentaire.";
    expect(normalizeExtractedText(french)).toBe(french);
  });

  it("preserves Arabic characters", () => {
    const arabic = "الذكاء الاصطناعي يساعد على تحليل المستندات.";
    expect(normalizeExtractedText(arabic)).toBe(arabic);
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeExtractedText("   padded text   ")).toBe("padded text");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeExtractedText("   \n\n\t  \n  ")).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeExtractedText("")).toBe("");
  });

  it("does not lowercase or strip punctuation", () => {
    const input = "DocChat: Ask Questions, Get Answers!";
    expect(normalizeExtractedText(input)).toBe(input);
  });
});
