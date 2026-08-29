import type {
  PurchasingDecision,
  ScenarioAnalysis,
  ScenarioOneEvidence,
} from "@/domain/purchasing";
import { evaluateEvidence } from "@/policies/evidence-freshness";
import { calculatePurchasePlan } from "@/planning/purchase-plan";

function addUtcDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

function confidenceFor(evidence: ScenarioOneEvidence): PurchasingDecision["confidence"] {
  if (
    evidence.demand.value.forecastConfidence >= 0.8
    && evidence.supplier.value.deliveryReliability >= 0.9
  ) {
    return "HIGH";
  }

  if (
    evidence.demand.value.forecastConfidence >= 0.6
    && evidence.supplier.value.deliveryReliability >= 0.7
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

export function analyzeScenarioOne(
  evidence: ScenarioOneEvidence,
  asOf: Date,
): ScenarioAnalysis {
  const originalQuantity = evidence.recommendation.value.quantity;
  const evidenceIssues = evaluateEvidence(evidence, asOf);

  if (evidenceIssues.length > 0) {
    return {
      plan: null,
      decision: {
        decision: "INVESTIGATE_FURTHER",
        originalQuantity,
        recommendedQuantity: 0,
        confidence: "LOW",
        summary: "A safe purchasing decision cannot be made until critical evidence is refreshed.",
        importantFactors: evidenceIssues.map((issue) => `${issue.key}: ${issue.detail}`),
        evidenceIssues,
        proposedAction: null,
        requiresApproval: false,
      },
    };
  }

  const plan = calculatePurchasePlan(evidence, asOf);
  const recommendedQuantity = plan.recommendedOrderUnits;
  const importantFactors = [
    `${plan.confirmedInboundUnits} confirmed units are already due within the protection period.`,
    `${plan.rawRequirementUnits} units are required before supplier and operational constraints.`,
    `${recommendedQuantity} units leaves a projected ending balance of ${Math.round(plan.projectedEndingUnits)} units.`,
  ];

  if (plan.baselineStockoutDate) {
    importantFactors.push(`Without action, inventory is projected to fall below zero on ${plan.baselineStockoutDate}.`);
  }

  if (plan.proposedStockoutDate) {
    importantFactors.push(`Even after this order, a temporary stockout remains on ${plan.proposedStockoutDate}.`);
  }

  if (plan.residualShortageUnits > 0) {
    importantFactors.push(`${plan.residualShortageUnits} units remain uncovered because of binding constraints.`);
  }

  const adjustedConstraints = plan.constraints.filter((constraint) => constraint.status !== "PASS");
  if (adjustedConstraints.length === 0) {
    importantFactors.push("MOQ, order multiple, budget, storage, capacity, and shelf-life checks pass.");
  } else {
    importantFactors.push(...adjustedConstraints.map((constraint) => constraint.detail));
  }

  if (plan.rawRequirementUnits === 0) {
    return {
      plan,
      decision: {
        decision: "REJECT",
        originalQuantity,
        recommendedQuantity: 0,
        confidence: confidenceFor(evidence),
        summary: "Do not place another order; available and confirmed inbound inventory already cover demand and safety stock.",
        importantFactors,
        evidenceIssues: [],
        proposedAction: null,
        requiresApproval: false,
      },
    };
  }

  if (recommendedQuantity === 0) {
    return {
      plan,
      decision: {
        decision: "INVESTIGATE_FURTHER",
        originalQuantity,
        recommendedQuantity: 0,
        confidence: "LOW",
        summary: "Purchasing is required, but no feasible order satisfies the current hard constraints.",
        importantFactors,
        evidenceIssues: [],
        proposedAction: null,
        requiresApproval: false,
      },
    };
  }

  const decision = recommendedQuantity === originalQuantity ? "ACCEPT" : "MODIFY";
  const supplier = evidence.supplier.value;

  return {
    plan,
    decision: {
      decision,
      originalQuantity,
      recommendedQuantity,
      confidence: confidenceFor(evidence),
      summary: decision === "ACCEPT"
        ? `Accept the recommendation to order ${recommendedQuantity} units.`
        : `Modify the recommendation from ${originalQuantity} to ${recommendedQuantity} units.`,
      importantFactors,
      evidenceIssues: [],
      proposedAction: {
        type: "CREATE_PURCHASE_ORDER",
        productId: evidence.recommendation.value.productId,
        nodeId: evidence.recommendation.value.nodeId,
        supplierId: supplier.supplierId,
        quantity: recommendedQuantity,
        unitCost: supplier.unitCost,
        currency: supplier.currency,
        expectedDeliveryDate: addUtcDays(asOf, supplier.leadTimeDays),
      },
      requiresApproval: true,
    },
  };
}
