import { describe, expect, it } from "vitest";

import { generatePurchasingBriefing } from "@/agent/purchasing-briefing";
import { FIXTURE_AS_OF, scenarioOneBaseFixture } from "@/evaluation/fixtures";
import { MemoryCaseRepository } from "@/repositories/case-repository";
import { createPurchasingCase } from "@/workflows/demo-cases";
import { PurchasingCaseService } from "@/workflows/purchasing-case-service";

describe("purchasing agent briefing", () => {
  it("runs every mandatory read plus bounded policy-selected tools without an API key", async () => {
    const purchasingCase = createPurchasingCase({
      id: "CASE-BRIEFING",
      evidence: scenarioOneBaseFixture(),
      now: FIXTURE_AS_OF,
    });

    const briefing = await generatePurchasingBriefing(purchasingCase, {
      apiKey: "",
      now: FIXTURE_AS_OF,
    });

    expect(briefing.mode).toBe("DETERMINISTIC_FALLBACK");
    expect(briefing.investigationTrace.slice(0, 8).map((item) => item.tool)).toEqual([
      "get_recommendation",
      "get_inventory_position",
      "get_demand_forecast",
      "get_open_purchase_orders",
      "get_supplier_terms",
      "get_available_budget",
      "get_storage_capacity",
      "get_product_policy",
    ]);
    expect(briefing.investigationTrace.slice(0, 8).every((item) => item.selection === "MANDATORY")).toBe(true);
    expect(briefing.investigationTrace.slice(8).map((item) => item.tool)).toEqual([
      "inspect_demand_curve",
      "inspect_inbound_schedule",
      "inspect_perishability_exposure",
    ]);
    expect(briefing.investigationTrace.slice(8).every((item) => item.selection === "POLICY_SELECTED")).toBe(true);
    expect(briefing.rejectedToolCalls).toEqual([]);
    expect(briefing.buyerAction).toContain("450 units");
  });

  it("produces a recovery briefing with recovery-specific mandatory and optional tools", async () => {
    const purchasingCase = createPurchasingCase({
      id: "CASE-RECOVERY-BRIEFING",
      evidence: scenarioOneBaseFixture(),
      now: FIXTURE_AS_OF,
    });
    const service = new PurchasingCaseService(new MemoryCaseRepository([purchasingCase]));
    await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:10:00.000Z"),
    });
    const recovered = await service.recordSupplierConfirmation({
      caseId: purchasingCase.id,
      confirmedQuantity: 300,
      now: new Date("2026-08-29T10:20:00.000Z"),
    });

    const briefing = await generatePurchasingBriefing(recovered, {
      apiKey: "",
      now: new Date("2026-08-29T10:21:00.000Z"),
    });

    expect(briefing.headline).toContain("150-unit supplier shortfall");
    expect(briefing.buyerAction).toContain("HUB-BLR-11");
    expect(briefing.investigationTrace.map((item) => item.tool)).toEqual(expect.arrayContaining([
      "get_supplier_confirmation",
      "get_recovery_budget_and_deadline",
      "inspect_alternate_suppliers",
      "inspect_network_transfers",
      "inspect_recovery_candidates",
    ]));
    expect(briefing.investigationTrace.filter((item) => item.selection === "MANDATORY")).toHaveLength(10);
  });
});
