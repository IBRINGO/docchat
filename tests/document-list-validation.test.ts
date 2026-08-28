import { describe, expect, it } from "vitest";
import { parseDocumentListQuery } from "@/lib/validation/document-list.schema";
import { isAppError } from "@/lib/utils/errors";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

function expectInvalid(searchParams: URLSearchParams): void {
  let thrown: unknown;
  try {
    parseDocumentListQuery(searchParams);
  } catch (error) {
    thrown = error;
  }
  expect(isAppError(thrown) && thrown.code === "INVALID_DOCUMENT_LIST_REQUEST").toBe(true);
}

describe("parseDocumentListQuery", () => {
  it("defaults page and limit when absent", () => {
    const result = parseDocumentListQuery(params({}));
    expect(result).toEqual({ q: undefined, status: undefined, page: 1, limit: 20 });
  });

  it("parses q, status, page, and limit when provided", () => {
    const result = parseDocumentListQuery(params({ q: "report", status: "ready", page: "2", limit: "10" }));
    expect(result).toEqual({ q: "report", status: "ready", page: 2, limit: 10 });
  });

  it("treats a blank q as absent rather than a validation error", () => {
    const result = parseDocumentListQuery(params({ q: "   " }));
    expect(result.q).toBeUndefined();
  });

  it("rejects an unknown status value", () => {
    expectInvalid(params({ status: "archived" }));
  });

  it("rejects page below 1", () => {
    expectInvalid(params({ page: "0" }));
  });

  it("rejects a non-integer page", () => {
    expectInvalid(params({ page: "1.5" }));
  });

  it("rejects limit above the maximum", () => {
    expectInvalid(params({ limit: "101" }));
  });

  it("rejects limit below 1", () => {
    expectInvalid(params({ limit: "0" }));
  });

  it("rejects a non-numeric page or limit", () => {
    expectInvalid(params({ page: "abc" }));
    expectInvalid(params({ limit: "abc" }));
  });

  it("rejects a search query longer than 200 characters", () => {
    expectInvalid(params({ q: "a".repeat(201) }));
  });

  it("accepts each valid status value", () => {
    for (const status of ["processing", "ready", "failed"]) {
      expect(parseDocumentListQuery(params({ status })).status).toBe(status);
    }
  });
});
