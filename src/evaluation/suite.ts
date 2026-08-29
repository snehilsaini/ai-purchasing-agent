import type {
  Decision,
  PurchasingCase,
  ScenarioOneEvidence,
  SupplierShortfallEvidence,
} from "@/domain/purchasing";
import { FIXTURE_AS_OF, scenarioOneBaseFixture, withEvidence } from "@/evaluation/fixtures";
import { createPurchasingCase } from "@/workflows/demo-cases";
import { supplierShortfallFixture } from "@/workflows/supplier-shortfall-fixtures";

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

export interface RecoveryEvaluationCase {
  name: string;
  evidence: SupplierShortfallEvidence;
  expectedCandidateId: string | null;
}

export function scenarioTwoEvaluationSuite(): {
  purchasingCase: PurchasingCase;
  evaluations: RecoveryEvaluationCase[];
} {
  const purchasingCase = createPurchasingCase({
    id: "CASE-RECOVERY-EVAL",
    evidence: scenarioOneBaseFixture(),
    now: FIXTURE_AS_OF,
  });
  purchasingCase.purchaseOrder = {
    purchaseOrderId: "PO-RECOVERY-EVAL",
    idempotencyKey: "original-order",
    createdAt: FIXTURE_AS_OF.toISOString(),
    status: "PARTIALLY_CONFIRMED",
    requested: purchasingCase.proposal!.action,
    confirmedQuantity: 300,
    confirmedDeliveryDate: purchasingCase.proposal!.action.expectedDeliveryDate,
  };

  const base = supplierShortfallFixture(FIXTURE_AS_OF);
  const transferUnavailable = structuredClone(base);
  transferUnavailable.transferOptions.value[1].availableUnits = 0;
  const infeasible = structuredClone(base);
  infeasible.transferOptions.value = infeasible.transferOptions.value.map((option) => ({
    ...option,
    availableUnits: 25,
    transferLeadTimeDays: 5,
  }));
  infeasible.alternateSuppliers.value = infeasible.alternateSuppliers.value.map((supplier) => ({
    ...supplier,
    leadTimeDays: 5,
    availableCapacityUnits: 25,
  }));

  return {
    purchasingCase,
    evaluations: [
      {
        name: "prefer a full low-risk network transfer",
        evidence: base,
        expectedCandidateId: "transfer:HUB-BLR-11",
      },
      {
        name: "switch to split recovery when the preferred hub is unavailable",
        evidence: transferUnavailable,
        expectedCandidateId: "split:HUB-BLR-03:SUP-SWIFT",
      },
      {
        name: "escalate when all recovery options are late or under-covered",
        evidence: infeasible,
        expectedCandidateId: null,
      },
    ],
  };
}

export { FIXTURE_AS_OF };
