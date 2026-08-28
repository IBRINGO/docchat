import { describe, expect, it } from "vitest";
import { validateFileClientSide } from "@/lib/validation/upload-client";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/validation/upload.schema";

describe("validateFileClientSide", () => {
  it("accepts a PDF within the size limit", () => {
    expect(validateFileClientSide({ name: "report.pdf", size: 1024 })).toEqual({ valid: true });
  });

  it("accepts .PDF with any casing", () => {
    expect(validateFileClientSide({ name: "Report.PDF", size: 1024 }).valid).toBe(true);
  });

  it("rejects a non-PDF file", () => {
    const result = validateFileClientSide({ name: "report.docx", size: 1024 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/PDF/);
  });

  it("rejects an empty file", () => {
    const result = validateFileClientSide({ name: "report.pdf", size: 0 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateFileClientSide({ name: "report.pdf", size: MAX_UPLOAD_SIZE_BYTES }).valid).toBe(true);
  });

  it("rejects a file one byte over the size limit, using the centralized limit (not a duplicated literal)", () => {
    const result = validateFileClientSide({ name: "report.pdf", size: MAX_UPLOAD_SIZE_BYTES + 1 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/maximum allowed size/);
  });
});
