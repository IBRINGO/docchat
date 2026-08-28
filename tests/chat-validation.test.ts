import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { MAX_MESSAGE_LENGTH, validateChatRequest } from "@/lib/validation/chat.schema";
import { isAppError } from "@/lib/utils/errors";

function expectInvalid(payload: unknown): void {
  let thrown: unknown;
  try {
    validateChatRequest(payload);
  } catch (error) {
    thrown = error;
  }
  expect(isAppError(thrown) && thrown.code === "INVALID_CHAT_REQUEST").toBe(true);
}

describe("validateChatRequest", () => {
  it("accepts a well-formed single-document request", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentIds: [documentId], message: "What are the objectives of the project?" });

    expect(result).toEqual({ documentIds: [documentId], message: "What are the objectives of the project?", conversationId: undefined });
  });

  it("accepts a well-formed multi-document request with a conversationId", () => {
    const documentIds = [new ObjectId().toString(), new ObjectId().toString()];
    const conversationId = new ObjectId().toString();
    const result = validateChatRequest({ documentIds, message: "Compare these documents.", conversationId });

    expect(result).toEqual({ documentIds, message: "Compare these documents.", conversationId });
  });

  it("trims surrounding whitespace from the message", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentIds: [documentId], message: "  What are the objectives?  " });

    expect(result.message).toBe("What are the objectives?");
  });

  it("normalizes duplicate document IDs instead of rejecting the request", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentIds: [documentId, documentId], message: "hello" });

    expect(result.documentIds).toEqual([documentId]);
  });

  it("preserves first-seen order when deduplicating", () => {
    const a = new ObjectId().toString();
    const b = new ObjectId().toString();
    const result = validateChatRequest({ documentIds: [a, b, a], message: "hello" });

    expect(result.documentIds).toEqual([a, b]);
  });

  it("rejects an empty documentIds array", () => {
    expectInvalid({ documentIds: [], message: "hello" });
  });

  it("rejects a missing documentIds field", () => {
    expectInvalid({ message: "hello" });
  });

  it("rejects a request with more than the maximum allowed document IDs", () => {
    const documentIds = Array.from({ length: 51 }, () => new ObjectId().toString());
    expectInvalid({ documentIds, message: "hello" });
  });

  it("rejects a documentId that is not a valid ObjectId format", () => {
    expectInvalid({ documentIds: ["not-an-object-id"], message: "hello" });
  });

  it("rejects a documentId that is the wrong length", () => {
    expectInvalid({ documentIds: ["abc123"], message: "hello" });
  });

  it("rejects if any documentId in the array is invalid, even if others are valid", () => {
    expectInvalid({ documentIds: [new ObjectId().toString(), "not-valid"], message: "hello" });
  });

  it("rejects an invalid conversationId", () => {
    expectInvalid({ documentIds: [new ObjectId().toString()], message: "hello", conversationId: "not-valid" });
  });

  it("accepts a request without a conversationId (new conversation)", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentIds: [documentId], message: "hello" });
    expect(result.conversationId).toBeUndefined();
  });

  it("rejects a missing message", () => {
    expectInvalid({ documentIds: [new ObjectId().toString()] });
  });

  it("rejects an empty message", () => {
    expectInvalid({ documentIds: [new ObjectId().toString()], message: "" });
  });

  it("rejects a whitespace-only message", () => {
    expectInvalid({ documentIds: [new ObjectId().toString()], message: "   \n\t  " });
  });

  it("rejects a message exceeding the maximum length", () => {
    expectInvalid({ documentIds: [new ObjectId().toString()], message: "a".repeat(MAX_MESSAGE_LENGTH + 1) });
  });

  it("rejects a non-object payload", () => {
    expectInvalid(null);
    expectInvalid("just a string");
    expectInvalid(42);
  });
});
