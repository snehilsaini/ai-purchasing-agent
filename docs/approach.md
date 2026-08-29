# Solution approach

## Objective

The project implements two connected vertical slices. Scenario 1 challenges a purchase recommendation, obtains approval, executes a PO, and validates supplier response. Scenario 2 treats a partial supplier confirmation as a new event, evaluates alternate supply and transfers, proposes an exact recovery allocation, obtains fresh approval, revalidates, executes, and verifies recovery.

The upstream recommendation is treated as an input to challenge, not as a trusted answer. The core design goal is an explainable and reliable purchasing workflow rather than a chatbot that produces purchasing prose.

## Scope

Implemented:

- Scenario 1 purchase-recommendation review;
- all four required decision categories;
- versioned evidence with source and freshness metadata;
- deterministic replenishment calculations and operational constraints;
- buyer approval, approval-time revalidation, and idempotent mock PO creation;
- exact approved-payload validation and supplier-shortfall recovery;
- Scenario 2 alternate-supplier, hub-transfer, and split recovery resolution;
- deterministic recovery feasibility and cost-risk ranking;
- separate versioned recovery approval, revalidation, idempotency, and validation;
- optional OpenAI-generated buyer briefings;
- memory and PostgreSQL persistence modes;
- decision evaluations, workflow tests, and a repeatable demonstration.

Not implemented as complete workflows:

- Scenario 3 demand-anomaly handling;
- Scenario 4 general constraint-resolution strategies;
- integration with production inventory, forecasting, supplier, finance, or PO systems.

## Product experience

The buyer works from an attention queue. Selecting a case reveals:

1. the original purchasing recommendation;
2. the independently calculated quantity and decision;
3. operational evidence, source, version, and observed time;
4. deterministic calculation details and daily inventory projection;
5. the result of each hard constraint;
6. important factors and an optional AI briefing;
7. the exact versioned action awaiting approval;
8. execution, validation, and recovery events.
9. Scenario 2 recovery candidates, rejected-option reasons, and exact recovery proposal.

This keeps the human responsible for material spending while removing the need to manually reconstruct the purchasing position or copy an approved action into another screen.

## Investigation and evidence

Scenario 1 has a policy-defined minimum evidence set. The application reads all eight categories because omitting any of the first seven would make the purchase decision unsafe:

| Evidence | Mock source | Purpose |
| --- | --- | --- |
| Recommendation | Recommendation engine | Original product, node, supplier, and quantity |
| Inventory | Warehouse management system | Usable on-hand position after exclusions |
| Demand | Forecast service | Expected demand, safety stock, daily curve, and confidence |
| Open purchase orders | Purchase order service | Confirmed inbound supply within the protection period |
| Supplier | Supplier service | Lead time, MOQ, pack multiple, price, capacity, and reliability |
| Budget | Finance service | Maximum affordable order |
| Storage | Capacity service | Maximum units the node can receive |
| Product policy | Catalog service | Shelf-life and expiry-exposure cap |

Every evidence envelope includes `source`, `observedAt`, `maxAgeMinutes`, and `version`. Invalid or stale critical evidence produces `INVESTIGATE_FURTHER`; the application does not invent a replacement value.

The application always runs the policy-required evidence reads. OpenAI may then dynamically choose up to four approved optional reads. Scenario 1 optional tools inspect demand shape, inbound timing, supplier risk, and perishability. Scenario 2 adds alternate suppliers, network transfers, and deterministic recovery candidates. Unknown, malformed, duplicate, event-inapplicable, or over-limit calls are rejected and recorded.

## Deterministic decision model

The application calculates usable inventory as:

```text
usable on hand
    = on hand
      - reserved
      - damaged
      - quarantined
      - backorders
```

Confirmed inbound includes only POs with `CONFIRMED` status and an arrival date inside the protection period.

```text
target inventory
    = expected demand + safety stock

raw requirement
    = max(0, target inventory - usable on hand - confirmed inbound)
```

The requirement is rounded to the supplier order multiple, raised to MOQ when necessary, and capped by budget, storage, supplier capacity, and shelf-life exposure. A day-by-day projection detects temporary stockouts that an ending-balance calculation could hide.

The decision policy is:

| Condition | Decision |
| --- | --- |
| Evidence is invalid or stale | `INVESTIGATE_FURTHER` |
| No additional inventory is required | `REJECT` |
| Inventory is required but no feasible order can satisfy hard constraints | `INVESTIGATE_FURTHER` |
| Feasible quantity equals the upstream recommendation | `ACCEPT` |
| Feasible quantity differs from the upstream recommendation | `MODIFY` |

For the primary fixture:

```text
900 demand
+ 50 safety stock
- 200 usable inventory
- 300 confirmed inbound
= 450 units required
```

The original 800-unit recommendation therefore becomes a `MODIFY` decision for 450 units.

## AI boundary

OpenAI is optional. When configured, the model receives:

- a compact case summary and the event-specific allow-list: four purchase-review definitions or three recovery definitions;
- eight mandatory Scenario 1 results, two additional mandatory recovery results when applicable, and validated optional results;
- the deterministic plan and decision;
- the exact proposal metadata.

The application—not the model—executes every tool. It enforces the exact case ID, strict arguments, a four-call maximum, deduplication, and a read-only allow-list. The model then returns a Zod-validated Structured Output containing a headline, executive summary, evidence insights, risk flags, and buyer action. The prompt prohibits recalculating or changing the quantity, supplier, price, delivery date, or decision.

Without a key, deterministic rules select from the same optional registry and the endpoint returns a deterministic briefing. If the API or schema validation fails, the endpoint also falls back safely. The purchasing decision and workflow do not depend on model availability.

## Approval and delayed-action safety

A proposed purchase order contains:

- proposal ID and version;
- evidence versions;
- exact action payload;
- creation time and validity window;
- SHA-256 action fingerprint;
- idempotency key.

Approval is permission to attempt one exact action, not permission to execute whatever action is current later. Immediately before execution, the workflow reloads the latest case evidence, reruns freshness checks, planning, and constraints, and compares the new action fingerprint with the approved fingerprint.

If the proposal expired or any material field changed, the old proposal is stopped. A new proposal version is produced and requires fresh approval. The demonstration makes this visible by increasing live inventory by 100 units between proposal and approval, changing the order from 450 to 350 units.

## Execution, validation, and recovery

After successful revalidation, the mock executor creates a PO record using an idempotency key derived from case ID, proposal version, and action fingerprint. Retrying the same approved proposal reuses the existing record rather than creating a duplicate.

Immediate validation confirms that the stored PO payload exactly matches the approved product, node, supplier, quantity, unit cost, currency, and delivery date. A mismatch moves the case to `RECOVERY_REQUIRED`.

The supplier-confirmation step closes the feedback loop:

- full quantity confirmation keeps the case completed;
- partial confirmation changes the PO to `PARTIALLY_CONFIRMED` and moves the case to `RECOVERY_REQUIRED`;
- the audit timeline records the confirmed quantity and shortfall.

For a partial confirmation, Scenario 2 evaluates supplier-only, transfer-only, and split allocations. Candidate feasibility requires complete coverage, capacity and order-rule compliance, remaining budget, and arrival by the original required date. Feasible candidates are ranked by landed cost, reliability-derived service risk, and overage. Approval-time recalculation supersedes an allocation if availability or any material field changes. The mock executor records and exactly validates the final recovery allocations.

## Persistence and reliability

The domain and workflow depend on a `CaseRepository` interface:

- memory mode provides a zero-infrastructure reviewer experience;
- PostgreSQL mode persists the complete case aggregate and indexed lifecycle fields.

The PostgreSQL repository uses a monotonically increasing revision and compare-and-swap mutation. Concurrent writers cannot silently overwrite one another. The same workflow, calculations, API routes, and UI are used in both modes.

Reliability mechanisms include:

- runtime Zod validation;
- evidence freshness limits;
- versioned proposals;
- action fingerprints;
- optimistic concurrency in PostgreSQL;
- idempotent PO execution;
- deterministic fallback when OpenAI is unavailable;
- an append-only audit timeline inside the case aggregate.

## Extending the remaining scenarios

The four assignment scenarios are modeled as event-driven workflows rather than separate applications. A new scenario handler should declare:

1. its triggering event;
2. required and optional evidence;
3. candidate actions;
4. deterministic policies and constraints;
5. approval requirements;
6. validation and recovery criteria.

The case lifecycle, repositories, evidence envelopes, proposal versioning, approval safety, audit timeline, and recovery semantics can be reused. See [Architecture and safety model](architecture.md) for component and sequence diagrams.

## Deliberate trade-offs

- A modular monolith keeps the assignment understandable and runnable in one process while preserving service boundaries.
- Fixed required evidence plus bounded optional model selection is more reliable than unrestricted LLM tool use.
- Deterministic purchasing math makes evaluations reproducible and prevents model drift from changing spend.
- JSONB aggregate persistence keeps the interview slice compact; a production system could normalize action, approval, and audit ledgers.
- Mock operational data makes the feedback loop demonstrable without requiring company credentials or infrastructure.
