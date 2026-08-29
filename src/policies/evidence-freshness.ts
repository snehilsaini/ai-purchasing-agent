import {
  scenarioOneEvidenceSchema,
  type EvidenceIssue,
  type ScenarioOneEvidence,
} from "@/domain/purchasing";

export function evaluateEvidence(
  candidate: ScenarioOneEvidence,
  asOf: Date,
): EvidenceIssue[] {
  const parsed = scenarioOneEvidenceSchema.safeParse(candidate);

  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      key: (issue.path[0] ?? "recommendation") as keyof ScenarioOneEvidence,
      reason: "INVALID" as const,
      detail: issue.message,
    }));
  }

  const issues: EvidenceIssue[] = [];
  const entries = Object.entries(parsed.data) as [
    keyof ScenarioOneEvidence,
    ScenarioOneEvidence[keyof ScenarioOneEvidence],
  ][];

  for (const [key, evidence] of entries) {
    const observedAt = new Date(evidence.observedAt);
    const ageMinutes = (asOf.getTime() - observedAt.getTime()) / 60_000;

    if (!Number.isFinite(ageMinutes)) {
      issues.push({ key, reason: "INVALID", detail: "Evidence timestamp is invalid." });
    } else if (ageMinutes > evidence.maxAgeMinutes) {
      issues.push({
        key,
        reason: "STALE",
        detail: `Observed ${Math.floor(ageMinutes)} minutes ago; maximum age is ${evidence.maxAgeMinutes} minutes.`,
      });
    }
  }

  return issues;
}
