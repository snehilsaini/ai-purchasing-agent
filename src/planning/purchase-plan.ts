import type {
  ConstraintResult,
  ProjectionPoint,
  PurchasePlan,
  ScenarioOneEvidence,
} from "@/domain/purchasing";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function roundUp(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function roundDown(value: number, multiple: number): number {
  return Math.floor(value / multiple) * multiple;
}

function calculateMaximumFeasibleUnits(evidence: ScenarioOneEvidence): {
  maximum: number;
  limits: Record<"BUDGET" | "STORAGE" | "SUPPLIER_CAPACITY" | "SHELF_LIFE", number>;
} {
  const { supplier, budget, storage, productPolicy } = evidence;
  const budgetLimit = Math.floor(budget.value.availableAmount / supplier.value.unitCost);
  const shelfLifeLimit = productPolicy.value.maxOrderUnitsBeforeExpiry ?? Number.MAX_SAFE_INTEGER;
  const limits = {
    BUDGET: budgetLimit,
    STORAGE: storage.value.availableCapacityUnits,
    SUPPLIER_CAPACITY: supplier.value.availableCapacityUnits,
    SHELF_LIFE: shelfLifeLimit,
  };

  return { maximum: Math.min(...Object.values(limits)), limits };
}

function buildConstraintResults(
  unconstrainedUnits: number,
  recommendedUnits: number,
  maximumLimits: Record<"BUDGET" | "STORAGE" | "SUPPLIER_CAPACITY" | "SHELF_LIFE", number>,
  evidence: ScenarioOneEvidence,
): ConstraintResult[] {
  const supplier = evidence.supplier.value;
  const results: ConstraintResult[] = [
    {
      code: "MOQ",
      label: "Minimum order quantity",
      status: recommendedUnits === 0 && unconstrainedUnits > 0 ? "BLOCKED" : "PASS",
      limit: supplier.minimumOrderQuantity,
      detail: recommendedUnits > 0
        ? `${recommendedUnits} units meets the ${supplier.minimumOrderQuantity}-unit minimum.`
        : `No feasible order can meet the ${supplier.minimumOrderQuantity}-unit minimum.`,
    },
    {
      code: "ORDER_MULTIPLE",
      label: "Order multiple",
      status: recommendedUnits > 0 && recommendedUnits !== unconstrainedUnits ? "ADJUSTED" : "PASS",
      limit: supplier.orderMultiple,
      detail: `${recommendedUnits} units is aligned to packs of ${supplier.orderMultiple}.`,
    },
  ];

  const labels = {
    BUDGET: "Available budget",
    STORAGE: "Storage capacity",
    SUPPLIER_CAPACITY: "Supplier capacity",
    SHELF_LIFE: "Shelf-life exposure",
  } as const;

  for (const code of Object.keys(maximumLimits) as (keyof typeof maximumLimits)[]) {
    const limit = maximumLimits[code];
    const constrained = limit < unconstrainedUnits;
    results.push({
      code,
      label: labels[code],
      status: constrained ? (recommendedUnits > 0 ? "ADJUSTED" : "BLOCKED") : "PASS",
      limit: limit === Number.MAX_SAFE_INTEGER ? undefined : limit,
      detail: constrained
        ? `${labels[code]} limits this order to ${limit} units before pack rounding.`
        : `${labels[code]} supports the proposed quantity.`,
    });
  }

  return results;
}

function buildProjection(
  evidence: ScenarioOneEvidence,
  asOf: Date,
  newOrderUnits: number,
): ProjectionPoint[] {
  const days = evidence.demand.value.protectionPeriodDays;
  const explicitDailyDemand = evidence.demand.value.dailyUnits;
  const defaultDailyDemand = evidence.demand.value.expectedUnits / days;
  const newDeliveryDate = isoDate(addUtcDays(asOf, evidence.supplier.value.leadTimeDays));
  const confirmedInboundByDate = new Map<string, number>();

  for (const po of evidence.openPurchaseOrders.value) {
    if (po.status !== "CONFIRMED") continue;
    confirmedInboundByDate.set(
      po.expectedDeliveryDate,
      (confirmedInboundByDate.get(po.expectedDeliveryDate) ?? 0) + po.quantity,
    );
  }

  if (newOrderUnits > 0) {
    confirmedInboundByDate.set(
      newDeliveryDate,
      (confirmedInboundByDate.get(newDeliveryDate) ?? 0) + newOrderUnits,
    );
  }

  const inventory = evidence.inventory.value;
  let balance = inventory.onHandUnits
    - inventory.reservedUnits
    - inventory.damagedUnits
    - inventory.quarantinedUnits
    - inventory.backorderUnits;

  return Array.from({ length: days }, (_, index) => {
    const date = isoDate(addUtcDays(asOf, index + 1));
    const openingUnits = balance;
    const inboundUnits = confirmedInboundByDate.get(date) ?? 0;
    const demandUnits = explicitDailyDemand?.[index] ?? defaultDailyDemand;
    balance = openingUnits + inboundUnits - demandUnits;

    return {
      date,
      openingUnits: Math.round(openingUnits),
      inboundUnits,
      demandUnits: Math.round(demandUnits),
      closingUnits: Math.round(balance),
    };
  });
}

export function calculatePurchasePlan(
  evidence: ScenarioOneEvidence,
  asOf: Date,
): PurchasePlan {
  const inventory = evidence.inventory.value;
  const demand = evidence.demand.value;
  const supplier = evidence.supplier.value;
  const usableOnHandUnits = Math.max(
    0,
    inventory.onHandUnits
      - inventory.reservedUnits
      - inventory.damagedUnits
      - inventory.quarantinedUnits
      - inventory.backorderUnits,
  );
  const protectionEndDate = isoDate(addUtcDays(asOf, demand.protectionPeriodDays));
  const confirmedInboundUnits = evidence.openPurchaseOrders.value
    .filter((po) => po.status === "CONFIRMED" && po.expectedDeliveryDate <= protectionEndDate)
    .reduce((sum, po) => sum + po.quantity, 0);
  const targetInventoryUnits = Math.ceil(demand.expectedUnits + demand.safetyStockUnits);
  const rawRequirementUnits = Math.max(
    0,
    targetInventoryUnits - usableOnHandUnits - confirmedInboundUnits,
  );
  const roundedRequirement = rawRequirementUnits === 0
    ? 0
    : roundUp(rawRequirementUnits, supplier.orderMultiple);
  const unconstrainedOrderUnits = roundedRequirement === 0
    ? 0
    : Math.max(roundedRequirement, supplier.minimumOrderQuantity);
  const { maximum, limits } = calculateMaximumFeasibleUnits(evidence);
  const packRoundedMaximum = roundDown(maximum, supplier.orderMultiple);
  const recommendedOrderUnits = unconstrainedOrderUnits === 0
    ? 0
    : packRoundedMaximum < supplier.minimumOrderQuantity
      ? 0
      : Math.min(unconstrainedOrderUnits, packRoundedMaximum);
  const residualShortageUnits = Math.max(0, rawRequirementUnits - recommendedOrderUnits);
  const baselineProjection = buildProjection(evidence, asOf, 0);
  const proposedProjection = buildProjection(evidence, asOf, recommendedOrderUnits);
  const firstStockout = (points: ProjectionPoint[]) =>
    points.find((point) => point.closingUnits < 0)?.date ?? null;

  return {
    calculatedAt: asOf.toISOString(),
    protectionEndDate,
    usableOnHandUnits,
    confirmedInboundUnits,
    targetInventoryUnits,
    rawRequirementUnits,
    unconstrainedOrderUnits,
    recommendedOrderUnits,
    projectedEndingUnits:
      usableOnHandUnits + confirmedInboundUnits + recommendedOrderUnits - demand.expectedUnits,
    orderCost: recommendedOrderUnits * supplier.unitCost,
    currency: supplier.currency,
    baselineStockoutDate: firstStockout(baselineProjection),
    proposedStockoutDate: firstStockout(proposedProjection),
    baselineProjection,
    proposedProjection,
    constraints: buildConstraintResults(
      unconstrainedOrderUnits,
      recommendedOrderUnits,
      limits,
      evidence,
    ),
    residualShortageUnits,
  };
}
