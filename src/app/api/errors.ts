import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { WorkflowError } from "@/workflows/purchasing-case-service";

export function apiError(error: unknown): NextResponse {
  if (error instanceof WorkflowError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: error.issues[0]?.message ?? "Invalid request." } },
      { status: 400 },
    );
  }

  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } },
    { status: 500 },
  );
}
