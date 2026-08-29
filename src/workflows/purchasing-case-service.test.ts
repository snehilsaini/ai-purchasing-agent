import { describe, expect, it } from "vitest";

import { FIXTURE_AS_OF, scenarioOneBaseFixture } from "@/evaluation/fixtures";
import { MemoryCaseRepository } from "@/repositories/case-repository";
import { createPurchasingCase } from "@/workflows/demo-cases";
import { PurchasingCaseService } from "@/workflows/purchasing-case-service";

function harness() {
  const purchasingCase = createPurchasingCase({
    id: "CASE-TEST",
    evidence: scenarioOneBaseFixture(),
    now: FIXTURE_AS_OF,
  });
  const repository = new MemoryCaseRepository([purchasingCase]);
  return { service: new PurchasingCaseService(repository), purchasingCase };
}

describe("purchasing case approval workflow", () => {
  it("revalidates and creates exactly one purchase order", async () => {
    const { service, purchasingCase } = harness();
    const approved = await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:10:00.000Z"),
    });

    expect(approved.status).toBe("COMPLETED");
    expect(approved.purchaseOrder?.requested.quantity).toBe(450);
    expect(approved.timeline.map((item) => item.type)).toEqual(expect.arrayContaining([
      "APPROVAL_RECORDED",
      "REVALIDATION_PASSED",
      "ACTION_EXECUTED",
      "OUTCOME_VALIDATED",
    ]));

    const retried = await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:11:00.000Z"),
    });
    expect(retried.purchaseOrder?.purchaseOrderId).toBe(approved.purchaseOrder?.purchaseOrderId);
    expect(retried.timeline.filter((item) => item.type === "ACTION_EXECUTED")).toHaveLength(1);
  });

  it("supersedes approval when live inventory changes the quantity", async () => {
    const { service, purchasingCase } = harness();
    await service.simulateInventoryChange({
      caseId: purchasingCase.id,
      onHandDelta: 100,
      now: new Date("2026-08-29T10:05:00.000Z"),
    });

    const revalidated = await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:10:00.000Z"),
    });

    expect(revalidated.status).toBe("AWAITING_APPROVAL");
    expect(revalidated.proposal?.version).toBe(2);
    expect(revalidated.proposal?.action.quantity).toBe(350);
    expect(revalidated.purchaseOrder).toBeNull();
  });

  it("enters recovery when a supplier confirms less than requested", async () => {
    const { service, purchasingCase } = harness();
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

    expect(recovered.status).toBe("RECOVERY_REQUIRED");
    expect(recovered.purchaseOrder?.status).toBe("PARTIALLY_CONFIRMED");
    expect(recovered.eventType).toBe("SUPPLIER_SHORTFALL_REPORTED");
    expect(recovered.recovery?.status).toBe("AWAITING_APPROVAL");
    expect(recovered.recovery?.analysis.shortfallUnits).toBe(150);
    expect(recovered.recovery?.analysis.candidates).toHaveLength(6);
    expect(recovered.recovery?.proposal?.action.transfers).toEqual([
      expect.objectContaining({ sourceNodeId: "HUB-BLR-11", quantity: 150 }),
    ]);
    expect(recovered.timeline.at(-1)?.detail).toContain("150-unit shortfall");
  });

  it("revalidates, executes, validates, and deduplicates an approved recovery", async () => {
    const { service, purchasingCase } = harness();
    await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:10:00.000Z"),
    });
    const shortfall = await service.recordSupplierConfirmation({
      caseId: purchasingCase.id,
      confirmedQuantity: 300,
      now: new Date("2026-08-29T10:20:00.000Z"),
    });

    const completed = await service.approveRecovery({
      caseId: purchasingCase.id,
      proposalVersion: shortfall.recovery?.proposal?.version ?? 0,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:25:00.000Z"),
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.recovery?.status).toBe("COMPLETED");
    expect(completed.recovery?.execution?.action.coveredUnits).toBe(150);
    expect(completed.timeline.map((item) => item.type)).toEqual(expect.arrayContaining([
      "RECOVERY_APPROVAL_RECORDED",
      "RECOVERY_REVALIDATION_PASSED",
      "RECOVERY_ACTION_EXECUTED",
      "RECOVERY_OUTCOME_VALIDATED",
    ]));

    const retried = await service.approveRecovery({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:26:00.000Z"),
    });
    expect(retried.recovery?.execution?.executionId).toBe(completed.recovery?.execution?.executionId);
    expect(retried.timeline.filter((item) => item.type === "RECOVERY_ACTION_EXECUTED")).toHaveLength(1);
  });

  it("supersedes recovery approval when transfer availability changes", async () => {
    const { service, purchasingCase } = harness();
    await service.approve({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:10:00.000Z"),
    });
    await service.recordSupplierConfirmation({
      caseId: purchasingCase.id,
      confirmedQuantity: 300,
      now: new Date("2026-08-29T10:20:00.000Z"),
    });
    await service.simulateRecoveryAvailabilityChange({
      caseId: purchasingCase.id,
      sourceNodeId: "HUB-BLR-11",
      availableUnits: 0,
      now: new Date("2026-08-29T10:22:00.000Z"),
    });

    const revalidated = await service.approveRecovery({
      caseId: purchasingCase.id,
      proposalVersion: 1,
      buyerId: "buyer@example.com",
      now: new Date("2026-08-29T10:25:00.000Z"),
    });

    expect(revalidated.status).toBe("RECOVERY_REQUIRED");
    expect(revalidated.recovery?.proposal?.version).toBe(2);
    expect(revalidated.recovery?.proposal?.action.transfers).toEqual([
      expect.objectContaining({ sourceNodeId: "HUB-BLR-03", quantity: 100 }),
    ]);
    expect(revalidated.recovery?.proposal?.action.supplierOrders).toEqual([
      expect.objectContaining({ supplierId: "SUP-SWIFT", quantity: 50 }),
    ]);
    expect(revalidated.recovery?.execution).toBeNull();
  });
});
