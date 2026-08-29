import { describe, expect, it } from "vitest";

import { generatePurchasingBriefing } from "@/agent/purchasing-briefing";
import { FIXTURE_AS_OF, scenarioOneBaseFixture } from "@/evaluation/fixtures";
import { createPurchasingCase } from "@/workflows/demo-cases";

describe("purchasing agent briefing", () => {
  it("runs every required read-only evidence tool and falls back without an API key", async () => {
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
    expect(briefing.investigationTrace.map((item) => item.tool)).toEqual([
      "get_recommendation",
      "get_inventory_position",
      "get_demand_forecast",
      "get_open_purchase_orders",
      "get_supplier_terms",
      "get_available_budget",
      "get_storage_capacity",
      "get_product_policy",
    ]);
    expect(briefing.buyerAction).toContain("450 units");
  });
});
