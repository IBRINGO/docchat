import { NextResponse } from "next/server";
import { isAppError } from "@/lib/utils/errors";
import { logger } from "@/lib/utils/logger";
import { fileMissingError, validateUploadedFile } from "@/lib/validation/upload.schema";
import { DocumentIngestionService } from "@/lib/services/document-ingestion.service";

// MongoDB, OpenAI, and Gemini SDKs are all Node-only — this route cannot run on the Edge runtime.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw fileMissingError();
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    validateUploadedFile({ name: file.name, type: file.type, size: file.size }, buffer);

    const ingestionService = new DocumentIngestionService();
    const { document } = await ingestionService.ingest({
      fileName: file.name,
      mimeType: "application/pdf", // verified by validateUploadedFile's PDF signature check
      fileSize: file.size,
      buffer,
    });

    return NextResponse.json({
      success: true,
      document: {
        id: document._id.toString(),
        fileName: document.name,
        status: document.status,
        pageCount: document.pageCount,
        chunkCount: document.chunkCount,
        embeddingConfiguration:
          document.embeddingProvider && document.embeddingModel && document.embeddingDimensions
            ? {
                provider: document.embeddingProvider,
                model: document.embeddingModel,
                dimensions: document.embeddingDimensions,
              }
            : null,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function toErrorResponse(error: unknown): Response {
  if (isAppError(error)) {
    logger.warn("upload_request_failed", { code: error.code, status: error.status });
    return NextResponse.json(
      { success: false, error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  logger.error("upload_request_failed", { error });
  return NextResponse.json(
    { success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}
