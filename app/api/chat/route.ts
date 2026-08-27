import { NextResponse } from "next/server";
import { AppError } from "@/lib/utils/errors";

export async function POST(): Promise<Response> {
  const error = new AppError({
    code: "NOT_IMPLEMENTED",
    message: "Chat is not implemented yet.",
    status: 501,
  });

  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );
}
