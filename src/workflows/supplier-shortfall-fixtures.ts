import type { SupplierShortfallEvidence } from "@/domain/purchasing";

export function supplierShortfallFixture(asOf: Date): SupplierShortfallEvidence {
  const observedAt = new Date(asOf.getTime() - 2 * 60_000).toISOString();
  return {
    alternateSuppliers: {
      value: [
        {
          supplierId: "SUP-SWIFT",
          supplierName: "Swift Provisions Ltd",
          leadTimeDays: 1,
          minimumOrderQuantity: 50,
          orderMultiple: 50,
          unitCost: 132,
          currency: "INR",
          availableCapacityUnits: 250,
          deliveryReliability: 0.91,
        },
        {
          supplierId: "SUP-VALUE",
          supplierName: "Value Foods Co",
          leadTimeDays: 3,
          minimumOrderQuantity: 100,
          orderMultiple: 100,
          unitCost: 112,
          currency: "INR",
          availableCapacityUnits: 500,
          deliveryReliability: 0.87,
        },
      ],
      source: "supplier-network-service",
      observedAt,
      maxAgeMinutes: 30,
      version: "supplier-network-v1",
    },
    transferOptions: {
      value: [
        {
          sourceNodeId: "HUB-BLR-03",
          sourceNodeName: "HSR Layout Dark Store",
          availableUnits: 100,
          transferLeadTimeDays: 0,
          transferCostPerUnit: 8,
          transferReliability: 0.98,
        },
        {
          sourceNodeId: "HUB-BLR-11",
          sourceNodeName: "Marathahalli Dark Store",
          availableUnits: 200,
          transferLeadTimeDays: 1,
          transferCostPerUnit: 12,
          transferReliability: 0.96,
        },
      ],
      source: "network-inventory-service",
      observedAt,
      maxAgeMinutes: 15,
      version: "network-inventory-v1",
    },
  };
}
