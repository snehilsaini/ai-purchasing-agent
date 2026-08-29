import { describe, expect, it } from "vitest";

import {
  FIXTURE_AS_OF,
  scenarioOneEvaluationSuite,
  scenarioTwoEvaluationSuite,
} from "@/evaluation/suite";
import { calculateSupplierShortfallRecovery } from "@/planning/recovery-plan";
import { analyzeScenarioOne } from "@/workflows/analyze-scenario-one";

describe("Scenario 1 decision evaluation suite", () => {
  for (const evaluation of scenarioOneEvaluationSuite()) {
    it(evaluation.name, () => {
      const result = analyzeScenarioOne(evaluation.evidence, FIXTURE_AS_OF);
      expect(result.decision.decision).toBe(evaluation.expectedDecision);
      expect(result.decision.recommendedQuantity).toBe(evaluation.expectedQuantity);
    });
  }
});

describe("Scenario 2 recovery evaluation suite", () => {
  const { purchasingCase, evaluations } = scenarioTwoEvaluationSuite();
  for (const evaluation of evaluations) {
    it(evaluation.name, () => {
      const result = calculateSupplierShortfallRecovery(
        purchasingCase,
        evaluation.evidence,
        FIXTURE_AS_OF,
      );
      expect(result.recommendedCandidateId).toBe(evaluation.expectedCandidateId);
    });
  }
});
