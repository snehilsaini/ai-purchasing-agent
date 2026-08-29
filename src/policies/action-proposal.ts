import { createHash, randomUUID } from "node:crypto";

import type {
  ActionProposal,
  CreatePurchaseOrderAction,
  EvidenceKey,
  RecoverSupplierShortfallAction,
  RecoveryActionProposal,
  ScenarioOneEvidence,
  SupplierShortfallEvidence,
} from "@/domain/purchasing";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function fingerprintAction(action: CreatePurchaseOrderAction): string {
  const canonicalAction = {
    type: action.type,
    productId: action.productId,
    nodeId: action.nodeId,
    supplierId: action.supplierId,
    quantity: action.quantity,
    unitCost: action.unitCost,
    currency: action.currency,
    expectedDeliveryDate: action.expectedDeliveryDate,
  };

  return hash(canonicalAction);
}

export function fingerprintRecoveryAction(action: RecoverSupplierShortfallAction): string {
  return hash({
    type: action.type,
    productId: action.productId,
    destinationNodeId: action.destinationNodeId,
    shortfallUnits: action.shortfallUnits,
    supplierOrders: action.supplierOrders
      .map((order) => ({
        supplierId: order.supplierId,
        quantity: order.quantity,
        unitCost: order.unitCost,
        currency: order.currency,
        expectedDeliveryDate: order.expectedDeliveryDate,
      }))
      .sort((a, b) => a.supplierId.localeCompare(b.supplierId)),
    transfers: action.transfers
      .map((transfer) => ({
        sourceNodeId: transfer.sourceNodeId,
        destinationNodeId: transfer.destinationNodeId,
        quantity: transfer.quantity,
        transferCostPerUnit: transfer.transferCostPerUnit,
        expectedArrivalDate: transfer.expectedArrivalDate,
      }))
      .sort((a, b) => a.sourceNodeId.localeCompare(b.sourceNodeId)),
    coveredUnits: action.coveredUnits,
    totalCost: action.totalCost,
    currency: action.currency,
    latestArrivalDate: action.latestArrivalDate,
  });
}

export function createActionProposal(input: {
  caseId: string;
  action: CreatePurchaseOrderAction;
  evidence: ScenarioOneEvidence;
  version: number;
  now: Date;
  validityMinutes?: number;
}): ActionProposal {
  const actionFingerprint = fingerprintAction(input.action);
  const configuredValidity = Number(process.env.PROPOSAL_VALIDITY_MINUTES);
  const defaultValidity = Number.isFinite(configuredValidity) && configuredValidity > 0
    ? configuredValidity
    : 30;
  const validUntil = new Date(
    input.now.getTime() + (input.validityMinutes ?? defaultValidity) * 60_000,
  );
  const evidenceVersions = Object.fromEntries(
    (Object.entries(input.evidence) as [EvidenceKey, ScenarioOneEvidence[EvidenceKey]][])
      .map(([key, value]) => [key, value.version]),
  ) as Record<EvidenceKey, string>;

  return {
    proposalId: randomUUID(),
    version: input.version,
    createdAt: input.now.toISOString(),
    validUntil: validUntil.toISOString(),
    evidenceVersions,
    action: input.action,
    actionFingerprint,
    idempotencyKey: [
      "purchase-order",
      input.caseId,
      `v${input.version}`,
      actionFingerprint.slice(0, 16),
    ].join(":"),
  };
}

export function describeMaterialChanges(
  approved: CreatePurchaseOrderAction,
  current: CreatePurchaseOrderAction,
): string[] {
  const changes: string[] = [];

  if (approved.quantity !== current.quantity) {
    changes.push(`Quantity changed from ${approved.quantity} to ${current.quantity} units.`);
  }
  if (approved.supplierId !== current.supplierId) {
    changes.push(`Supplier changed from ${approved.supplierId} to ${current.supplierId}.`);
  }
  if (approved.unitCost !== current.unitCost || approved.currency !== current.currency) {
    changes.push(
      `Unit cost changed from ${approved.currency} ${approved.unitCost} to ${current.currency} ${current.unitCost}.`,
    );
  }
  if (approved.expectedDeliveryDate !== current.expectedDeliveryDate) {
    changes.push(
      `Expected delivery changed from ${approved.expectedDeliveryDate} to ${current.expectedDeliveryDate}.`,
    );
  }
  if (approved.productId !== current.productId || approved.nodeId !== current.nodeId) {
    changes.push("The product or destination node changed.");
  }

  return changes;
}

export function createRecoveryActionProposal(input: {
  caseId: string;
  action: RecoverSupplierShortfallAction;
  evidence: SupplierShortfallEvidence;
  version: number;
  now: Date;
  validityMinutes?: number;
}): RecoveryActionProposal {
  const actionFingerprint = fingerprintRecoveryAction(input.action);
  const configuredValidity = Number(process.env.PROPOSAL_VALIDITY_MINUTES);
  const defaultValidity = Number.isFinite(configuredValidity) && configuredValidity > 0
    ? configuredValidity
    : 30;
  const validUntil = new Date(
    input.now.getTime() + (input.validityMinutes ?? defaultValidity) * 60_000,
  );
  const evidenceVersions = Object.fromEntries(
    (Object.entries(input.evidence) as [keyof SupplierShortfallEvidence, SupplierShortfallEvidence[keyof SupplierShortfallEvidence]][])
      .map(([key, value]) => [key, value.version]),
  ) as Record<keyof SupplierShortfallEvidence, string>;

  return {
    proposalId: randomUUID(),
    version: input.version,
    createdAt: input.now.toISOString(),
    validUntil: validUntil.toISOString(),
    evidenceVersions,
    action: input.action,
    actionFingerprint,
    idempotencyKey: [
      "supplier-shortfall-recovery",
      input.caseId,
      `v${input.version}`,
      actionFingerprint.slice(0, 16),
    ].join(":"),
  };
}
