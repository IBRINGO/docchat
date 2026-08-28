import { describe, expect, it } from "vitest";
import { parseConversationListQuery } from "@/lib/validation/conversation-list.schema";
import { isAppError } from "@/lib/utils/errors";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

function expectInvalid(searchParams: URLSearchParams): void {
  let thrown: unknown;
  try {
    parseConversationListQuery(searchParams);
  } catch (error) {
    thrown = error;
  }
  expect(isAppError(thrown) && thrown.code === "INVALID_CONVERSATION_LIST_REQUEST").toBe(true);
}

describe("parseConversationListQuery", () => {
  it("defaults page and limit when absent", () => {
    expect(parseConversationListQuery(params({}))).toEqual({ page: 1, limit: 20 });
  });

  it("parses page and limit when provided", () => {
    expect(parseConversationListQuery(params({ page: "2", limit: "10" }))).toEqual({ page: 2, limit: 10 });
  });

  it("rejects page below 1", () => {
    expectInvalid(params({ page: "0" }));
  });

  it("rejects limit above the maximum", () => {
    expectInvalid(params({ limit: "101" }));
  });

  it("rejects a non-numeric page or limit", () => {
    expectInvalid(params({ page: "abc" }));
    expectInvalid(params({ limit: "abc" }));
  });
});
