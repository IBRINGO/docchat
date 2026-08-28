import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/utils/api-response";
import { parseDocumentListQuery } from "@/lib/validation/document-list.schema";
import { listDocuments } from "@/lib/services/document-list.service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const query = parseDocumentListQuery(searchParams);
    const result = await listDocuments(query);

    return NextResponse.json({ success: true, documents: result.documents, pagination: result.pagination });
  } catch (error) {
    return errorResponse(error, "document_list_request_failed");
  }
}
