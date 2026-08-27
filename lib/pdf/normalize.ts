// Matches control/null characters that carry no meaningful text. Built from
// an escaped string (rather than a regex literal) to keep raw control bytes
// out of the source file. Deliberately excludes \t (0009), \n (000A) and \r
// (000D), which are handled separately below, and leaves every printable
// Unicode character — including accented Latin and Arabic script — untouched.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

/**
 * Conservatively cleans text extracted from a PDF page: normalizes line
 * endings, strips non-printing control characters, collapses runs of
 * whitespace, and trims. It never transliterates, lowercases, or strips
 * punctuation — the goal is retrieval quality, not cosmetic perfection.
 */
export function normalizeExtractedText(text: string): string {
  if (!text) return "";

  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
