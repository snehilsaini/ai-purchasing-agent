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
    expect(recovered.timeline.at(-1)?.detail).toContain("150-unit shortfall");
  });
});
