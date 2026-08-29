import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/app/api/errors";
import { getPurchasingCaseService } from "@/workflows/service-container";

const confirmationSchema = z.object({
  confirmedQuantity: z.number().int().nonnegative(),
  confirmedDeliveryDate: z.string().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const [{ caseId }, body] = await Promise.all([context.params, request.json()]);
    const confirmation = confirmationSchema.parse(body);
    const purchasingCase = await getPurchasingCaseService().recordSupplierConfirmation({
      caseId,
      ...confirmation,
    });
    return NextResponse.json({ case: purchasingCase });
  } catch (error) {
    return apiError(error);
  }
}
