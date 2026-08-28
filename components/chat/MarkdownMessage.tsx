"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownMessageProps {
  content: string;
}

/**
 * Renders an assistant answer's Markdown as real typography instead of raw
 * `**`/`#`/`*` characters. react-markdown parses to a React element tree
 * (never `dangerouslySetInnerHTML`) and, without the rehype-raw plugin
 * (deliberately not added), any literal HTML in the model's output is
 * rendered as inert text rather than executed — safe by default against a
 * model that echoes or is prompted to emit HTML/script content.
 *
 * Streaming-safe: the full accumulated answer is re-parsed on every render,
 * so a partially-arrived construct (e.g. an unclosed "**") just renders
 * literally for the instant before the closing marker arrives, then
 * self-corrects — no special partial-Markdown handling is needed.
 */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
