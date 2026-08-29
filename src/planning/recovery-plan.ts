import type {
  AlternateSupplier,
  PurchasingCase,
  RecoverSupplierShortfallAction,
  RecoveryCandidate,
  SupplierShortfallAnalysis,
  SupplierShortfallEvidence,
  TransferOption,
} from "@/domain/purchasing";

function addUtcDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

function roundUp(quantity: number, multiple: number): number {
  return Math.ceil(quantity / multiple) * multiple;
}

function candidate(input: {
  candidateId: string;
  strategy: RecoveryCandidate["strategy"];
  label: string;
  action: RecoverSupplierShortfallAction;
  shortfallUnits: number;
  remainingBudget: number;
  requiredByDate: string;
  serviceRisk: number;
  extraConstraints?: string[];
}): RecoveryCandidate {
  const uncoveredUnits = Math.max(0, input.shortfallUnits - input.action.coveredUnits);
  const constraints = [...(input.extraConstraints ?? [])];

  if (uncoveredUnits > 0) constraints.push(`${uncoveredUnits} shortfall units remain uncovered.`);
  if (input.action.totalCost > input.remainingBudget) {
    constraints.push(
      `Recovery costs ${input.action.currency} ${input.action.totalCost}, exceeding the ${input.action.currency} ${input.remainingBudget} remaining budget.`,
    );
  }
  if (input.action.latestArrivalDate > input.requiredByDate) {
    constraints.push(
      `Latest arrival ${input.action.latestArrivalDate} misses the ${input.requiredByDate} required-by date.`,
    );
  }

  const feasible = constraints.length === 0;
  const overageUnits = Math.max(0, input.action.coveredUnits - input.shortfallUnits);
  const score = feasible
    ? Math.round((input.action.totalCost + input.serviceRisk * 10_000 + overageUnits * 10) * 100) / 100
    : null;

  return {
    candidateId: input.candidateId,
    strategy: input.strategy,
    label: input.label,
    feasible,
    coveredUnits: input.action.coveredUnits,
    uncoveredUnits,
    totalCost: input.action.totalCost,
    currency: input.action.currency,
    latestArrivalDate: input.action.latestArrivalDate,
    serviceRisk: Math.round(input.serviceRisk * 1_000) / 1_000,
    score,
    constraints: feasible
      ? ["Coverage, timing, capacity, order rules, and remaining budget pass."]
      : constraints,
    action: feasible ? input.action : null,
  };
}

function supplierCandidate(input: {
  supplier: AlternateSupplier;
  shortfallUnits: number;
  productId: string;
  destinationNodeId: string;
  remainingBudget: number;
  requiredByDate: string;
  asOf: Date;
}): RecoveryCandidate {
  const quantity = roundUp(
    Math.max(input.shortfallUnits, input.supplier.minimumOrderQuantity),
    input.supplier.orderMultiple,
  );
  const arrival = addUtcDays(input.asOf, input.supplier.leadTimeDays);
  const extraConstraints = quantity > input.supplier.availableCapacityUnits
    ? [`${input.supplier.supplierName} has capacity for only ${input.supplier.availableCapacityUnits} units.`]
    : [];
  const action: RecoverSupplierShortfallAction = {
    type: "RECOVER_SUPPLIER_SHORTFALL",
    productId: input.productId,
    destinationNodeId: input.destinationNodeId,
    shortfallUnits: input.shortfallUnits,
    supplierOrders: [{
      supplierId: input.supplier.supplierId,
      quantity,
      unitCost: input.supplier.unitCost,
      currency: input.supplier.currency,
      expectedDeliveryDate: arrival,
    }],
    transfers: [],
    coveredUnits: quantity,
    totalCost: quantity * input.supplier.unitCost,
    currency: input.supplier.currency,
    latestArrivalDate: arrival,
  };

  return candidate({
    candidateId: `supplier:${input.supplier.supplierId}`,
    strategy: "ALTERNATE_SUPPLIER",
    label: `Order from ${input.supplier.supplierName}`,
    action,
    shortfallUnits: input.shortfallUnits,
    remainingBudget: input.remainingBudget,
    requiredByDate: input.requiredByDate,
    serviceRisk: 1 - input.supplier.deliveryReliability,
    extraConstraints,
  });
}

function transferCandidate(input: {
  transfer: TransferOption;
  shortfallUnits: number;
  productId: string;
  destinationNodeId: string;
  remainingBudget: number;
  requiredByDate: string;
  asOf: Date;
}): RecoveryCandidate {
  const quantity = Math.min(input.shortfallUnits, input.transfer.availableUnits);
  const arrival = addUtcDays(input.asOf, input.transfer.transferLeadTimeDays);
  const action: RecoverSupplierShortfallAction = {
    type: "RECOVER_SUPPLIER_SHORTFALL",
    productId: input.productId,
    destinationNodeId: input.destinationNodeId,
    shortfallUnits: input.shortfallUnits,
    supplierOrders: [],
    transfers: [{
      sourceNodeId: input.transfer.sourceNodeId,
      destinationNodeId: input.destinationNodeId,
      quantity,
      transferCostPerUnit: input.transfer.transferCostPerUnit,
      expectedArrivalDate: arrival,
    }],
    coveredUnits: quantity,
    totalCost: quantity * input.transfer.transferCostPerUnit,
    currency: "INR",
    latestArrivalDate: arrival,
  };

  return candidate({
    candidateId: `transfer:${input.transfer.sourceNodeId}`,
    strategy: "INVENTORY_TRANSFER",
    label: `Transfer from ${input.transfer.sourceNodeName}`,
    action,
    shortfallUnits: input.shortfallUnits,
    remainingBudget: input.remainingBudget,
    requiredByDate: input.requiredByDate,
    serviceRisk: 1 - input.transfer.transferReliability,
  });
}

function splitCandidate(input: {
  supplier: AlternateSupplier;
  transfer: TransferOption;
  shortfallUnits: number;
  productId: string;
  destinationNodeId: string;
  remainingBudget: number;
  requiredByDate: string;
  asOf: Date;
}): RecoveryCandidate | null {
  const transferQuantity = Math.min(input.transfer.availableUnits, input.shortfallUnits);
  if (transferQuantity <= 0) return null;
  const supplierNeed = input.shortfallUnits - transferQuantity;
  if (supplierNeed <= 0) return null;

  const supplierQuantity = roundUp(
    Math.max(supplierNeed, input.supplier.minimumOrderQuantity),
    input.supplier.orderMultiple,
  );
  const transferArrival = addUtcDays(input.asOf, input.transfer.transferLeadTimeDays);
  const supplierArrival = addUtcDays(input.asOf, input.supplier.leadTimeDays);
  const extraConstraints = supplierQuantity > input.supplier.availableCapacityUnits
    ? [`${input.supplier.supplierName} has capacity for only ${input.supplier.availableCapacityUnits} units.`]
    : [];
  const coveredUnits = transferQuantity + supplierQuantity;
  const action: RecoverSupplierShortfallAction = {
    type: "RECOVER_SUPPLIER_SHORTFALL",
    productId: input.productId,
    destinationNodeId: input.destinationNodeId,
    shortfallUnits: input.shortfallUnits,
    supplierOrders: [{
      supplierId: input.supplier.supplierId,
      quantity: supplierQuantity,
      unitCost: input.supplier.unitCost,
      currency: input.supplier.currency,
      expectedDeliveryDate: supplierArrival,
    }],
    transfers: [{
      sourceNodeId: input.transfer.sourceNodeId,
      destinationNodeId: input.destinationNodeId,
      quantity: transferQuantity,
      transferCostPerUnit: input.transfer.transferCostPerUnit,
      expectedArrivalDate: transferArrival,
    }],
    coveredUnits,
    totalCost:
      supplierQuantity * input.supplier.unitCost
      + transferQuantity * input.transfer.transferCostPerUnit,
    currency: input.supplier.currency,
    latestArrivalDate: supplierArrival > transferArrival ? supplierArrival : transferArrival,
  };
  const serviceRisk = (
    supplierQuantity * (1 - input.supplier.deliveryReliability)
    + transferQuantity * (1 - input.transfer.transferReliability)
  ) / coveredUnits;

  return candidate({
    candidateId: `split:${input.transfer.sourceNodeId}:${input.supplier.supplierId}`,
    strategy: "SPLIT",
    label: `Split between ${input.transfer.sourceNodeName} and ${input.supplier.supplierName}`,
    action,
    shortfallUnits: input.shortfallUnits,
    remainingBudget: input.remainingBudget,
    requiredByDate: input.requiredByDate,
    serviceRisk,
    extraConstraints,
  });
}

export function calculateSupplierShortfallRecovery(
  purchasingCase: PurchasingCase,
  evidence: SupplierShortfallEvidence,
  asOf: Date,
): SupplierShortfallAnalysis {
  const purchaseOrder = purchasingCase.purchaseOrder;
  if (!purchaseOrder || purchaseOrder.confirmedQuantity === null) {
    throw new Error("A supplier confirmation is required before recovery can be planned.");
  }

  const requestedUnits = purchaseOrder.requested.quantity;
  const confirmedUnits = purchaseOrder.confirmedQuantity;
  const shortfallUnits = Math.max(0, requestedUnits - confirmedUnits);
  const requiredByDate = purchaseOrder.requested.expectedDeliveryDate;
  const remainingBudget = Math.max(
    0,
    purchasingCase.evidence.budget.value.availableAmount
      - purchaseOrder.requested.quantity * purchaseOrder.requested.unitCost,
  );
  const common = {
    shortfallUnits,
    productId: purchaseOrder.requested.productId,
    destinationNodeId: purchaseOrder.requested.nodeId,
    remainingBudget,
    requiredByDate,
    asOf,
  };
  const supplierCandidates = evidence.alternateSuppliers.value.map((supplier) =>
    supplierCandidate({ ...common, supplier }));
  const transferCandidates = evidence.transferOptions.value.map((transfer) =>
    transferCandidate({ ...common, transfer }));
  const splitCandidates = evidence.transferOptions.value.flatMap((transfer) =>
    evidence.alternateSuppliers.value.flatMap((supplier) => {
      const result = splitCandidate({ ...common, supplier, transfer });
      return result ? [result] : [];
    }));
  const candidates = [...supplierCandidates, ...transferCandidates, ...splitCandidates];
  const recommended = candidates
    .filter((item) => item.feasible && item.score !== null)
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))[0] ?? null;

  return {
    calculatedAt: asOf.toISOString(),
    requestedUnits,
    confirmedUnits,
    shortfallUnits,
    requiredByDate,
    remainingBudget,
    currency: purchaseOrder.requested.currency,
    candidates,
    recommendedCandidateId: recommended?.candidateId ?? null,
    summary: recommended
      ? `Recover the ${shortfallUnits}-unit shortfall with ${recommended.label.toLowerCase()}.`
      : `No feasible option currently covers the ${shortfallUnits}-unit supplier shortfall.`,
  };
}
