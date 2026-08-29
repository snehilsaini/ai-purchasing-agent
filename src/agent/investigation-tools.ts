import { z } from "zod";

import type { PurchasingCase, ScenarioOneEvidence } from "@/domain/purchasing";

export const MAX_OPTIONAL_TOOL_CALLS = 4;

export type InvestigationSelection = "MANDATORY" | "MODEL_SELECTED" | "POLICY_SELECTED";

export interface InvestigationToolRead {
  tool: string;
  source: string;
  observedAt: string;
  evidenceVersion: string;
  selection: InvestigationSelection;
  rationale: string;
}

export interface InvestigationToolResult extends InvestigationToolRead {
  result: unknown;
}

export interface OptionalToolCall {
  name: string;
  arguments: string;
}

interface MandatoryEvidenceTool {
  name: string;
  evidenceKey: keyof ScenarioOneEvidence;
}

interface OptionalEvidenceTool {
  name: string;
  description: string;
  evidenceKeys: (keyof ScenarioOneEvidence)[];
  read: (purchasingCase: PurchasingCase) => unknown;
}

const optionalToolArgumentsSchema = z.object({
  caseId: z.string().min(1),
  rationale: z.string().min(1).max(240),
}).strict();

const mandatoryTools: MandatoryEvidenceTool[] = [
  { name: "get_recommendation", evidenceKey: "recommendation" },
  { name: "get_inventory_position", evidenceKey: "inventory" },
  { name: "get_demand_forecast", evidenceKey: "demand" },
  { name: "get_open_purchase_orders", evidenceKey: "openPurchaseOrders" },
  { name: "get_supplier_terms", evidenceKey: "supplier" },
  { name: "get_available_budget", evidenceKey: "budget" },
  { name: "get_storage_capacity", evidenceKey: "storage" },
  { name: "get_product_policy", evidenceKey: "productPolicy" },
];

const optionalTools = {
  inspect_demand_curve: {
    name: "inspect_demand_curve",
    description: "Inspect daily forecast shape, peak demand, and forecast confidence when timing or volatility may affect the order.",
    evidenceKeys: ["demand"],
    read: (purchasingCase) => {
      const demand = purchasingCase.evidence.demand.value;
      const dailyUnits = demand.dailyUnits ?? [];
      return {
        protectionPeriodDays: demand.protectionPeriodDays,
        dailyUnits,
        peakDailyUnits: dailyUnits.length > 0 ? Math.max(...dailyUnits) : null,
        averageDailyUnits: dailyUnits.length > 0
          ? dailyUnits.reduce((sum, units) => sum + units, 0) / dailyUnits.length
          : null,
        forecastConfidence: demand.forecastConfidence,
      };
    },
  },
  inspect_inbound_schedule: {
    name: "inspect_inbound_schedule",
    description: "Inspect each open purchase order and its timing when confirmed, delayed, or duplicate inbound supply could change the need.",
    evidenceKeys: ["openPurchaseOrders"],
    read: (purchasingCase) => ({
      protectionEndDate: purchasingCase.analysis.plan?.protectionEndDate ?? null,
      purchaseOrders: purchasingCase.evidence.openPurchaseOrders.value,
      confirmedInboundUnits: purchasingCase.analysis.plan?.confirmedInboundUnits ?? null,
    }),
  },
  inspect_supplier_risk: {
    name: "inspect_supplier_risk",
    description: "Inspect supplier reliability, capacity, lead time, MOQ, and order multiple when fulfilment risk or constraints matter.",
    evidenceKeys: ["supplier"],
    read: (purchasingCase) => {
      const supplier = purchasingCase.evidence.supplier.value;
      return {
        supplierId: supplier.supplierId,
        leadTimeDays: supplier.leadTimeDays,
        deliveryReliability: supplier.deliveryReliability,
        availableCapacityUnits: supplier.availableCapacityUnits,
        minimumOrderQuantity: supplier.minimumOrderQuantity,
        orderMultiple: supplier.orderMultiple,
        requestedUnits: purchasingCase.analysis.decision.recommendedQuantity,
      };
    },
  },
  inspect_perishability_exposure: {
    name: "inspect_perishability_exposure",
    description: "Inspect shelf-life and expiry-related order limits when overbuy or waste risk may constrain the purchase.",
    evidenceKeys: ["productPolicy", "demand"],
    read: (purchasingCase) => ({
      ...purchasingCase.evidence.productPolicy.value,
      expectedDemandUnits: purchasingCase.evidence.demand.value.expectedUnits,
      proposedOrderUnits: purchasingCase.analysis.decision.recommendedQuantity,
    }),
  },
} satisfies Record<string, OptionalEvidenceTool>;

export type OptionalToolName = keyof typeof optionalTools;

export const optionalToolDefinitions = Object.values(optionalTools).map((tool) => ({
  type: "function" as const,
  name: tool.name,
  description: tool.description,
  strict: true,
  parameters: {
    type: "object" as const,
    properties: {
      caseId: {
        type: "string" as const,
        description: "The exact purchasing case identifier supplied in the investigation context.",
      },
      rationale: {
        type: "string" as const,
        description: "A concise explanation of why this additional evidence is useful for this case.",
      },
    },
    required: ["caseId", "rationale"],
    additionalProperties: false,
  },
}));

function traceMetadata(
  purchasingCase: PurchasingCase,
  evidenceKeys: (keyof ScenarioOneEvidence)[],
) {
  const evidence = evidenceKeys.map((key) => purchasingCase.evidence[key]);
  return {
    source: [...new Set(evidence.map((item) => item.source))].join(" + "),
    observedAt: evidence.map((item) => item.observedAt).sort()[0],
    evidenceVersion: evidence.map((item) => item.version).join(" + "),
  };
}

export function runMandatoryInvestigation(purchasingCase: PurchasingCase): InvestigationToolResult[] {
  return mandatoryTools.map((tool) => {
    const evidence = purchasingCase.evidence[tool.evidenceKey];
    return {
      tool: tool.name,
      source: evidence.source,
      observedAt: evidence.observedAt,
      evidenceVersion: evidence.version,
      selection: "MANDATORY",
      rationale: "Required by purchasing policy before any recommendation can be evaluated.",
      result: evidence.value,
    };
  });
}

export function policySelectedOptionalCalls(purchasingCase: PurchasingCase): OptionalToolCall[] {
  const calls: OptionalToolCall[] = [];
  const { evidence, analysis } = purchasingCase;

  if (evidence.demand.value.dailyUnits?.length || evidence.demand.value.forecastConfidence < 0.8) {
    calls.push({
      name: "inspect_demand_curve",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Inspect the demand shape and confidence behind the aggregate forecast.",
      }),
    });
  }

  if (evidence.openPurchaseOrders.value.length > 0) {
    calls.push({
      name: "inspect_inbound_schedule",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Confirm whether existing inbound supply arrives inside the protection period.",
      }),
    });
  }

  if (
    evidence.supplier.value.deliveryReliability < 0.9
    || analysis.plan?.residualShortageUnits
    || analysis.plan?.constraints.some((constraint) => constraint.code === "SUPPLIER_CAPACITY" && constraint.status !== "PASS")
  ) {
    calls.push({
      name: "inspect_supplier_risk",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Review fulfilment risk and supplier constraints affecting the proposed quantity.",
      }),
    });
  }

  if (
    evidence.productPolicy.value.shelfLifeDays
    || evidence.productPolicy.value.maxOrderUnitsBeforeExpiry !== undefined
  ) {
    calls.push({
      name: "inspect_perishability_exposure",
      arguments: JSON.stringify({
        caseId: purchasingCase.id,
        rationale: "Check whether the proposed quantity creates shelf-life or expiry exposure.",
      }),
    });
  }

  return calls.slice(0, MAX_OPTIONAL_TOOL_CALLS);
}

export function executeOptionalToolCalls(
  purchasingCase: PurchasingCase,
  calls: OptionalToolCall[],
  selection: Exclude<InvestigationSelection, "MANDATORY">,
): { results: InvestigationToolResult[]; rejectedCalls: string[] } {
  const results: InvestigationToolResult[] = [];
  const rejectedCalls: string[] = [];
  const executed = new Set<string>();

  for (const [index, call] of calls.entries()) {
    if (index >= MAX_OPTIONAL_TOOL_CALLS) {
      rejectedCalls.push(`${call.name}: optional tool-call limit exceeded`);
      continue;
    }

    const tool = optionalTools[call.name as OptionalToolName];
    if (!tool) {
      rejectedCalls.push(`${call.name}: tool is not in the approved read-only registry`);
      continue;
    }

    if (executed.has(tool.name)) {
      rejectedCalls.push(`${call.name}: duplicate tool call`);
      continue;
    }

    let rawArguments: unknown;
    try {
      rawArguments = JSON.parse(call.arguments);
    } catch {
      rejectedCalls.push(`${call.name}: arguments are not valid JSON`);
      continue;
    }

    const parsedArguments = optionalToolArgumentsSchema.safeParse(rawArguments);
    if (!parsedArguments.success || parsedArguments.data.caseId !== purchasingCase.id) {
      rejectedCalls.push(`${call.name}: arguments failed validation`);
      continue;
    }

    executed.add(tool.name);
    results.push({
      tool: tool.name,
      ...traceMetadata(purchasingCase, tool.evidenceKeys),
      selection,
      rationale: parsedArguments.data.rationale,
      result: tool.read(purchasingCase),
    });
  }

  return { results, rejectedCalls };
}
