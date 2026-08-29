import { describe, expect, it } from "vitest";

import { FIXTURE_AS_OF, scenarioOneBaseFixture, withEvidence } from "@/evaluation/fixtures";
import { analyzeScenarioOne } from "@/workflows/analyze-scenario-one";

describe("Scenario 1 purchasing analysis", () => {
  it("modifies 800 units to 450 after accounting for usable inventory and confirmed inbound", () => {
    const result = analyzeScenarioOne(scenarioOneBaseFixture(), FIXTURE_AS_OF);

    expect(result.decision.decision).toBe("MODIFY");
    expect(result.decision.recommendedQuantity).toBe(450);
    expect(result.plan).toMatchObject({
      usableOnHandUnits: 200,
      confirmedInboundUnits: 300,
      targetInventoryUnits: 950,
      rawRequirementUnits: 450,
      recommendedOrderUnits: 450,
      orderCost: 54_000,
      projectedEndingUnits: 50,
    });
  });

  it("accepts a recommendation that matches the independently calculated quantity", () => {
    const base = scenarioOneBaseFixture();
    const evidence = withEvidence(base, "recommendation", {
      value: { ...base.recommendation.value, quantity: 450 },
    });

    expect(analyzeScenarioOne(evidence, FIXTURE_AS_OF).decision.decision).toBe("ACCEPT");
  });

  it("rejects a purchase when inventory and inbound already cover the target", () => {
    const base = scenarioOneBaseFixture();
    const evidence = withEvidence(base, "inventory", {
      value: { ...base.inventory.value, onHandUnits: 1_000 },
    });

    const result = analyzeScenarioOne(evidence, FIXTURE_AS_OF);
    expect(result.decision.decision).toBe("REJECT");
    expect(result.decision.proposedAction).toBeNull();
  });

  it("investigates further when critical evidence is stale", () => {
    const evidence = withEvidence(scenarioOneBaseFixture(), "inventory", {
      observedAt: "2026-08-29T08:00:00.000Z",
    });

    const result = analyzeScenarioOne(evidence, FIXTURE_AS_OF);
    expect(result.decision.decision).toBe("INVESTIGATE_FURTHER");
    expect(result.decision.evidenceIssues[0]).toMatchObject({
      key: "inventory",
      reason: "STALE",
    });
  });

  it("adjusts to the order multiple and MOQ", () => {
    const base = scenarioOneBaseFixture();
    const evidence = withEvidence(base, "demand", {
      value: {
        ...base.demand.value,
        expectedUnits: 510,
        safetyStockUnits: 20,
        dailyUnits: undefined,
      },
    });

    const result = analyzeScenarioOne(evidence, FIXTURE_AS_OF);
    expect(result.plan?.rawRequirementUnits).toBe(30);
    expect(result.decision.recommendedQuantity).toBe(100);
  });

  it("returns investigate further when budget cannot fund the MOQ", () => {
    const base = scenarioOneBaseFixture();
    const evidence = withEvidence(base, "budget", {
      value: { ...base.budget.value, availableAmount: 10_000 },
    });

    const result = analyzeScenarioOne(evidence, FIXTURE_AS_OF);
    expect(result.decision.decision).toBe("INVESTIGATE_FURTHER");
    expect(result.plan?.recommendedOrderUnits).toBe(0);
    expect(result.plan?.constraints.find((item) => item.code === "BUDGET")?.status).toBe("BLOCKED");
  });
});
