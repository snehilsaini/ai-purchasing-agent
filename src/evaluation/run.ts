import {
  FIXTURE_AS_OF,
  scenarioOneEvaluationSuite,
  scenarioTwoEvaluationSuite,
} from "@/evaluation/suite";
import { calculateSupplierShortfallRecovery } from "@/planning/recovery-plan";
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
console.info("Scenario 2 recovery evaluation");
console.info("--------------------------------");

const recoverySuite = scenarioTwoEvaluationSuite();
for (const evaluation of recoverySuite.evaluations) {
  const result = calculateSupplierShortfallRecovery(
    recoverySuite.purchasingCase,
    evaluation.evidence,
    FIXTURE_AS_OF,
  );
  const passed = result.recommendedCandidateId === evaluation.expectedCandidateId;
  if (!passed) failures += 1;
  console.info(
    `${passed ? "PASS" : "FAIL"}  ${evaluation.name} -> ${result.recommendedCandidateId ?? "ESCALATE"}`,
  );
}

console.info("--------------------------------");
if (failures > 0) {
  console.error(`${failures} evaluation case(s) failed.`);
  process.exitCode = 1;
} else {
  console.info("All 11 decision and recovery evaluation cases passed.");
}
