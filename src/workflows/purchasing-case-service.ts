import { randomUUID } from "node:crypto";

import type {
  PurchasingCase,
  PurchaseOrderRecord,
  TimelineEvent,
} from "@/domain/purchasing";
import type { CaseRepository } from "@/repositories/case-repository";
import { CaseNotFoundError, CaseRevisionConflictError } from "@/repositories/case-repository";
import {
  createActionProposal,
  describeMaterialChanges,
  fingerprintAction,
} from "@/policies/action-proposal";
import { analyzeScenarioOne } from "@/workflows/analyze-scenario-one";

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_STATE" | "INVALID_REQUEST",
    public readonly status: number,
  ) {
    super(message);
  }
}

function event(
  now: Date,
  type: TimelineEvent["type"],
  title: string,
  detail: string,
  actor: TimelineEvent["actor"],
): TimelineEvent {
  return { id: randomUUID(), at: now.toISOString(), type, title, detail, actor };
}

export class PurchasingCaseService {
  constructor(private readonly repository: CaseRepository) {}

  listCases(): Promise<PurchasingCase[]> {
    return this.repository.list();
  }

  async getCase(caseId: string): Promise<PurchasingCase> {
    const found = await this.repository.get(caseId);
    if (!found) throw new WorkflowError(`Case ${caseId} was not found.`, "NOT_FOUND", 404);
    return found;
  }

  async approve(input: {
    caseId: string;
    proposalVersion: number;
    buyerId: string;
    now?: Date;
  }): Promise<PurchasingCase> {
    const now = input.now ?? new Date();

    try {
      return await this.repository.mutate(input.caseId, (current) => {
        if (
          current.status === "COMPLETED"
          && current.approvedProposalVersion === input.proposalVersion
          && current.purchaseOrder
        ) {
          return current;
        }

        if (!current.proposal) {
          throw new WorkflowError("This case has no action awaiting approval.", "INVALID_STATE", 409);
        }

        if (current.proposal.version !== input.proposalVersion) {
          throw new WorkflowError(
            `Proposal v${input.proposalVersion} is no longer current. Review v${current.proposal.version} before approving.`,
            "CONFLICT",
            409,
          );
        }

        if (current.status !== "AWAITING_APPROVAL") {
          throw new WorkflowError(`Case is ${current.status}, not awaiting approval.`, "INVALID_STATE", 409);
        }

        const approvedProposal = current.proposal;
        current.status = "REVALIDATING";
        current.approvedProposalVersion = approvedProposal.version;
        current.timeline.push(event(
          now,
          "APPROVAL_RECORDED",
          `Proposal v${approvedProposal.version} approved`,
          `${input.buyerId} approved exactly ${approvedProposal.action.quantity} units from ${approvedProposal.action.supplierId}.`,
          "BUYER",
        ));

        const refreshedAnalysis = analyzeScenarioOne(current.evidence, now);
        current.analysis = refreshedAnalysis;
        const refreshedAction = refreshedAnalysis.decision.proposedAction;
        const expired = now.getTime() > new Date(approvedProposal.validUntil).getTime();
        const changed = refreshedAction
          ? fingerprintAction(refreshedAction) !== approvedProposal.actionFingerprint
          : true;

        if (expired || changed) {
          const reasons = refreshedAction
            ? describeMaterialChanges(approvedProposal.action, refreshedAction)
            : [refreshedAnalysis.decision.summary];
          if (expired) reasons.unshift("The proposal validity window expired before execution.");

          current.timeline.push(event(
            now,
            "REVALIDATION_FAILED",
            "Approval stopped by revalidation",
            reasons.join(" "),
            "SYSTEM",
          ));

          current.approvedProposalVersion = null;
          if (refreshedAction) {
            current.proposal = createActionProposal({
              caseId: current.id,
              action: refreshedAction,
              evidence: current.evidence,
              version: approvedProposal.version + 1,
              now,
            });
            current.status = "AWAITING_APPROVAL";
          } else {
            current.proposal = null;
            current.status = refreshedAnalysis.decision.decision === "INVESTIGATE_FURTHER"
              ? "ESCALATED"
              : "COMPLETED";
          }
          current.updatedAt = now.toISOString();
          return current;
        }

        current.timeline.push(event(
          now,
          "REVALIDATION_PASSED",
          "Live data revalidation passed",
          "Quantity, supplier, cost, delivery date, evidence freshness, and constraints still match the approved proposal.",
          "SYSTEM",
        ));
        current.status = "EXECUTING";

        const existingOrder = current.purchaseOrder?.idempotencyKey === approvedProposal.idempotencyKey
          ? current.purchaseOrder
          : null;
        const purchaseOrder: PurchaseOrderRecord = existingOrder ?? {
          purchaseOrderId: `PO-${randomUUID().slice(0, 8).toUpperCase()}`,
          idempotencyKey: approvedProposal.idempotencyKey,
          createdAt: now.toISOString(),
          status: "SUBMITTED",
          requested: approvedProposal.action,
          confirmedQuantity: null,
          confirmedDeliveryDate: null,
        };
        current.purchaseOrder = purchaseOrder;
        current.timeline.push(event(
          now,
          "ACTION_EXECUTED",
          existingOrder ? "Existing purchase order reused" : "Purchase order submitted",
          `${purchaseOrder.purchaseOrderId} requests ${purchaseOrder.requested.quantity} units; idempotency prevents duplicate creation.`,
          "SYSTEM",
        ));
        current.status = "VALIDATING";

        const exactMatch = fingerprintAction(purchaseOrder.requested) === approvedProposal.actionFingerprint;
        if (!exactMatch) {
          current.status = "RECOVERY_REQUIRED";
          current.timeline.push(event(
            now,
            "RECOVERY_CREATED",
            "Purchase order validation failed",
            "The created purchase order does not exactly match the approved action.",
            "SYSTEM",
          ));
        } else {
          current.status = "COMPLETED";
          current.timeline.push(event(
            now,
            "OUTCOME_VALIDATED",
            "Purchase order validated",
            "The order exists exactly once and product, node, supplier, quantity, price, and delivery date match approval.",
            "SYSTEM",
          ));
        }
        current.updatedAt = now.toISOString();
        return current;
      });
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      if (error instanceof CaseNotFoundError) {
        throw new WorkflowError(error.message, "NOT_FOUND", 404);
      }
      if (error instanceof CaseRevisionConflictError) {
        throw new WorkflowError(error.message, "CONFLICT", 409);
      }
      throw error;
    }
  }

  async simulateInventoryChange(input: {
    caseId: string;
    onHandDelta: number;
    now?: Date;
  }): Promise<PurchasingCase> {
    const now = input.now ?? new Date();
    try {
      return await this.repository.mutate(input.caseId, (current) => {
        const inventory = current.evidence.inventory;
        inventory.value.onHandUnits = Math.max(0, inventory.value.onHandUnits + input.onHandDelta);
        inventory.observedAt = now.toISOString();
        inventory.version = `${inventory.version}-change-${now.getTime()}`;
        current.updatedAt = now.toISOString();
        return current;
      });
    } catch (error) {
      if (error instanceof CaseNotFoundError) {
        throw new WorkflowError(error.message, "NOT_FOUND", 404);
      }
      if (error instanceof CaseRevisionConflictError) {
        throw new WorkflowError(error.message, "CONFLICT", 409);
      }
      throw error;
    }
  }

  async recordSupplierConfirmation(input: {
    caseId: string;
    confirmedQuantity: number;
    confirmedDeliveryDate?: string;
    now?: Date;
  }): Promise<PurchasingCase> {
    const now = input.now ?? new Date();
    try {
      return await this.repository.mutate(input.caseId, (current) => {
        if (!current.purchaseOrder) {
          throw new WorkflowError("No purchase order exists for supplier confirmation.", "INVALID_STATE", 409);
        }

        const requestedQuantity = current.purchaseOrder.requested.quantity;
        current.purchaseOrder.confirmedQuantity = input.confirmedQuantity;
        current.purchaseOrder.confirmedDeliveryDate = input.confirmedDeliveryDate
          ?? current.purchaseOrder.requested.expectedDeliveryDate;

        if (input.confirmedQuantity < requestedQuantity) {
          current.purchaseOrder.status = "PARTIALLY_CONFIRMED";
          current.status = "RECOVERY_REQUIRED";
          current.timeline.push(event(
            now,
            "RECOVERY_CREATED",
            "Supplier shortfall created a recovery case",
            `Supplier confirmed ${input.confirmedQuantity} of ${requestedQuantity} units. The ${requestedQuantity - input.confirmedQuantity}-unit shortfall becomes a SUPPLIER_SHORTFALL_REPORTED event.`,
            "SUPPLIER",
          ));
        } else {
          current.purchaseOrder.status = "CONFIRMED";
          current.status = "COMPLETED";
          current.timeline.push(event(
            now,
            "OUTCOME_VALIDATED",
            "Supplier confirmed the full order",
            `${input.confirmedQuantity} units are confirmed for ${current.purchaseOrder.confirmedDeliveryDate}.`,
            "SUPPLIER",
          ));
        }
        current.updatedAt = now.toISOString();
        return current;
      });
    } catch (error) {
      if (error instanceof WorkflowError) throw error;
      if (error instanceof CaseNotFoundError) {
        throw new WorkflowError(error.message, "NOT_FOUND", 404);
      }
      if (error instanceof CaseRevisionConflictError) {
        throw new WorkflowError(error.message, "CONFLICT", 409);
      }
      throw error;
    }
  }
}
