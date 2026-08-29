import { randomUUID } from "node:crypto";

import type {
  PurchasingCase,
  ScenarioOneEvidence,
  TimelineEvent,
} from "@/domain/purchasing";
import { scenarioOneBaseFixture, withEvidence } from "@/evaluation/fixtures";
import { createActionProposal } from "@/policies/action-proposal";
import { analyzeScenarioOne } from "@/workflows/analyze-scenario-one";

function addUtcDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

function timelineEvent(
  at: Date,
  type: TimelineEvent["type"],
  title: string,
  detail: string,
  actor: TimelineEvent["actor"],
): TimelineEvent {
  return { id: randomUUID(), at: at.toISOString(), type, title, detail, actor };
}

function makeEvidenceCurrent(evidence: ScenarioOneEvidence, asOf: Date): ScenarioOneEvidence {
  const observedAt = new Date(asOf.getTime() - 5 * 60_000).toISOString();
  const current = structuredClone(evidence);

  for (const key of Object.keys(current) as (keyof ScenarioOneEvidence)[]) {
    current[key].observedAt = observedAt;
  }

  current.openPurchaseOrders.value = current.openPurchaseOrders.value.map((po) => ({
    ...po,
    expectedDeliveryDate: addUtcDays(asOf, 4),
  }));
  return current;
}

export function createPurchasingCase(input: {
  id: string;
  evidence: ScenarioOneEvidence;
  now: Date;
  priority?: PurchasingCase["priority"];
}): PurchasingCase {
  const analysis = analyzeScenarioOne(input.evidence, input.now);
  const proposal = analysis.decision.proposedAction
    ? createActionProposal({
      caseId: input.id,
      action: analysis.decision.proposedAction,
      evidence: input.evidence,
      version: 1,
      now: input.now,
    })
    : null;
  const status = proposal
    ? "AWAITING_APPROVAL"
    : analysis.decision.decision === "INVESTIGATE_FURTHER"
      ? "ESCALATED"
      : "COMPLETED";
  const createdAt = new Date(input.now.getTime() - 2 * 60_000);
  const evidenceAt = new Date(input.now.getTime() - 60_000);
  const recommendation = input.evidence.recommendation.value;

  return {
    id: input.id,
    eventType: "PURCHASE_RECOMMENDATION_CREATED",
    status,
    priority: input.priority ?? "MEDIUM",
    createdAt: createdAt.toISOString(),
    updatedAt: input.now.toISOString(),
    evidence: structuredClone(input.evidence),
    analysis,
    proposal,
    approvedProposalVersion: null,
    purchaseOrder: null,
    recovery: null,
    timeline: [
      timelineEvent(
        createdAt,
        "CASE_CREATED",
        "Recommendation received",
        `${recommendation.quantity} units requested for ${recommendation.nodeName}.`,
        "SYSTEM",
      ),
      timelineEvent(
        evidenceAt,
        "EVIDENCE_GATHERED",
        "Operational evidence gathered",
        "Inventory, demand, inbound supply, supplier, budget, storage, and product policy were retrieved.",
        "AGENT",
      ),
      timelineEvent(
        input.now,
        "DECISION_RECORDED",
        `${analysis.decision.decision.replace("_", " ")} decision recorded`,
        analysis.decision.summary,
        "AGENT",
      ),
    ],
  };
}

export function createDemoCases(asOf = new Date()): PurchasingCase[] {
  const base = makeEvidenceCurrent(scenarioOneBaseFixture(), asOf);
  const modify = createPurchasingCase({
    id: "CASE-1042",
    evidence: base,
    now: asOf,
    priority: "HIGH",
  });

  const acceptEvidence = withEvidence(base, "recommendation", {
    value: {
      ...base.recommendation.value,
      recommendationId: "REC-1043",
      quantity: 450,
    },
    version: "recommendation-engine-v2",
  });
  const accept = createPurchasingCase({
    id: "CASE-1043",
    evidence: acceptEvidence,
    now: new Date(asOf.getTime() - 5 * 60_000),
  });

  const rejectEvidence = withEvidence(base, "inventory", {
    value: { ...base.inventory.value, onHandUnits: 1_000 },
    version: "warehouse-management-system-v2",
  });
  const reject = createPurchasingCase({
    id: "CASE-1044",
    evidence: rejectEvidence,
    now: new Date(asOf.getTime() - 12 * 60_000),
    priority: "LOW",
  });

  const staleEvidence = withEvidence(base, "inventory", {
    observedAt: new Date(asOf.getTime() - 3 * 60 * 60_000).toISOString(),
    version: "warehouse-management-system-stale",
  });
  const investigate = createPurchasingCase({
    id: "CASE-1045",
    evidence: staleEvidence,
    now: new Date(asOf.getTime() - 20 * 60_000),
    priority: "HIGH",
  });

  return [modify, accept, reject, investigate];
}
