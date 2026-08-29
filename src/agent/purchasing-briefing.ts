import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { PurchasingCase, ScenarioOneEvidence } from "@/domain/purchasing";

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

export interface InvestigationToolRead {
  tool: string;
  source: string;
  observedAt: string;
  evidenceVersion: string;
}

export interface AgentBriefing extends BriefingContent {
  mode: "OPENAI" | "DETERMINISTIC_FALLBACK";
  model: string | null;
  generatedAt: string;
  investigationTrace: InvestigationToolRead[];
  fallbackReason?: string;
}

interface ReadOnlyEvidenceTool {
  name: string;
  evidenceKey: keyof ScenarioOneEvidence;
}

const scenarioOneTools: ReadOnlyEvidenceTool[] = [
  { name: "get_recommendation", evidenceKey: "recommendation" },
  { name: "get_inventory_position", evidenceKey: "inventory" },
  { name: "get_demand_forecast", evidenceKey: "demand" },
  { name: "get_open_purchase_orders", evidenceKey: "openPurchaseOrders" },
  { name: "get_supplier_terms", evidenceKey: "supplier" },
  { name: "get_available_budget", evidenceKey: "budget" },
  { name: "get_storage_capacity", evidenceKey: "storage" },
  { name: "get_product_policy", evidenceKey: "productPolicy" },
];

function runReadOnlyInvestigation(purchasingCase: PurchasingCase) {
  const toolResults = scenarioOneTools.map((tool) => {
    const evidence = purchasingCase.evidence[tool.evidenceKey];
    return {
      tool: tool.name,
      evidenceKey: tool.evidenceKey,
      source: evidence.source,
      observedAt: evidence.observedAt,
      evidenceVersion: evidence.version,
      result: evidence.value,
    };
  });

  return {
    toolResults,
    trace: toolResults.map(({ tool, source, observedAt, evidenceVersion }) => ({
      tool,
      source,
      observedAt,
      evidenceVersion,
    })),
  };
}

function deterministicBriefing(purchasingCase: PurchasingCase): BriefingContent {
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
  const investigation = runReadOnlyInvestigation(purchasingCase);
  const fallback = deterministicBriefing(purchasingCase);

  if (!apiKey) {
    return {
      ...fallback,
      mode: "DETERMINISTIC_FALLBACK",
      model: null,
      generatedAt: now.toISOString(),
      investigationTrace: investigation.trace,
      fallbackReason: "OPENAI_API_KEY is not configured.",
    };
  }

  try {
    const client = new OpenAI({ apiKey });
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
        readOnlyToolResults: investigation.toolResults,
        deterministicAnalysis: purchasingCase.analysis,
        proposal: purchasingCase.proposal,
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
      investigationTrace: investigation.trace,
    };
  } catch (error) {
    console.error("OpenAI briefing generation failed; using deterministic fallback.", error);
    return {
      ...fallback,
      mode: "DETERMINISTIC_FALLBACK",
      model: null,
      generatedAt: now.toISOString(),
      investigationTrace: investigation.trace,
      fallbackReason: "The OpenAI request was unavailable or did not pass schema validation.",
    };
  }
}
