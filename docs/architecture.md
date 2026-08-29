# Architecture and safety model

## System shape

The project is a TypeScript modular monolith. That gives the interview implementation one deployable unit while keeping the boundaries that would become services in a larger system.

```mermaid
flowchart LR
    UI[Buyer workspace] --> API[Next.js route handlers]
    API --> WF[PurchasingCaseService]
    WF --> REPO[CaseRepository]
    REPO --> MEM[Memory demo adapter]
    REPO --> PG[(PostgreSQL adapter)]
    WF --> ANALYZE[Scenario handler]
    ANALYZE --> FRESH[Evidence freshness policy]
    ANALYZE --> PLAN[Deterministic planner]
    PLAN --> RULES[Constraint engine]
    API --> AGENT[Buyer briefing generator]
    AGENT --> READ[Eight mandatory evidence views]
    AGENT --> LLM[Optional OpenAI tool selection]
    LLM --> OPT[Seven approved optional read tools; max four calls]
    OPT --> AGENT
    AGENT --> BRIEF[Structured briefing synthesis]
```

The important dependency direction is inward: Next.js and database adapters depend on the workflow/domain layers. Replenishment rules do not depend on UI, HTTP, PostgreSQL, or an LLM.

## Evidence and tool model

Scenario 1 uses a policy-defined set of eight mandatory read-only evidence views: recommendation, inventory, demand, open POs, supplier terms, budget, storage, and product policy. In the current vertical slice these views read versioned evidence from the case aggregate; they are logical integration boundaries rather than independently deployed network services.

The application, not the model, runs those mandatory reads. Scenario 2 adds mandatory supplier-confirmation and recovery-budget/deadline reads. The registry contains seven approved optional views, but only an event-specific subset is exposed: four purchase-review tools or three recovery tools. Each request must contain the exact case ID and a rationale. The application validates arguments and event applicability, deduplicates calls, rejects unknown tools, enforces a four-call limit, executes only local read functions, and records provenance in the trace. With no OpenAI key, deterministic case-signal rules select from the same registry.

## Scenario 1 execution sequence

```mermaid
sequenceDiagram
    participant S as Recommendation system
    participant W as Purchasing workflow
    participant E as Evidence adapters
    participant P as Planner and policies
    participant B as Buyer
    participant O as Mock PO executor

    S->>W: PURCHASE_RECOMMENDATION_CREATED (800 units)
    W->>E: Load required versioned evidence
    E-->>W: Versioned evidence with source and observedAt
    W->>P: Validate freshness and calculate plan
    P-->>W: MODIFY to 450 + constraint results
    W-->>B: Proposal v1 for exactly 450 units
    Note over W,B: Workflow state is persisted; no request remains running
    B->>W: Approve proposal v1
    W->>E: Reload latest persisted evidence snapshot
    W->>P: Recalculate and compare action fingerprint
    alt Material change
        P-->>W: New action, for example 350 units
        W-->>B: Supersede v1; request approval for v2
    else Unchanged
        W->>O: Create PO with idempotency key
        O-->>W: PO record
        W->>O: Validate stored PO payload
        W-->>B: Exact approved fields validated; case completed
    end
```

## Scenario 2 recovery sequence

```mermaid
sequenceDiagram
    participant S as Supplier
    participant W as Purchasing workflow
    participant R as Recovery planner
    participant B as Buyer
    participant X as Recovery executor

    S->>W: Confirm 300 of 450 units
    W->>R: Evaluate suppliers, transfers, and splits
    R-->>W: Six candidates + recommended 150-unit transfer
    W-->>B: Recovery proposal v1
    B->>W: Approve exact allocation
    W->>R: Recalculate from current availability
    alt Preferred hub stock changed
        R-->>W: New 100 transfer + 50 supplier split
        W-->>B: Supersede v1; request approval for v2
    else Allocation unchanged
        W->>X: Execute with recovery idempotency key
        X-->>W: Recovery execution record
        W-->>B: Exact allocations validated; recovery complete
    end
```

## Trust boundaries

### Deterministic application

Application code owns:

- usable inventory and inventory-position calculations;
- protection period, target, raw requirement, and projections;
- MOQ and order-multiple handling;
- budget, storage, supplier-capacity, and expiry limits;
- evidence freshness and material-change policies;
- approval/version checks, idempotency, execution, and exact validation.

### LLM boundary

The optional model receives a compact set of case signals for tool selection, then:

- results from eight Scenario 1 mandatory reads, two additional recovery reads when applicable, and zero-to-four dynamically selected adapters;
- the already-computed deterministic plan and decision;
- the exact proposal metadata.

It returns a Zod-validated Structured Output containing a concise buyer briefing. The prompt explicitly forbids recalculating or changing the action. The registry contains no purchase-order write tool, tool arguments are runtime-validated, and model output never bypasses workflow policy.

### Human boundary

The buyer approves one proposal version and exact action payload. Approval authorises an attempt subject to immediate revalidation; it does not authorise the software to silently substitute a new quantity, supplier, price, or delivery date.

## Persistence and concurrency

`CaseRepository` has two implementations:

- `MemoryCaseRepository` makes the demo require only Node.js;
- `PostgresCaseRepository` stores the complete case aggregate in JSONB alongside indexed lifecycle fields.

PostgreSQL rows carry a monotonically increasing `revision`. Mutations use optimistic compare-and-swap updates, so concurrent requests cannot silently overwrite each other. Action proposals contain:

- proposal ID and version;
- evidence versions;
- validity window;
- SHA-256 action fingerprint;
- idempotency key derived from case, version, and fingerprint.

## Failure and recovery behavior

| Failure | Behavior |
| --- | --- |
| Missing, invalid, or stale critical evidence | `INVESTIGATE_FURTHER`; no action proposal |
| Hard constraints cannot support MOQ | `INVESTIGATE_FURTHER`; no write tool is exposed |
| Live action differs after approval | Old proposal superseded; fresh approval required |
| Approval retry or double-click | Same idempotency key; same PO returned |
| Created PO differs from approved action | `RECOVERY_REQUIRED` |
| Supplier confirms fewer units | `SUPPLIER_SHORTFALL_REPORTED` recovery event |
| Preferred recovery source changes after approval | Old recovery proposal superseded; new candidate ranking and approval required |
| No recovery candidate covers the shortfall safely | `ESCALATED`; no recovery execution |
| OpenAI key/API/schema unavailable | Deterministic briefing fallback; decision unaffected |
| Unknown, malformed, duplicate, or excessive model tool call | Call rejected and reported in the investigation trace |

## Extending Scenarios 3–4

New scenarios should implement an event handler that declares required evidence, candidate actions, and validation criteria. They reuse the same case lifecycle, repositories, evidence envelopes, approval policy, proposal versioning, executor, timeline, and recovery semantics.

Likely additions are:

- Scenario 3: demand-anomaly evidence and forecast override policy;
- Scenario 4: constraint-collision resolution and explicit infeasibility explanations.

See [Solution approach](approach.md), [Test scenarios and evaluation approach](evaluation.md), and [Mock systems, data, and APIs](mock-systems.md) for the implementation details behind these boundaries.
