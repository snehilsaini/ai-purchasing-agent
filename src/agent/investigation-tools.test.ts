import { describe, expect, it } from "vitest";

import {
  executeOptionalToolCalls,
  policySelectedOptionalCalls,
  runMandatoryInvestigation,
} from "@/agent/investigation-tools";
import { FIXTURE_AS_OF, scenarioOneBaseFixture, withEvidence } from "@/evaluation/fixtures";
import { createPurchasingCase } from "@/workflows/demo-cases";

function testCase() {
  return createPurchasingCase({
    id: "CASE-TOOLS",
    evidence: scenarioOneBaseFixture(),
    now: FIXTURE_AS_OF,
  });
}

describe("bounded investigation tools", () => {
  it("always runs the complete mandatory evidence gate", () => {
    const results = runMandatoryInvestigation(testCase());

    expect(results).toHaveLength(8);
    expect(results.every((result) => result.selection === "MANDATORY")).toBe(true);
    expect(results.map((result) => result.tool)).toContain("get_available_budget");
    expect(results.map((result) => result.tool)).toContain("get_product_policy");
  });

  it("uses case signals to select different optional tools in fallback mode", () => {
    const baseline = testCase();
    const minimalEvidence = withEvidence(
      withEvidence(
        withEvidence(scenarioOneBaseFixture(), "demand", {
          value: {
            ...scenarioOneBaseFixture().demand.value,
            dailyUnits: undefined,
            forecastConfidence: 0.95,
          },
        }),
        "openPurchaseOrders",
        { value: [] },
      ),
      "productPolicy",
      { value: {} },
    );
    const minimal = createPurchasingCase({
      id: "CASE-MINIMAL",
      evidence: minimalEvidence,
      now: FIXTURE_AS_OF,
    });

    expect(policySelectedOptionalCalls(baseline).map((call) => call.name)).toEqual([
      "inspect_demand_curve",
      "inspect_inbound_schedule",
      "inspect_perishability_exposure",
    ]);
    expect(policySelectedOptionalCalls(minimal).map((call) => call.name)).toEqual([
      "inspect_supplier_risk",
    ]);
  });

  it("executes valid model-selected reads and records their rationale", () => {
    const purchasingCase = testCase();
    const investigation = executeOptionalToolCalls(purchasingCase, [{
      name: "inspect_supplier_risk",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Supplier reliability could change fulfilment confidence.",
      }),
    }], "MODEL_SELECTED");

    expect(investigation.rejectedCalls).toEqual([]);
    expect(investigation.results).toHaveLength(1);
    expect(investigation.results[0]).toMatchObject({
      tool: "inspect_supplier_risk",
      selection: "MODEL_SELECTED",
      source: "supplier-service",
      rationale: "Supplier reliability could change fulfilment confidence.",
    });
  });

  it("rejects unknown, malformed, mismatched, duplicate, and over-limit calls", () => {
    const purchasingCase = testCase();
    const validArguments = JSON.stringify({
      caseId: purchasingCase.id,
      rationale: "Relevant additional evidence.",
    });
    const investigation = executeOptionalToolCalls(purchasingCase, [
      { name: "write_purchase_order", arguments: validArguments },
      { name: "inspect_demand_curve", arguments: "{" },
      {
        name: "inspect_inbound_schedule",
        arguments: JSON.stringify({ caseId: "WRONG-CASE", rationale: "Wrong target." }),
      },
      { name: "inspect_supplier_risk", arguments: validArguments },
      { name: "inspect_perishability_exposure", arguments: validArguments },
    ], "MODEL_SELECTED");

    expect(investigation.results.map((result) => result.tool)).toEqual(["inspect_supplier_risk"]);
    expect(investigation.rejectedCalls).toHaveLength(4);
    expect(investigation.rejectedCalls.join(" ")).toContain("approved read-only registry");
    expect(investigation.rejectedCalls.join(" ")).toContain("not valid JSON");
    expect(investigation.rejectedCalls.join(" ")).toContain("failed validation");
    expect(investigation.rejectedCalls.join(" ")).toContain("tool-call limit exceeded");
  });

  it("rejects recovery-only tools outside a supplier-shortfall event", () => {
    const purchasingCase = testCase();
    const investigation = executeOptionalToolCalls(purchasingCase, [{
      name: "inspect_network_transfers",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Look for nearby stock.",
      }),
    }], "MODEL_SELECTED");

    expect(investigation.results).toEqual([]);
    expect(investigation.rejectedCalls[0]).toContain("not available for this event type");
  });
});
