import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_SIZE_BYTES, validateUploadedFile } from "@/lib/validation/upload.schema";
import { isAppError } from "@/lib/utils/errors";

const validPdfBuffer = Buffer.from("%PDF-1.4\n%some pdf bytes here", "ascii");

function codeOf(fn: () => void): string {
  try {
    fn();
    throw new Error("expected validateUploadedFile to throw");
  } catch (error) {
    if (!isAppError(error)) throw error;
    return error.code;
  }
}

describe("validateUploadedFile", () => {
  it("accepts a valid PDF", () => {
    expect(() =>
      validateUploadedFile({ name: "doc.pdf", type: "application/pdf", size: validPdfBuffer.length }, validPdfBuffer),
    ).not.toThrow();
  });

  it("rejects a missing/empty file", () => {
    const code = codeOf(() => validateUploadedFile({ name: "doc.pdf", type: "application/pdf", size: 0 }, Buffer.alloc(0)));
    expect(code).toBe("FILE_MISSING");
  });

  it("rejects an oversized file", () => {
    const code = codeOf(() =>
      validateUploadedFile(
        { name: "doc.pdf", type: "application/pdf", size: MAX_UPLOAD_SIZE_BYTES + 1 },
        validPdfBuffer,
      ),
    );
    expect(code).toBe("FILE_TOO_LARGE");
  });

  it("rejects an invalid MIME type", () => {
    const code = codeOf(() =>
      validateUploadedFile({ name: "doc.pdf", type: "image/png", size: validPdfBuffer.length }, validPdfBuffer),
    );
    expect(code).toBe("INVALID_FILE_TYPE");
  });

  it("rejects an invalid file extension even with a valid MIME type", () => {
    const code = codeOf(() =>
      validateUploadedFile({ name: "doc.txt", type: "application/pdf", size: validPdfBuffer.length }, validPdfBuffer),
    );
    expect(code).toBe("INVALID_FILE_TYPE");
  });

  it("rejects content that fails the PDF magic-byte signature check despite a valid name/type", () => {
    const fakeBuffer = Buffer.from("this is not really a pdf", "utf8");
    const code = codeOf(() =>
      validateUploadedFile({ name: "doc.pdf", type: "application/pdf", size: fakeBuffer.length }, fakeBuffer),
    );
    expect(code).toBe("INVALID_PDF_FILE");
  });

  it("checks size before content, so a spoofed size still gets caught deterministically", () => {
    // metadata.size can lie (it's client-reported), but our own limit check runs first regardless of buffer content.
    const code = codeOf(() =>
      validateUploadedFile({ name: "doc.pdf", type: "application/pdf", size: MAX_UPLOAD_SIZE_BYTES + 1 }, validPdfBuffer),
    );
    expect(code).toBe("FILE_TOO_LARGE");
  });
});
