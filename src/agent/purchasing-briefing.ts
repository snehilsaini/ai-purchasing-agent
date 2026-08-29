import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  executeOptionalToolCalls,
  optionalToolDefinitionsForCase,
  policySelectedOptionalCalls,
  runMandatoryInvestigation,
  type InvestigationToolRead,
  type OptionalToolCall,
} from "@/agent/investigation-tools";
import type { PurchasingCase } from "@/domain/purchasing";

const briefingContentSchema = z.object({
  headline: z.string().min(1).max(120),
  executiveSummary: z.string().min(1).max(700),
  evidenceInsights: z.array(z.object({
    label: z.string().min(1).max(60),
    insight: z.string().min(1).max(240),
  })).min(2).max(5),
  riskFlags: z.array(z.string().min(1).max(200)).max(4),
  buyerAction: z.string().min(1).max(240),
});

export type BriefingContent = z.infer<typeof briefingContentSchema>;

export interface AgentBriefing extends BriefingContent {
  mode: "OPENAI" | "DETERMINISTIC_FALLBACK";
  model: string | null;
  generatedAt: string;
  investigationTrace: InvestigationToolRead[];
  rejectedToolCalls: string[];
  fallbackReason?: string;
}

function withoutResults(toolResults: ReturnType<typeof runMandatoryInvestigation>): InvestigationToolRead[] {
  return toolResults.map((item) => ({
    tool: item.tool,
    source: item.source,
    observedAt: item.observedAt,
    evidenceVersion: item.evidenceVersion,
    selection: item.selection,
    rationale: item.rationale,
  }));
}

async function selectOptionalTools(
  client: OpenAI,
  model: string,
  purchasingCase: PurchasingCase,
): Promise<OptionalToolCall[]> {
  const response = await client.responses.create({
    model,
    store: false,
    parallel_tool_calls: true,
    tool_choice: "required",
    tools: optionalToolDefinitionsForCase(purchasingCase),
    instructions: [
      "You are selecting additional read-only investigation tools for a retail purchasing case.",
      "Choose only tools that materially help explain risk, uncertainty, timing, or constraints in this specific case.",
      "Do not make a purchasing decision and do not request any write action.",
      "Use the exact caseId supplied. Keep each rationale concise and evidence-focused.",
    ].join(" "),
    input: JSON.stringify({
      caseId: purchasingCase.id,
      eventType: purchasingCase.eventType,
      deterministicDecision: purchasingCase.recovery?.analysis ?? purchasingCase.analysis.decision,
      planningSignals: {
        baselineStockoutDate: purchasingCase.analysis.plan?.baselineStockoutDate ?? null,
        proposedStockoutDate: purchasingCase.analysis.plan?.proposedStockoutDate ?? null,
        residualShortageUnits: purchasingCase.analysis.plan?.residualShortageUnits ?? null,
        constraints: purchasingCase.analysis.plan?.constraints ?? [],
      },
      evidenceSignals: {
        forecastConfidence: purchasingCase.evidence.demand.value.forecastConfidence,
        dailyDemandCurveAvailable: Boolean(purchasingCase.evidence.demand.value.dailyUnits?.length),
        openPurchaseOrderCount: purchasingCase.evidence.openPurchaseOrders.value.length,
        supplierReliability: purchasingCase.evidence.supplier.value.deliveryReliability,
        shelfLifeDays: purchasingCase.evidence.productPolicy.value.shelfLifeDays ?? null,
        maxOrderUnitsBeforeExpiry:
          purchasingCase.evidence.productPolicy.value.maxOrderUnitsBeforeExpiry ?? null,
      },
      recoverySignals: purchasingCase.recovery
        ? {
          shortfallUnits: purchasingCase.recovery.analysis.shortfallUnits,
          remainingBudget: purchasingCase.recovery.analysis.remainingBudget,
          requiredByDate: purchasingCase.recovery.analysis.requiredByDate,
          candidateCount: purchasingCase.recovery.analysis.candidates.length,
          recommendedCandidateId: purchasingCase.recovery.analysis.recommendedCandidateId,
        }
        : null,
    }),
  });

  return response.output.flatMap((item) => item.type === "function_call"
    ? [{ name: item.name, arguments: item.arguments }]
    : []);
}

function deterministicBriefing(purchasingCase: PurchasingCase): BriefingContent {
  if (purchasingCase.recovery) {
    const recovery = purchasingCase.recovery;
    const analysis = recovery.analysis;
    const recommended = analysis.candidates.find(
      (candidate) => candidate.candidateId === analysis.recommendedCandidateId,
    );
    const action = recovery.proposal?.action ?? recommended?.action ?? null;
    const allocationSummary = action
      ? [
        ...action.transfers.map((transfer) =>
          `${transfer.quantity} units from ${transfer.sourceNodeId}`),
        ...action.supplierOrders.map((order) =>
          `${order.quantity} units from ${order.supplierId}`),
      ].join(" and ")
      : "no feasible allocation";

    return {
      headline: recommended
        ? `Recover the ${analysis.shortfallUnits}-unit supplier shortfall`
        : "Escalate the uncovered supplier shortfall",
      executiveSummary: analysis.summary,
      evidenceInsights: [
        {
          label: "Supplier response",
          insight: `${analysis.confirmedUnits} of ${analysis.requestedUnits} units were confirmed, leaving ${analysis.shortfallUnits} units uncovered.`,
        },
        {
          label: "Options evaluated",
          insight: `${analysis.candidates.length} supplier, transfer, and split candidates were checked; ${analysis.candidates.filter((candidate) => candidate.feasible).length} are feasible.`,
        },
        {
          label: "Recommended allocation",
          insight: recommended
            ? `${recommended.label} covers ${recommended.coveredUnits} units for ${recommended.currency} ${recommended.totalCost}, arriving by ${recommended.latestArrivalDate}.`
            : "No option currently satisfies full coverage, timing, capacity, and remaining-budget constraints.",
        },
      ],
      riskFlags: recommended
        ? [`Estimated service risk is ${(recommended.serviceRisk * 100).toFixed(1)}%; availability will be revalidated before execution.`]
        : ["The shortfall remains uncovered and requires manual escalation."],
      buyerAction: recovery.proposal
        ? `Review and approve recovery proposal v${recovery.proposal.version}: ${allocationSummary}. Live availability will be revalidated before execution.`
        : "Escalate to the purchasing lead; no recovery action is currently safe to execute.",
    };
  }

  const decision = purchasingCase.analysis.decision;
  const plan = purchasingCase.analysis.plan;
  const action = decision.proposedAction;
  const headline = decision.decision === "MODIFY"
    ? `Reduce the proposed order to ${decision.recommendedQuantity} units`
    : decision.decision === "ACCEPT"
      ? `Proceed with ${decision.recommendedQuantity} units after approval`
      : decision.decision === "REJECT"
        ? "No additional purchase is justified"
        : "Pause and refresh critical evidence";

  return {
    headline,
    executiveSummary: decision.summary,
    evidenceInsights: decision.importantFactors.slice(0, 4).map((insight, index) => ({
      label: ["Supply position", "Calculated need", "Projected outcome", "Risk check"][index]
        ?? `Factor ${index + 1}`,
      insight,
    })),
    riskFlags: [
      ...(plan?.proposedStockoutDate
        ? [`A temporary stockout remains projected on ${plan.proposedStockoutDate}.`]
        : []),
      ...(plan?.residualShortageUnits
        ? [`${plan.residualShortageUnits} required units remain uncovered.`]
        : []),
    ],
    buyerAction: action
      ? `Review and approve proposal v${purchasingCase.proposal?.version ?? 1} for exactly ${action.quantity} units. Live data will be revalidated before execution.`
      : decision.decision === "INVESTIGATE_FURTHER"
        ? "Refresh the flagged evidence before making a purchasing commitment."
        : "Record the no-purchase outcome; no approval or PO creation is required.",
  };
}

export async function generatePurchasingBriefing(
  purchasingCase: PurchasingCase,
  options: { apiKey?: string; model?: string; now?: Date } = {},
): Promise<AgentBriefing> {
  const now = options.now ?? new Date();
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const mandatoryResults = runMandatoryInvestigation(purchasingCase);
  const fallback = deterministicBriefing(purchasingCase);

  if (!apiKey) {
    const optionalInvestigation = executeOptionalToolCalls(
      purchasingCase,
      policySelectedOptionalCalls(purchasingCase),
      "POLICY_SELECTED",
    );
    const toolResults = [...mandatoryResults, ...optionalInvestigation.results];
    return {
      ...fallback,
      mode: "DETERMINISTIC_FALLBACK",
      model: null,
      generatedAt: now.toISOString(),
      investigationTrace: withoutResults(toolResults),
      rejectedToolCalls: optionalInvestigation.rejectedCalls,
      fallbackReason: "OPENAI_API_KEY is not configured.",
    };
  }

  let toolResults = mandatoryResults;
  let rejectedToolCalls: string[] = [];

  try {
    const client = new OpenAI({ apiKey });
    const requestedTools = await selectOptionalTools(client, model, purchasingCase);
    const optionalInvestigation = executeOptionalToolCalls(
      purchasingCase,
      requestedTools,
      "MODEL_SELECTED",
    );
    toolResults = [...mandatoryResults, ...optionalInvestigation.results];
    rejectedToolCalls = optionalInvestigation.rejectedCalls;

    const response = await client.responses.parse({
      model,
      store: false,
      instructions: [
        "You are an expert retail purchasing investigator writing a concise buyer briefing.",
        "Use only the supplied read-only tool results and deterministic analysis.",
        "Never recalculate, override, or invent the decision, quantity, supplier, cost, or date.",
        "Call out missing evidence, stale evidence, residual shortages, or stockout risk when present.",
        "The buyer—not the model—authorises purchasing spend.",
      ].join(" "),
      input: JSON.stringify({
        caseId: purchasingCase.id,
        eventType: purchasingCase.eventType,
        readOnlyToolResults: toolResults,
        rejectedToolCalls,
        deterministicAnalysis: purchasingCase.recovery?.analysis ?? purchasingCase.analysis,
        proposal: purchasingCase.recovery?.proposal ?? purchasingCase.proposal,
      }),
      text: {
        format: zodTextFormat(briefingContentSchema, "purchasing_buyer_briefing"),
      },
    });

    if (!response.output_parsed) {
      throw new Error("The model returned no structured briefing.");
    }

    return {
      ...response.output_parsed,
      mode: "OPENAI",
      model,
      generatedAt: now.toISOString(),
      investigationTrace: withoutResults(toolResults),
      rejectedToolCalls,
    };
  } catch (error) {
    console.error("OpenAI briefing generation failed; using deterministic fallback.", error);
    if (toolResults.length === mandatoryResults.length) {
      const policyInvestigation = executeOptionalToolCalls(
        purchasingCase,
        policySelectedOptionalCalls(purchasingCase),
        "POLICY_SELECTED",
      );
      toolResults = [...mandatoryResults, ...policyInvestigation.results];
      rejectedToolCalls = [...rejectedToolCalls, ...policyInvestigation.rejectedCalls];
    }
    return {
      ...fallback,
      mode: "DETERMINISTIC_FALLBACK",
      model: null,
      generatedAt: now.toISOString(),
      investigationTrace: withoutResults(toolResults),
      rejectedToolCalls,
      fallbackReason: "The OpenAI request was unavailable or did not pass schema validation.",
    };
  }
}
