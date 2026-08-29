import { describe, expect, it } from "vitest";

import { FIXTURE_AS_OF, scenarioOneBaseFixture } from "@/evaluation/fixtures";
import { calculateSupplierShortfallRecovery } from "@/planning/recovery-plan";
import { fingerprintRecoveryAction } from "@/policies/action-proposal";
import { createPurchasingCase } from "@/workflows/demo-cases";
import { supplierShortfallFixture } from "@/workflows/supplier-shortfall-fixtures";

function confirmedCase() {
  const purchasingCase = createPurchasingCase({
    id: "CASE-RECOVERY-PLAN",
    evidence: scenarioOneBaseFixture(),
    now: FIXTURE_AS_OF,
  });
  purchasingCase.purchaseOrder = {
    purchaseOrderId: "PO-RECOVERY",
    idempotencyKey: "original-order",
    createdAt: FIXTURE_AS_OF.toISOString(),
    status: "PARTIALLY_CONFIRMED",
    requested: purchasingCase.proposal!.action,
    confirmedQuantity: 300,
    confirmedDeliveryDate: purchasingCase.proposal!.action.expectedDeliveryDate,
  };
  return purchasingCase;
}

describe("supplier shortfall recovery planning", () => {
  it("ranks a full on-time transfer ahead of expensive emergency supply", () => {
    const purchasingCase = confirmedCase();
    const analysis = calculateSupplierShortfallRecovery(
      purchasingCase,
      supplierShortfallFixture(FIXTURE_AS_OF),
      FIXTURE_AS_OF,
    );

    expect(analysis.shortfallUnits).toBe(150);
    expect(analysis.remainingBudget).toBe(16_000);
    expect(analysis.recommendedCandidateId).toBe("transfer:HUB-BLR-11");
    expect(analysis.candidates.find((item) => item.candidateId === "supplier:SUP-SWIFT")).toMatchObject({
      feasible: false,
      totalCost: 19_800,
    });
    expect(analysis.candidates.find((item) => item.candidateId === "supplier:SUP-VALUE")?.constraints.join(" ")).toContain("misses");
  });

  it("returns no recommendation when every option is late or under-covered", () => {
    const purchasingCase = confirmedCase();
    const evidence = supplierShortfallFixture(FIXTURE_AS_OF);
    evidence.transferOptions.value = evidence.transferOptions.value.map((option) => ({
      ...option,
      availableUnits: 25,
      transferLeadTimeDays: 5,
    }));
    evidence.alternateSuppliers.value = evidence.alternateSuppliers.value.map((supplier) => ({
      ...supplier,
      leadTimeDays: 5,
      availableCapacityUnits: 25,
    }));

    const analysis = calculateSupplierShortfallRecovery(purchasingCase, evidence, FIXTURE_AS_OF);

    expect(analysis.recommendedCandidateId).toBeNull();
    expect(analysis.candidates.every((item) => !item.feasible)).toBe(true);
  });

  it("keeps recovery fingerprints stable when JSON storage reorders nested keys", () => {
    const purchasingCase = confirmedCase();
    const analysis = calculateSupplierShortfallRecovery(
      purchasingCase,
      supplierShortfallFixture(FIXTURE_AS_OF),
      FIXTURE_AS_OF,
    );
    const action = analysis.candidates.find(
      (candidate) => candidate.candidateId === analysis.recommendedCandidateId,
    )!.action!;
    const transfer = action.transfers[0];
    const reordered = {
      currency: action.currency,
      transfers: [{
        quantity: transfer.quantity,
        expectedArrivalDate: transfer.expectedArrivalDate,
        transferCostPerUnit: transfer.transferCostPerUnit,
        destinationNodeId: transfer.destinationNodeId,
        sourceNodeId: transfer.sourceNodeId,
      }],
      supplierOrders: [],
      totalCost: action.totalCost,
      latestArrivalDate: action.latestArrivalDate,
      coveredUnits: action.coveredUnits,
      shortfallUnits: action.shortfallUnits,
      destinationNodeId: action.destinationNodeId,
      productId: action.productId,
      type: action.type,
    };

    expect(fingerprintRecoveryAction(reordered)).toBe(fingerprintRecoveryAction(action));
  });
});
