import { NextResponse } from "next/server";

import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const { caseId } = await context.params;
    return NextResponse.json({ case: await getPurchasingCaseService().getCase(caseId) });
  } catch (error) {
    return apiError(error);
  }
}
