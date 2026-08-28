export interface SseEvent {
  type: string;
  data: unknown;
}

export interface ParseSseBufferResult {
  events: SseEvent[];
  /** Trailing, not-yet-complete text — feed back in with the next chunk. */
  remainder: string;
}

/**
 * Parses complete `event: X\ndata: Y\n\n` frames out of a growing text
 * buffer. Pure and network-free by design: SSE frames can arrive split
 * across separate reads of the response body, so callers accumulate raw
 * text and call this repeatedly, keeping `remainder` for the next call.
 * A frame whose data isn't valid JSON is surfaced as a synthetic "error"
 * event rather than thrown, so one malformed frame can't crash the reader
 * loop consuming the stream.
 */
export function parseSseBuffer(buffer: string): ParseSseBufferResult {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;

    let type = "message";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        type = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLine += line.slice("data:".length).trim();
      }
    }

    if (!dataLine) continue;

    try {
      events.push({ type, data: JSON.parse(dataLine) });
    } catch {
      events.push({
        type: "error",
        data: { code: "MALFORMED_STREAM_EVENT", message: "Received a malformed event from the server." },
      });
    }
  }

  return { events, remainder };
}
