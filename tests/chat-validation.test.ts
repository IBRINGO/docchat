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
  it("accepts a well-formed request", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentId, message: "What are the objectives of the project?" });

    expect(result).toEqual({ documentId, message: "What are the objectives of the project?" });
  });

  it("trims surrounding whitespace from the message", () => {
    const documentId = new ObjectId().toString();
    const result = validateChatRequest({ documentId, message: "  What are the objectives?  " });

    expect(result.message).toBe("What are the objectives?");
  });

  it("rejects a documentId that is not a valid ObjectId format", () => {
    expectInvalid({ documentId: "not-an-object-id", message: "hello" });
  });

  it("rejects a documentId that is the wrong length", () => {
    expectInvalid({ documentId: "abc123", message: "hello" });
  });

  it("rejects a missing message", () => {
    expectInvalid({ documentId: new ObjectId().toString() });
  });

  it("rejects an empty message", () => {
    expectInvalid({ documentId: new ObjectId().toString(), message: "" });
  });

  it("rejects a whitespace-only message", () => {
    expectInvalid({ documentId: new ObjectId().toString(), message: "   \n\t  " });
  });

  it("rejects a message exceeding the maximum length", () => {
    expectInvalid({ documentId: new ObjectId().toString(), message: "a".repeat(MAX_MESSAGE_LENGTH + 1) });
  });

  it("rejects a non-object payload", () => {
    expectInvalid(null);
    expectInvalid("just a string");
    expectInvalid(42);
  });
});
