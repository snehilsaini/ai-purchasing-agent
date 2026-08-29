import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

const changeSchema = z.object({
  onHandDelta: z.number().int().min(-10_000).max(10_000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const [{ caseId }, body] = await Promise.all([context.params, request.json()]);
    const change = changeSchema.parse(body);
    const purchasingCase = await getPurchasingCaseService().simulateInventoryChange({ caseId, ...change });
    return NextResponse.json({ case: purchasingCase });
  } catch (error) {
    return apiError(error);
  }
}
