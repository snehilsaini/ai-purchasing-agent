import { NextResponse } from "next/server";

import { generatePurchasingBriefing } from "@/agent/purchasing-briefing";
import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

export async function POST(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const { caseId } = await context.params;
    const purchasingCase = await getPurchasingCaseService().getCase(caseId);
    const briefing = await generatePurchasingBriefing(purchasingCase);
    return NextResponse.json({ briefing });
  } catch (error) {
    return apiError(error);
  }
}
