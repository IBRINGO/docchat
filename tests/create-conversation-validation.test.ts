import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { MAX_DOCUMENT_IDS_PER_REQUEST } from "@/lib/validation/chat.schema";
import { validateCreateConversationRequest } from "@/lib/validation/create-conversation.schema";
import { isAppError } from "@/lib/utils/errors";

function expectInvalid(payload: unknown): void {
  let thrown: unknown;
  try {
    validateCreateConversationRequest(payload);
  } catch (error) {
    thrown = error;
  }
  expect(isAppError(thrown) && thrown.code === "INVALID_CREATE_CONVERSATION_REQUEST").toBe(true);
}

describe("validateCreateConversationRequest", () => {
  it("accepts a single valid document ID", () => {
    const documentId = new ObjectId().toString();
    expect(validateCreateConversationRequest({ documentIds: [documentId] })).toEqual({ documentIds: [documentId] });
  });

  it("accepts multiple valid document IDs", () => {
    const documentIds = [new ObjectId().toString(), new ObjectId().toString(), new ObjectId().toString()];
    expect(validateCreateConversationRequest({ documentIds })).toEqual({ documentIds });
  });

  it("rejects an empty documentIds array", () => {
    expectInvalid({ documentIds: [] });
  });

  it("rejects a missing documentIds field", () => {
    expectInvalid({});
  });

  it("rejects a request with more than the maximum allowed number of document IDs", () => {
    const documentIds = Array.from({ length: MAX_DOCUMENT_IDS_PER_REQUEST + 1 }, () => new ObjectId().toString());
    expectInvalid({ documentIds });
  });

  it("rejects an invalid ObjectId string", () => {
    expectInvalid({ documentIds: ["not-an-object-id"] });
  });

  it("rejects a request where one of several IDs is invalid", () => {
    expectInvalid({ documentIds: [new ObjectId().toString(), "not-valid"] });
  });

  it("rejects a non-array documentIds", () => {
    expectInvalid({ documentIds: "not-an-array" });
  });

  it(
    "deduplicates duplicate document IDs rather than rejecting the request — matches the same " +
      "convention as chat.schema.ts (an accidental repeat isn't a meaningfully different request)",
    () => {
      const documentId = new ObjectId().toString();
      const result = validateCreateConversationRequest({ documentIds: [documentId, documentId] });
      expect(result.documentIds).toEqual([documentId]);
    },
  );

  it("preserves first-seen order while deduplicating", () => {
    const a = new ObjectId().toString();
    const b = new ObjectId().toString();
    const result = validateCreateConversationRequest({ documentIds: [a, b, a] });
    expect(result.documentIds).toEqual([a, b]);
  });
});
