import { FIXTURE_AS_OF, scenarioOneEvaluationSuite } from "@/evaluation/suite";
import { analyzeScenarioOne } from "@/workflows/analyze-scenario-one";

let failures = 0;

console.info("Scenario 1 decision evaluation");
console.info("--------------------------------");

for (const evaluation of scenarioOneEvaluationSuite()) {
  const result = analyzeScenarioOne(evaluation.evidence, FIXTURE_AS_OF);
  const passed = result.decision.decision === evaluation.expectedDecision
    && result.decision.recommendedQuantity === evaluation.expectedQuantity;
  if (!passed) failures += 1;

  console.info(
    `${passed ? "PASS" : "FAIL"}  ${evaluation.name} -> ${result.decision.decision} / ${result.decision.recommendedQuantity}`,
  );
}

console.info("--------------------------------");
if (failures > 0) {
  console.error(`${failures} evaluation case(s) failed.`);
  process.exitCode = 1;
} else {
  console.info("All 8 decision evaluation cases passed.");
}
