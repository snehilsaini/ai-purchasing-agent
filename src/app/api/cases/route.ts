import { NextResponse } from "next/server";

import { getPurchasingCaseService } from "@/workflows/service-container";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ cases: await getPurchasingCaseService().listCases() });
}
