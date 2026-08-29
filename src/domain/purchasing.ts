import { z } from "zod";

export const decisionSchema = z.enum([
  "ACCEPT",
  "MODIFY",
  "REJECT",
  "INVESTIGATE_FURTHER",
]);

export const caseStatusSchema = z.enum([
  "TRIGGERED",
  "INVESTIGATING",
  "EVIDENCE_READY",
  "DECIDED",
  "AWAITING_APPROVAL",
  "REVALIDATING",
  "EXECUTING",
  "VALIDATING",
  "COMPLETED",
  "RECOVERY_REQUIRED",
  "ESCALATED",
]);

export const recommendationSchema = z.object({
  recommendationId: z.string(),
  productId: z.string(),
  productName: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  supplierId: z.string(),
  quantity: z.number().int().nonnegative(),
});

export const inventorySchema = z.object({
  onHandUnits: z.number().int().nonnegative(),
  reservedUnits: z.number().int().nonnegative(),
  damagedUnits: z.number().int().nonnegative(),
  quarantinedUnits: z.number().int().nonnegative(),
  backorderUnits: z.number().int().nonnegative(),
});

export const demandSchema = z.object({
  protectionPeriodDays: z.number().int().positive(),
  expectedUnits: z.number().nonnegative(),
  safetyStockUnits: z.number().int().nonnegative(),
  forecastConfidence: z.number().min(0).max(1),
  dailyUnits: z.array(z.number().nonnegative()).optional(),
});

export const openPurchaseOrderSchema = z.object({
  purchaseOrderId: z.string(),
  quantity: z.number().int().positive(),
  expectedDeliveryDate: z.string(),
  status: z.enum(["DRAFT", "SUBMITTED", "CONFIRMED", "DELAYED", "CANCELLED"]),
});

export const supplierSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  leadTimeDays: z.number().int().nonnegative(),
  minimumOrderQuantity: z.number().int().positive(),
  orderMultiple: z.number().int().positive(),
  unitCost: z.number().positive(),
  currency: z.string(),
  availableCapacityUnits: z.number().int().nonnegative(),
  deliveryReliability: z.number().min(0).max(1),
});

export const budgetSchema = z.object({
  availableAmount: z.number().nonnegative(),
  currency: z.string(),
});

export const storageSchema = z.object({
  availableCapacityUnits: z.number().int().nonnegative(),
});

export const productPolicySchema = z.object({
  shelfLifeDays: z.number().int().positive().optional(),
  maxOrderUnitsBeforeExpiry: z.number().int().nonnegative().optional(),
});

export const alternateSupplierSchema = z.object({
  supplierId: z.string(),
  supplierName: z.string(),
  leadTimeDays: z.number().int().nonnegative(),
  minimumOrderQuantity: z.number().int().positive(),
  orderMultiple: z.number().int().positive(),
  unitCost: z.number().positive(),
  currency: z.string(),
  availableCapacityUnits: z.number().int().nonnegative(),
  deliveryReliability: z.number().min(0).max(1),
});

export const transferOptionSchema = z.object({
  sourceNodeId: z.string(),
  sourceNodeName: z.string(),
  availableUnits: z.number().int().nonnegative(),
  transferLeadTimeDays: z.number().int().nonnegative(),
  transferCostPerUnit: z.number().nonnegative(),
  transferReliability: z.number().min(0).max(1),
});

export const evidenceEnvelopeSchema = <T extends z.ZodType>(schema: T) =>
  z.object({
    value: schema,
    source: z.string(),
    observedAt: z.string(),
    maxAgeMinutes: z.number().int().positive(),
    version: z.string(),
  });

export const scenarioOneEvidenceSchema = z.object({
  recommendation: evidenceEnvelopeSchema(recommendationSchema),
  inventory: evidenceEnvelopeSchema(inventorySchema),
  demand: evidenceEnvelopeSchema(demandSchema),
  openPurchaseOrders: evidenceEnvelopeSchema(z.array(openPurchaseOrderSchema)),
  supplier: evidenceEnvelopeSchema(supplierSchema),
  budget: evidenceEnvelopeSchema(budgetSchema),
  storage: evidenceEnvelopeSchema(storageSchema),
  productPolicy: evidenceEnvelopeSchema(productPolicySchema),
});

export const supplierShortfallEvidenceSchema = z.object({
  alternateSuppliers: evidenceEnvelopeSchema(z.array(alternateSupplierSchema)),
  transferOptions: evidenceEnvelopeSchema(z.array(transferOptionSchema)),
});

export type Decision = z.infer<typeof decisionSchema>;
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type Inventory = z.infer<typeof inventorySchema>;
export type Demand = z.infer<typeof demandSchema>;
export type OpenPurchaseOrder = z.infer<typeof openPurchaseOrderSchema>;
export type Supplier = z.infer<typeof supplierSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type Storage = z.infer<typeof storageSchema>;
export type ProductPolicy = z.infer<typeof productPolicySchema>;
export type ScenarioOneEvidence = z.infer<typeof scenarioOneEvidenceSchema>;
export type AlternateSupplier = z.infer<typeof alternateSupplierSchema>;
export type TransferOption = z.infer<typeof transferOptionSchema>;
export type SupplierShortfallEvidence = z.infer<typeof supplierShortfallEvidenceSchema>;

export type EvidenceKey = keyof ScenarioOneEvidence;

export interface EvidenceIssue {
  key: EvidenceKey;
  reason: "MISSING" | "STALE" | "INVALID";
  detail: string;
}

export interface ConstraintResult {
  code: "MOQ" | "ORDER_MULTIPLE" | "BUDGET" | "STORAGE" | "SUPPLIER_CAPACITY" | "SHELF_LIFE";
  label: string;
  status: "PASS" | "ADJUSTED" | "BLOCKED";
  limit?: number;
  detail: string;
}

export interface ProjectionPoint {
  date: string;
  openingUnits: number;
  inboundUnits: number;
  demandUnits: number;
  closingUnits: number;
}

export interface PurchasePlan {
  calculatedAt: string;
  protectionEndDate: string;
  usableOnHandUnits: number;
  confirmedInboundUnits: number;
  targetInventoryUnits: number;
  rawRequirementUnits: number;
  unconstrainedOrderUnits: number;
  recommendedOrderUnits: number;
  projectedEndingUnits: number;
  orderCost: number;
  currency: string;
  baselineStockoutDate: string | null;
  proposedStockoutDate: string | null;
  baselineProjection: ProjectionPoint[];
  proposedProjection: ProjectionPoint[];
  constraints: ConstraintResult[];
  residualShortageUnits: number;
}

export interface CreatePurchaseOrderAction {
  type: "CREATE_PURCHASE_ORDER";
  productId: string;
  nodeId: string;
  supplierId: string;
  quantity: number;
  unitCost: number;
  currency: string;
  expectedDeliveryDate: string;
}

export interface PurchasingDecision {
  decision: Decision;
  originalQuantity: number;
  recommendedQuantity: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  importantFactors: string[];
  evidenceIssues: EvidenceIssue[];
  proposedAction: CreatePurchaseOrderAction | null;
  requiresApproval: boolean;
}

export interface ScenarioAnalysis {
  plan: PurchasePlan | null;
  decision: PurchasingDecision;
}

export interface ActionProposal {
  proposalId: string;
  version: number;
  createdAt: string;
  validUntil: string;
  evidenceVersions: Record<EvidenceKey, string>;
  action: CreatePurchaseOrderAction;
  actionFingerprint: string;
  idempotencyKey: string;
}

export interface TimelineEvent {
  id: string;
  type:
    | "CASE_CREATED"
    | "EVIDENCE_GATHERED"
    | "DECISION_RECORDED"
    | "APPROVAL_RECORDED"
    | "REVALIDATION_PASSED"
    | "REVALIDATION_FAILED"
    | "ACTION_EXECUTED"
    | "OUTCOME_VALIDATED"
    | "RECOVERY_CREATED"
    | "RECOVERY_EVIDENCE_GATHERED"
    | "RECOVERY_DECISION_RECORDED"
    | "RECOVERY_APPROVAL_RECORDED"
    | "RECOVERY_REVALIDATION_PASSED"
    | "RECOVERY_REVALIDATION_FAILED"
    | "RECOVERY_ACTION_EXECUTED"
    | "RECOVERY_OUTCOME_VALIDATED";
  at: string;
  title: string;
  detail: string;
  actor: "SYSTEM" | "AGENT" | "BUYER" | "SUPPLIER";
}

export interface PurchaseOrderRecord {
  purchaseOrderId: string;
  idempotencyKey: string;
  createdAt: string;
  status: "SUBMITTED" | "CONFIRMED" | "PARTIALLY_CONFIRMED";
  requested: CreatePurchaseOrderAction;
  confirmedQuantity: number | null;
  confirmedDeliveryDate: string | null;
}

export interface RecoverySupplierAllocation {
  supplierId: string;
  quantity: number;
  unitCost: number;
  currency: string;
  expectedDeliveryDate: string;
}

export interface RecoveryTransferAllocation {
  sourceNodeId: string;
  destinationNodeId: string;
  quantity: number;
  transferCostPerUnit: number;
  expectedArrivalDate: string;
}

export interface RecoverSupplierShortfallAction {
  type: "RECOVER_SUPPLIER_SHORTFALL";
  productId: string;
  destinationNodeId: string;
  shortfallUnits: number;
  supplierOrders: RecoverySupplierAllocation[];
  transfers: RecoveryTransferAllocation[];
  coveredUnits: number;
  totalCost: number;
  currency: string;
  latestArrivalDate: string;
}

export interface RecoveryCandidate {
  candidateId: string;
  strategy: "ALTERNATE_SUPPLIER" | "INVENTORY_TRANSFER" | "SPLIT";
  label: string;
  feasible: boolean;
  coveredUnits: number;
  uncoveredUnits: number;
  totalCost: number;
  currency: string;
  latestArrivalDate: string;
  serviceRisk: number;
  score: number | null;
  constraints: string[];
  action: RecoverSupplierShortfallAction | null;
}

export interface SupplierShortfallAnalysis {
  calculatedAt: string;
  requestedUnits: number;
  confirmedUnits: number;
  shortfallUnits: number;
  requiredByDate: string;
  remainingBudget: number;
  currency: string;
  candidates: RecoveryCandidate[];
  recommendedCandidateId: string | null;
  summary: string;
}

export interface RecoveryActionProposal {
  proposalId: string;
  version: number;
  createdAt: string;
  validUntil: string;
  evidenceVersions: Record<keyof SupplierShortfallEvidence, string>;
  action: RecoverSupplierShortfallAction;
  actionFingerprint: string;
  idempotencyKey: string;
}

export interface RecoveryExecutionRecord {
  executionId: string;
  idempotencyKey: string;
  createdAt: string;
  action: RecoverSupplierShortfallAction;
  status: "COMPLETED";
}

export interface SupplierShortfallRecovery {
  status: "INVESTIGATING" | "AWAITING_APPROVAL" | "REVALIDATING" | "EXECUTING" | "COMPLETED" | "ESCALATED";
  evidence: SupplierShortfallEvidence;
  analysis: SupplierShortfallAnalysis;
  proposal: RecoveryActionProposal | null;
  approvedProposalVersion: number | null;
  execution: RecoveryExecutionRecord | null;
}

export interface PurchasingCase {
  id: string;
  eventType: "PURCHASE_RECOMMENDATION_CREATED" | "SUPPLIER_SHORTFALL_REPORTED";
  status: CaseStatus;
  priority: "HIGH" | "MEDIUM" | "LOW";
  createdAt: string;
  updatedAt: string;
  evidence: ScenarioOneEvidence;
  analysis: ScenarioAnalysis;
  proposal: ActionProposal | null;
  approvedProposalVersion: number | null;
  purchaseOrder: PurchaseOrderRecord | null;
  recovery: SupplierShortfallRecovery | null;
  timeline: TimelineEvent[];
}
