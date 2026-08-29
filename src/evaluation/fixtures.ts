import type { ScenarioOneEvidence } from "@/domain/purchasing";

export const FIXTURE_AS_OF = new Date("2026-08-29T10:00:00.000Z");

const observedAt = "2026-08-29T09:55:00.000Z";

function envelope<T>(value: T, source: string, maxAgeMinutes = 60) {
  return {
    value,
    source,
    observedAt,
    maxAgeMinutes,
    version: `${source}-v1`,
  };
}

export function scenarioOneBaseFixture(): ScenarioOneEvidence {
  return {
    recommendation: envelope({
      recommendationId: "REC-1042",
      productId: "SKU-CHAI-1L",
      productName: "Masala Chai Concentrate 1L",
      nodeId: "HUB-BLR-07",
      nodeName: "Bellandur Dark Store",
      supplierId: "SUP-AROMA",
      quantity: 800,
    }, "recommendation-engine", 240),
    inventory: envelope({
      onHandUnits: 230,
      reservedUnits: 20,
      damagedUnits: 5,
      quarantinedUnits: 5,
      backorderUnits: 0,
    }, "warehouse-management-system", 30),
    demand: envelope({
      protectionPeriodDays: 10,
      expectedUnits: 900,
      safetyStockUnits: 50,
      forecastConfidence: 0.86,
      dailyUnits: [55, 65, 75, 80, 90, 95, 100, 105, 115, 120],
    }, "forecast-service", 180),
    openPurchaseOrders: envelope([{
      purchaseOrderId: "PO-8731",
      quantity: 300,
      expectedDeliveryDate: "2026-09-02",
      status: "CONFIRMED" as const,
    }], "purchase-order-service", 30),
    supplier: envelope({
      supplierId: "SUP-AROMA",
      supplierName: "Aroma Foods Pvt Ltd",
      leadTimeDays: 2,
      minimumOrderQuantity: 100,
      orderMultiple: 50,
      unitCost: 120,
      currency: "INR",
      availableCapacityUnits: 1_200,
      deliveryReliability: 0.94,
    }, "supplier-service", 120),
    budget: envelope({
      availableAmount: 70_000,
      currency: "INR",
    }, "finance-service", 30),
    storage: envelope({
      availableCapacityUnits: 600,
    }, "capacity-service", 30),
    productPolicy: envelope({
      shelfLifeDays: 45,
      maxOrderUnitsBeforeExpiry: 700,
    }, "catalog-service", 1_440),
  };
}

export function withEvidence<T extends keyof ScenarioOneEvidence>(
  evidence: ScenarioOneEvidence,
  key: T,
  patch: Partial<ScenarioOneEvidence[T]>,
): ScenarioOneEvidence {
  return {
    ...evidence,
    [key]: {
      ...evidence[key],
      ...patch,
    },
  };
}
