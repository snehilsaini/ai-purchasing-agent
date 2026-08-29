# Test scenarios and evaluation approach

## Evaluation goal

The evaluation checks the complete decision trajectory, not the wording of an AI-generated explanation. A case passes only when the deterministic decision category and quantity are correct for the supplied evidence. Workflow tests then verify approval, execution, validation, idempotency, and recovery behavior.

This directly addresses the assignment questions:

- Was the decision correct?
- Did the agent obtain the necessary information?
- Were freshness and operational constraints respected?
- Was the appropriate action taken?
- Was the result validated?
- What happened when the initial action did not work as expected?

## Reproducibility

Evaluation fixtures use a fixed clock (`2026-08-29T10:00:00.000Z`) and typed evidence. The deterministic planner acts as the decision oracle; OpenAI output is not used to score correctness.

Run the verification suite with:

```bash
npm run typecheck
npm run lint
npm test
npm run eval
npm run build
```

For the PostgreSQL adapter:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run db:smoke
```

## Decision evaluation suite

The standalone suite contains eight cases in [`src/evaluation/suite.ts`](../src/evaluation/suite.ts).

| Case | Evidence variation | Expected decision | Expected quantity | What it proves |
| --- | --- | --- | ---: | --- |
| Modify for confirmed inbound | Base recommendation is 800; usable stock 200; confirmed inbound 300; demand plus safety stock 950 | `MODIFY` | 450 | The upstream recommendation is independently challenged |
| Accept a correct recommendation | Original recommendation is changed to the independently required 450 | `ACCEPT` | 450 | Correct upstream recommendations are preserved |
| Reject when already covered | On-hand inventory increases to 1,000 units | `REJECT` | 0 | Existing and inbound stock prevent unnecessary purchasing |
| Investigate stale inventory | Inventory was observed two hours before the evaluation time | `INVESTIGATE_FURTHER` | 0 | Unsafe evidence blocks action |
| Raise a small need to MOQ | Raw requirement is 30 units; supplier MOQ is 100 | `MODIFY` | 100 | Minimum-order rules are respected |
| Block an unaffordable MOQ | Available budget is INR 10,000; MOQ costs INR 12,000 | `INVESTIGATE_FURTHER` | 0 | The agent refuses an infeasible purchase |
| Cap at available storage | Storage capacity is reduced to 300 units | `MODIFY` | 300 | Storage limits constrain the action |
| Cap perishable exposure | Expiry policy caps the order at 400 units | `MODIFY` | 400 | Shelf-life risk constrains overbuying |

The command-line evaluator prints a PASS/FAIL line for every case and exits non-zero if any expected decision or quantity differs.

## Automated test coverage

The repository currently contains 18 Vitest tests across four files.

### Planning and decision tests

[`src/workflows/analyze-scenario-one.test.ts`](../src/workflows/analyze-scenario-one.test.ts) verifies:

- 800 is modified to 450 using usable inventory and confirmed inbound;
- a correct 450-unit recommendation is accepted;
- a covered requirement is rejected;
- stale critical evidence produces investigation rather than action;
- MOQ and pack rules adjust the quantity;
- an unaffordable MOQ blocks the purchase.

### Decision evaluation tests

[`src/evaluation/suite.test.ts`](../src/evaluation/suite.test.ts) executes all eight table-driven cases above and asserts the decision and recommended quantity.

### Approval and feedback-loop tests

[`src/workflows/purchasing-case-service.test.ts`](../src/workflows/purchasing-case-service.test.ts) verifies:

| Workflow behavior | Assertion |
| --- | --- |
| Normal approval | Revalidation passes, exactly one 450-unit PO is created, and the case completes |
| Approval retry | The same PO ID is returned and only one execution event exists |
| Material inventory change | Proposal v1 is stopped, proposal v2 requests 350 units, and no PO is created before fresh approval |
| Supplier shortfall | A 300-of-450 confirmation produces `PARTIALLY_CONFIRMED` and `RECOVERY_REQUIRED` |

### AI-boundary and tool-selection tests

[`src/agent/purchasing-briefing.test.ts`](../src/agent/purchasing-briefing.test.ts) verifies that all eight mandatory evidence reads appear first in the trace, policy-selected optional reads are labelled, and the deterministic fallback returns the correct 450-unit buyer action without an API key.

[`src/agent/investigation-tools.test.ts`](../src/agent/investigation-tools.test.ts) verifies the mandatory evidence gate, case-dependent optional selection, successful model-selected execution, and rejection of unknown, malformed, mismatched-case, duplicate, and over-limit calls.

The live OpenAI call is intentionally not a required unit test. This avoids network, credential, cost, and model-availability dependencies in the correctness suite. Structured Output validation and deterministic fallback protect the runtime path.

## Manual end-to-end evaluation

The repeatable browser demonstration is documented in [Three-minute interview demo](demo-script.md):

1. reset the four cases;
2. inspect the 800-to-450 `MODIFY` calculation;
3. generate either the OpenAI or fallback briefing;
4. change inventory before approval;
5. verify proposal v1 is superseded by v2 and no PO is created;
6. approve v2 and observe exact validation;
7. simulate a supplier shortfall and observe recovery.

The remaining queue items visually demonstrate `ACCEPT`, `REJECT`, and `INVESTIGATE_FURTHER`.

## Validation oracle

The evaluation does not ask an LLM to judge another LLM. Expected decisions and quantities are explicit fixture assertions derived from the purchasing formula and hard constraints. This makes regressions visible and repeatable.

For action validation, the workflow checks:

- expected proposal version;
- proposal validity window;
- unchanged action fingerprint after recalculation;
- idempotency key reuse;
- exact approved PO fields;
- supplier-confirmed quantity;
- transition to recovery when the result differs.

## Current verified result

Last verified on 2026-08-29:

- TypeScript check: passed;
- ESLint: passed;
- Vitest: 22/22 passed;
- standalone decision evaluation: 8/8 passed;
- production build: passed;
- PostgreSQL migration, seed, approval, and read-back smoke path: passed locally.

The production build and unit suite do not require an OpenAI key or PostgreSQL. PostgreSQL smoke verification requires the Docker service, and live AI briefing verification requires a valid OpenAI API key.

## Known evaluation limits

- Operational integrations are mocks rather than contract tests against company systems.
- The live OpenAI response is schema-validated but not scored for tool-selection or prose quality in CI; registry execution and guardrails are tested deterministically.
- Immediate PO validation uses the mock stored PO payload rather than a separate external PO service.
- A supplier shortfall enters recovery, but alternate sourcing is intentionally deferred to Scenario 2.
- Browser-level CI is a future extension; the current UI flow is covered by a documented manual demonstration plus service-level tests.
