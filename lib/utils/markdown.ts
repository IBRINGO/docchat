/**
 * Strips common Markdown syntax down to readable plain text, for the
 * "copy answer" action (components/chat/ChatMessage.tsx) — a user pasting a
 * copied answer elsewhere should get the words, not literal `**`/`#`/backtick
 * characters. This is intentionally a small regex-based pass, not a full
 * Markdown parser: the assistant's answers use a bounded set of constructs
 * (paragraphs, emphasis, headings, lists, inline/fenced code — see
 * components/chat/MarkdownMessage.tsx, the actual renderer used on screen),
 * and this only needs to produce readable text for that set, not round-trip
 * arbitrary Markdown.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, (_match, code: string) => code.trim())
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(?<![a-zA-Z0-9])_([^_\n]+)_(?![a-zA-Z0-9])/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*(\d+)\.\s+/gm, "$1. ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
