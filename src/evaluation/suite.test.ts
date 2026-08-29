import { describe, expect, it } from "vitest";

import { FIXTURE_AS_OF, scenarioOneEvaluationSuite } from "@/evaluation/suite";
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
