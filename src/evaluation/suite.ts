import type { Decision, ScenarioOneEvidence } from "@/domain/purchasing";
import { FIXTURE_AS_OF, scenarioOneBaseFixture, withEvidence } from "@/evaluation/fixtures";

export interface DecisionEvaluationCase {
  name: string;
  evidence: ScenarioOneEvidence;
  expectedDecision: Decision;
  expectedQuantity: number;
}

export function scenarioOneEvaluationSuite(): DecisionEvaluationCase[] {
  const base = scenarioOneBaseFixture();
  const accepting = withEvidence(base, "recommendation", {
    value: { ...base.recommendation.value, quantity: 450 },
  });
  const covered = withEvidence(base, "inventory", {
    value: { ...base.inventory.value, onHandUnits: 1_000 },
  });
  const stale = withEvidence(base, "inventory", {
    observedAt: "2026-08-29T08:00:00.000Z",
  });
  const moqBase = scenarioOneBaseFixture();
  const moq = withEvidence(moqBase, "demand", {
    value: {
      ...moqBase.demand.value,
      expectedUnits: 510,
      safetyStockUnits: 20,
      dailyUnits: undefined,
    },
  });
  const budgetBlocked = withEvidence(base, "budget", {
    value: { ...base.budget.value, availableAmount: 10_000 },
  });
  const storageCapped = withEvidence(base, "storage", {
    value: { availableCapacityUnits: 300 },
  });
  const expiryCapped = withEvidence(base, "productPolicy", {
    value: { ...base.productPolicy.value, maxOrderUnitsBeforeExpiry: 400 },
  });

  return [
    {
      name: "modify for confirmed inbound",
      evidence: base,
      expectedDecision: "MODIFY",
      expectedQuantity: 450,
    },
    {
      name: "accept a correct recommendation",
      evidence: accepting,
      expectedDecision: "ACCEPT",
      expectedQuantity: 450,
    },
    {
      name: "reject when already covered",
      evidence: covered,
      expectedDecision: "REJECT",
      expectedQuantity: 0,
    },
    {
      name: "investigate stale inventory",
      evidence: stale,
      expectedDecision: "INVESTIGATE_FURTHER",
      expectedQuantity: 0,
    },
    {
      name: "raise a small need to MOQ",
      evidence: moq,
      expectedDecision: "MODIFY",
      expectedQuantity: 100,
    },
    {
      name: "block an unaffordable MOQ",
      evidence: budgetBlocked,
      expectedDecision: "INVESTIGATE_FURTHER",
      expectedQuantity: 0,
    },
    {
      name: "cap a purchase at available storage",
      evidence: storageCapped,
      expectedDecision: "MODIFY",
      expectedQuantity: 300,
    },
    {
      name: "cap a perishable purchase at expiry exposure",
      evidence: expiryCapped,
      expectedDecision: "MODIFY",
      expectedQuantity: 400,
    },
  ];
}

export { FIXTURE_AS_OF };
