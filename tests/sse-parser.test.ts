import { describe, expect, it } from "vitest";
import { parseSseBuffer } from "@/lib/client/sse";

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("parseSseBuffer", () => {
  it("parses a metadata event", () => {
    const { events, remainder } = parseSseBuffer(frame("metadata", { documentId: "doc-1", sources: [] }));

    expect(events).toEqual([{ type: "metadata", data: { documentId: "doc-1", sources: [] } }]);
    expect(remainder).toBe("");
  });

  it("parses a delta event", () => {
    const { events } = parseSseBuffer(frame("delta", { text: "Hello" }));
    expect(events).toEqual([{ type: "delta", data: { text: "Hello" } }]);
  });

  it("parses a done event", () => {
    const { events } = parseSseBuffer(frame("done", {}));
    expect(events).toEqual([{ type: "done", data: {} }]);
  });

  it("parses multiple events accumulated in one buffer, in order", () => {
    const buffer = frame("metadata", { sources: [] }) + frame("delta", { text: "a" }) + frame("delta", { text: "b" }) + frame("done", {});
    const { events, remainder } = parseSseBuffer(buffer);

    expect(events.map((e) => e.type)).toEqual(["metadata", "delta", "delta", "done"]);
    expect(remainder).toBe("");
  });

  it("holds back an incomplete trailing frame as the remainder", () => {
    const complete = frame("delta", { text: "a" });
    const incomplete = "event: delta\ndata: {\"tex";
    const { events, remainder } = parseSseBuffer(complete + incomplete);

    expect(events).toEqual([{ type: "delta", data: { text: "a" } }]);
    expect(remainder).toBe(incomplete);
  });

  it("recombines a remainder with the next chunk into a complete event", () => {
    const first = parseSseBuffer("event: delta\ndata: {\"tex");
    expect(first.events).toEqual([]);

    const second = parseSseBuffer(`${first.remainder}t\":\"hello\"}\n\n`);
    expect(second.events).toEqual([{ type: "delta", data: { text: "hello" } }]);
  });

  it("surfaces malformed JSON as a synthetic error event instead of throwing", () => {
    const buffer = "event: delta\ndata: {not valid json\n\n";
    const { events } = parseSseBuffer(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].data).toMatchObject({ code: "MALFORMED_STREAM_EVENT" });
  });

  it("one malformed frame does not prevent well-formed frames around it from parsing", () => {
    const buffer = frame("delta", { text: "before" }) + "event: delta\ndata: {broken\n\n" + frame("delta", { text: "after" });
    const { events } = parseSseBuffer(buffer);

    expect(events.map((e) => e.type)).toEqual(["delta", "error", "delta"]);
    expect(events[0].data).toEqual({ text: "before" });
    expect(events[2].data).toEqual({ text: "after" });
  });

  it("ignores blank blocks (e.g. leading/trailing separators)", () => {
    const { events } = parseSseBuffer(`\n\n${frame("done", {})}`);
    expect(events).toEqual([{ type: "done", data: {} }]);
  });

  it("returns no events for an empty buffer", () => {
    const { events, remainder } = parseSseBuffer("");
    expect(events).toEqual([]);
    expect(remainder).toBe("");
  });
});
