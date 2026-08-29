import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

const recoveryApprovalSchema = z.object({
  proposalVersion: z.number().int().positive(),
  buyerId: z.string().min(1).max(120),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const [{ caseId }, body] = await Promise.all([context.params, request.json()]);
    const approval = recoveryApprovalSchema.parse(body);
    const purchasingCase = await getPurchasingCaseService().approveRecovery({
      caseId,
      ...approval,
    });
    return NextResponse.json({ case: purchasingCase });
  } catch (error) {
    return apiError(error);
  }
}
