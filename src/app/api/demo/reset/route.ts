import { NextResponse } from "next/server";

import { getPurchasingCaseService, resetDemoCases } from "@/workflows/service-container";

export async function POST() {
  await resetDemoCases();
  return NextResponse.json({ cases: await getPurchasingCaseService().listCases() });
}
