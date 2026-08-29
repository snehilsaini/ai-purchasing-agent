import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

const recoveryChangeSchema = z.object({
  sourceNodeId: z.string().min(1),
  availableUnits: z.number().int().nonnegative().max(100_000),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const [{ caseId }, body] = await Promise.all([context.params, request.json()]);
    const change = recoveryChangeSchema.parse(body);
    const purchasingCase = await getPurchasingCaseService().simulateRecoveryAvailabilityChange({
      caseId,
      ...change,
    });
    return NextResponse.json({ case: purchasingCase });
  } catch (error) {
    return apiError(error);
  }
}
