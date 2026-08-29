# AI Purchasing Agent

> Working Scenario 1 + Scenario 2 vertical slices - v0.3

An explainable, constraint-aware purchasing agent for retail and quick-commerce operations. The system reviews purchasing recommendations, gathers operational evidence, makes a decision, executes an authorised action, and validates the real outcome.

Scenario 1 reviews an upstream purchase recommendation end to end. Scenario 2 consumes a supplier shortfall, evaluates alternate suppliers and network transfers, ranks feasible recovery actions, obtains versioned approval, revalidates live availability, executes idempotently, and verifies the exact recovery outcome.

The original design baseline remains visible in the first Git commit. This README now describes the working implementation.

## Prerequisites

- Node.js 20.9 or newer and npm;
- Docker only for the optional PostgreSQL mode;
- an OpenAI API key only for the optional model-generated briefing.

## Run locally

### Fastest path: zero-setup memory mode

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `DATABASE_MODE=memory` is the default, so the full workflow is demonstrable without Docker or an API key.

### Persistent PostgreSQL mode

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
```

Then set the following in `.env.local` and restart the application:

```dotenv
DATABASE_MODE=postgres
DATABASE_URL=postgresql://purchasing:purchasing@localhost:5433/purchasing_agent
```

Port `5433` is intentionally used on the host so the project does not collide with a conventional local PostgreSQL installation on `5432`.

### Optional OpenAI briefing

The decision engine does not require an LLM. To enable model-generated buyer briefings, add these server-side values to `.env.local`:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-5.4-mini
```

The implementation uses the OpenAI Responses API with function calling and Structured Outputs. Eight Scenario 1 evidence reads always run; Scenario 2 adds two mandatory recovery reads. The read-only registry contains seven tools, but the model sees only the event-appropriate subset—four for purchase review or three for shortfall recovery—and may make at most four calls. Application code validates the case ID and arguments, rejects unknown/duplicate/over-limit calls, and exposes the complete trace in the UI. A second model call explains the deterministic result but cannot alter calculations or authorise/execute spend. Without a key—or if API/schema validation fails—the same optional tools are selected by deterministic policy and the UI clearly identifies fallback mode. See the official [Responses API documentation](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

### Verification

```bash
npm run typecheck
npm run lint
npm test
npm run eval
npm run build
```

Useful reviewer documents:

- [Solution approach](docs/approach.md)
- [Architecture and safety model](docs/architecture.md)
- [Test scenarios and evaluation approach](docs/evaluation.md)
- [Mock systems, data, and APIs](docs/mock-systems.md)
- [Three-minute demo script](docs/demo-script.md)

## Problem framing

A conventional replenishment system may recommend an action such as:

> Purchase 800 units of Product X for Fulfilment Node A.

That recommendation is an input, not a fact. It may have been produced from incomplete or outdated data and may no longer be appropriate when a buyer reviews it.

The AI Purchasing Agent independently investigates the situation and returns one of four decisions:

- `ACCEPT` - the original recommendation remains appropriate;
- `MODIFY` - purchasing is appropriate, but the quantity, supplier, date, or method should change;
- `REJECT` - the recommendation should not be executed;
- `INVESTIGATE_FURTHER` - a safe decision cannot be made with the available evidence.

The goal is not to build a chatbot that merely discusses purchasing. The goal is to demonstrate a system that can make, execute, and validate purchasing decisions while keeping a human in control of consequential actions.

## Product experience

A buyer works from an attention queue rather than an empty chat screen.

For each purchasing case, the buyer can see:

1. the original recommendation or operational event;
2. the evidence gathered by the agent;
3. data freshness, source, and any missing information;
4. the purchasing calculation and constraint results;
5. the agent's decision and important reasons;
6. the exact proposed action;
7. whether human approval is required;
8. the execution and validation timeline;
9. any recovery action proposed when reality differs from the plan.

The buyer supervises decisions and approves risk. They do not need to manually copy the recommended quantity into another system after approval.

## Core design principles

### 1. Recommendations are challenged

The agent never assumes that the upstream recommendation is correct. It reconstructs the purchasing position from current evidence.

### 2. AI investigates and explains; deterministic code decides and calculates

The Scenario 1 handler gathers a policy-defined set of eight required evidence categories. When OpenAI is configured, the model dynamically selects additional read-only analytical tools based on case signals. Those calls are bounded, validated, and auditable. The model then receives the evidence plus deterministic analysis and produces a structured buyer briefing; it does not calculate the order, prepare the action, or receive a write tool.

Regular application code performs inventory projections, purchasing calculations, constraint enforcement, approval checks, and exact post-action validation.

### 3. Evidence has provenance and freshness

Important facts are stored with their source and retrieval time. Missing, invalid, or stale critical evidence leads to `INVESTIGATE_FURTHER`, not a fabricated assumption.

### 4. Approval is not blind execution

A buyer approves a specific version of an action proposal. Immediately before execution, the system loads the latest persisted evidence snapshot and recalculates the plan.

If the quantity, supplier, price, delivery date, or risk has materially changed, the old proposal is superseded and a new approval is required.

### 5. Success is a business outcome

An HTTP success response or a newly created PO record is not sufficient. The mock workflow checks the exact approved payload and records supplier confirmation. A partial confirmation moves the case to recovery instead of being treated as success.

### 6. Every action is auditable and safe to retry

The system records evidence, calculations, decisions, approvals, action attempts, and validation results. Mutating operations use idempotency keys so retries or double-clicks cannot create duplicate purchase orders.

## Scenario 1 - Recommendation review

Scenario 1 is the originating recommendation-review flow. Its domain concepts and workflow stages are reused directly by the implemented Scenario 2 recovery flow.

### Inputs required by the assignment

- current inventory;
- expected demand;
- existing open purchase orders;
- supplier lead time;
- supplier minimum-order requirements;
- available purchasing budget;
- available storage capacity.

### Additional evidence implemented

- reserved, damaged, quarantined, and otherwise unusable inventory;
- forecast confidence and a daily demand curve;
- PO confirmation status and expected arrival date;
- supplier capacity and historical delivery reliability;
- order multiples and case-pack alignment;
- shelf life and expiry risk;
- timestamps and versions for all volatile information.

Future scenario handlers can add historical forecast error, promotions, recent sales velocity, price breaks, freight, and category-specific receiving constraints. Scenario 2 already adds alternate suppliers and inter-node transfers.

### Simplified purchasing calculation

```text
protection period
    = policy/forecast input covering the purchasing risk window

expected delivery date
    = analysis time + supplier lead time

target inventory
    = expected demand during the protection period + safety stock

inventory position
    = on-hand inventory
      - reserved, damaged, quarantined, and backordered units
      + relevant confirmed inbound inventory

raw purchase requirement
    = max(0, target inventory - inventory position)
```

The raw requirement is then evaluated against MOQ, order multiples, supplier capacity, budget, storage, and shelf-life exposure.

A day-by-day projected inventory balance supplements the aggregate calculation so that a temporary stockout before the delivery date is not hidden by a healthy ending balance.

### Illustrative 800-unit case

The following values are mock data used to explain the intended behaviour; they are not hard-coded business rules.

| Input | Value |
| --- | ---: |
| Original recommendation | 800 units |
| Usable inventory | 200 units |
| Confirmed incoming PO | 300 units |
| Demand over the protection period | 900 units |
| Safety-stock target | 50 units |
| MOQ | 100 units |
| Order multiple | 50 units |
| Unit cost | INR 120 |
| Available budget | INR 70,000 |

```text
900 demand
+ 50 safety stock
- 200 usable inventory
- 300 confirmed incoming
= 450 units required
```

The application therefore returns a structured `MODIFY` decision rather than blindly accepting 800:

```json
{
  "decision": "MODIFY",
  "originalQuantity": 800,
  "recommendedQuantity": 450,
  "confidence": "HIGH",
  "importantFactors": [
    "300 confirmed units are due within the protection period",
    "450 units are required before operational constraints",
    "450 units leave a projected ending balance of 50 units",
    "MOQ, order multiple, budget, storage, capacity, and shelf-life checks pass"
  ],
  "proposedAction": {
    "type": "CREATE_PURCHASE_ORDER",
    "quantity": 450
  },
  "requiresApproval": true
}
```

The application calculates this response from scenario data. It contains no special rule stating that 800 always becomes 450.

## End-to-end workflow

```mermaid
flowchart TD
    A[Recommendation or operational event] --> B[Create purchasing case]
    B --> C[Gather required evidence]
    C --> D{Evidence sufficient and fresh?}
    D -- No --> E[Investigate further or escalate]
    D -- Yes --> F[Calculate time-phased purchase plan]
    F --> G[Evaluate operational constraints]
    G --> H[Produce structured decision]
    H --> I{Action required?}
    I -- No --> J[Record outcome and close]
    I -- Yes --> K{Approval required?}
    K -- Yes --> L[Wait for buyer approval]
    L --> M[Revalidate current evidence]
    K -- No --> M
    M --> N{Approved action still valid?}
    N -- No --> C
    N -- Yes --> O[Execute action idempotently]
    O --> P[Read back and validate result]
    P --> Q{Business outcome acceptable?}
    Q -- Yes --> R[Complete case]
    Q -- No --> S[Create recovery event]
    S --> C
```

## Approval-time revalidation

The application persists workflow state while waiting for a buyer. No server process or LLM request remains running during that time.

An action proposal includes:

- a proposal ID and version;
- the evidence-version map used to create it;
- the exact proposed action;
- creation time and validity window;
- an action fingerprint and idempotency key.

The buyer identity and approval time are recorded as an audit event when approval occurs.

When the buyer approves:

1. the backend atomically claims the expected proposal version;
2. the latest persisted evidence snapshot is loaded again;
3. the deterministic plan and constraints are rerun;
4. the recalculated action is compared with the approved action;
5. unchanged actions may execute;
6. materially changed actions produce a new proposal version and require approval again.

The system must never silently change the approved quantity, supplier, price, delivery date, or spending commitment.

## Feedback and recovery loop

Validation occurs at three levels.

### Before execution

- evidence remains sufficiently fresh;
- the proposal version is current;
- the action still satisfies all constraints;
- no equivalent PO already exists;
- approval applies to the exact action payload.

### Immediately after execution

- the PO exists exactly once;
- product, node, supplier, quantity, price, and date match the approved action;
- a mismatched mock PO payload moves the case to recovery.

### After supplier response

- the confirmed quantity and delivery date are recorded;
- full confirmation keeps the case completed;
- partial confirmation moves the case to recovery and records the shortfall.

If a supplier confirms only 300 of an approved 450 units, the validator records a `SUPPLIER_SHORTFALL_REPORTED` event rather than hiding the discrepancy behind a successful PO creation. The Scenario 2 handler immediately gathers two alternate suppliers and two transfer sources, creates supplier-only, transfer-only, and split candidates, and applies full-coverage, capacity, MOQ, order-multiple, remaining-budget, arrival-date, and service-risk rules.

## Scenario 2 - Supplier shortfall recovery

The default 150-unit shortfall produces six candidates. Deterministic ranking recommends a 150-unit transfer from `HUB-BLR-11`: it covers the full gap, arrives by the required date, costs INR 1,800, and has 4% service risk. Supplier-only options are blocked when emergency spend exceeds the INR 16,000 remaining budget or delivery misses the deadline; a 100-unit transfer is blocked because it leaves 50 units uncovered.

The selected recovery action becomes a separate, versioned proposal. Immediately before execution the application recalculates all candidates from current recovery evidence. If Marathahalli inventory falls to zero, proposal v1 is stopped and replaced by a split proposal: 100 units from `HUB-BLR-03` plus 50 units from `SUP-SWIFT`. It cannot execute until the buyer approves v2.

Successful recovery creates an idempotent execution record and validates exact transfer/supplier allocations, quantities, costs, and arrival dates against the approved fingerprint.

## Extensibility across the four scenarios

The scenarios are event types, not four separate applications and not necessarily a fixed sequence.

| Event | Related scenario | Example response |
| --- | --- | --- |
| `PURCHASE_RECOMMENDATION_CREATED` | Scenario 1 | Review and challenge a proposed purchase |
| `SUPPLIER_SHORTFALL_REPORTED` | Scenario 2 | Re-source, transfer, defer, or escalate the missing quantity |
| `DEMAND_ANOMALY_DETECTED` | Scenario 3 | Recalculate coverage and revise the purchasing plan |
| `PURCHASE_CONSTRAINT_DETECTED` | Scenario 4 | Find a feasible alternative instead of bypassing the constraint |

All event types share a common lifecycle:

```text
TRIGGERED
  -> INVESTIGATING
  -> EVIDENCE_READY
  -> DECIDED
  -> AWAITING_APPROVAL
  -> REVALIDATING
  -> EXECUTING
  -> VALIDATING
  -> COMPLETED | RECOVERY_REQUIRED | ESCALATED
```

Scenario-specific modules determine required evidence, candidate actions, and success criteria. Evidence collection, calculations, policies, approvals, execution, audit, and validation remain shared.

## Responsibility boundaries

| Responsibility | LLM agent | Deterministic application | Buyer |
| --- | :---: | :---: | :---: |
| Identify required Scenario 1 evidence | No | Yes | No |
| Retrieve operational evidence | No | Runs typed read-only adapters | No |
| Calculate quantities and projections | No | Yes | No |
| Enforce hard constraints | No | Yes | No |
| Produce the purchasing decision | No | Yes | Reviews |
| Explain the validated decision | Optional | Provides deterministic fallback | Reviews |
| Prepare an action proposal | No | Yes | Reviews |
| Authorise material spending | No | Enforces approval rules | Yes |
| Execute an authorised action | No | Performs the write | No |
| Verify exact action results | No | Performs exact checks | Reviews exceptions |

The optional model receives no purchase-order mutation tool. The application produces, validates, and executes a typed action only after deterministic policy and approval requirements are satisfied.

## Architecture

The application is a TypeScript modular monolith: one repository and one deployable application with explicit internal boundaries.

```mermaid
flowchart LR
    UI[Buyer dashboard] --> API[Application API]
    API --> WF[Purchasing workflow]
    WF --> DB[(Memory or PostgreSQL repository)]
    API --> AGENT[Buyer briefing generator]
    AGENT --> LLM[Optional OpenAI tool selection + briefing]
    AGENT --> REQUIRED[Eight mandatory evidence views]
    LLM --> OPTIONAL[Seven approved read tools; max four calls]
    REQUIRED --> SERVICES[Versioned mock operational evidence]
    OPTIONAL --> SERVICES
    WF --> PLAN[Planning engine]
    WF --> RULES[Constraints and policies]
    RULES --> EXEC[Mock action executor]
    EXEC --> PO[PO record]
    PO --> VALIDATOR[Outcome validator]
    VALIDATOR --> WF
```

### Initial technology choices

| Concern | Choice |
| --- | --- |
| Language | TypeScript |
| Web application | Next.js and React |
| Backend endpoints | Next.js route handlers |
| Styling | Tailwind CSS and accessible UI components |
| Database | PostgreSQL |
| Database access | Drizzle ORM |
| Runtime schemas | Zod |
| LLM integration | OpenAI Responses API using the official JavaScript SDK |
| Model | Configurable through `OPENAI_MODEL`; default `gpt-5.4-mini` |
| Unit and integration tests | Vitest |
| Browser verification | Repeatable manual demo; browser-level CI is a future extension |
| Local infrastructure | Docker Compose for PostgreSQL |

The direct OpenAI SDK is used instead of a heavyweight agent framework. The implemented path uses one bounded function-selection call followed by one Structured Output synthesis call. Deterministic application code executes every read and remains authoritative for the decision.

## Implemented module boundaries

```text
src/
├── app/                  # Pages and HTTP endpoints
├── components/           # Buyer workspace and case-detail UI
├── domain/               # Cases, evidence, decisions, actions, validation
├── agent/                # Optional structured buyer briefing
├── planning/             # Projections, replenishment math, and constraints
├── policies/             # Freshness, material-change, and approval policies
├── workflows/            # Persistent case-state transitions
├── db/                   # Schema, migrations, and seed data
├── repositories/         # Memory and PostgreSQL adapters
└── evaluation/           # Scenario fixtures, assertions, and runner
```

The domain, planning, policy, and workflow layers do not import React or Next.js.

## Evaluation strategy

The evaluation asserts the complete decision trajectory, not only the final prose response.

Scenario 1 evaluation and workflow tests cover:

1. accept a correct recommendation;
2. modify a recommendation because confirmed inbound supply already exists;
3. reject a recommendation when no additional stock is required;
4. investigate further when critical data is missing or stale;
5. adjust for MOQ or order-multiple rules;
6. handle budget and storage constraints;
7. account for expiry risk;
8. invalidate a proposal when data changes before approval;
9. prevent duplicate PO creation during retries;
10. enter recovery when the supplier confirms less than requested.

Scenario 2 evaluation and workflow tests additionally cover:

1. rank a full, low-risk transfer ahead of expensive emergency supply;
2. reject under-covered, late, capacity-invalid, and over-budget options;
3. switch to a split transfer/supplier strategy when preferred stock disappears;
4. escalate when no candidate is feasible;
5. supersede stale recovery approval and require a new proposal version;
6. execute and validate the approved recovery exactly once.

Each case verifies:

- the required information was obtained;
- freshness and evidence sufficiency were checked;
- calculations were correct;
- constraints were respected;
- the correct decision category was returned;
- approval policy was followed;
- the appropriate action was taken;
- the resulting business state was validated;
- failed or unexpected outcomes entered recovery safely.

## Implemented milestone

- [x] Domain model and persistent workflow states
- [x] Mock operational evidence and typed read-only adapters
- [x] Deterministic planning and constraint engine
- [x] Scenario 1 decision evaluation suite
- [x] Optional OpenAI structured buyer briefing
- [x] Bounded dynamic selection of optional read-only investigation tools
- [x] Buyer attention queue and evidence review experience
- [x] Versioned approval and live-data revalidation
- [x] Idempotent PO execution and exact post-action validation
- [x] Supplier-shortfall recovery transition
- [x] Scenario 2 alternate-supplier, transfer, and split candidate generation
- [x] Deterministic recovery feasibility and cost-risk ranking
- [x] Recovery approval, live revalidation, idempotent execution, and exact validation
- [x] Memory and PostgreSQL repository adapters
- [x] Setup, architecture, evaluation, and demo guidance

The next milestone is submission hardening and demo rehearsal, followed—only if useful—by a focused Scenario 3 demand-anomaly handler.

## Current status

Scenarios 1 and 2 are executable end to end. The production build passes, 32 automated tests pass, all 11 standalone decision/recovery evaluations pass, and PostgreSQL migration/seed/Scenario 1/Scenario 2 read-back has been smoke-tested locally. Live OpenAI tool selection and structured briefings have been verified for both scenarios.

Memory mode is deliberately available for a reliable interview demo. PostgreSQL mode demonstrates the persistence boundary used in a deployed service.

## Security

- API keys and secrets are excluded from version control.
- LLM credentials remain server-side.
- Required environment variables are documented in `.env.example`.
- Action attempts and approval decisions are auditable in the case timeline.
- Versioned mock evidence represents external operational systems.
- `npm audit --omit=dev` reports zero production vulnerabilities. The full development audit currently reports four moderate findings through Drizzle Kit's deprecated `@esbuild-kit` loader; the affected package is confined to local schema-generation tooling. A forced audit fix would downgrade Drizzle Kit across a breaking boundary, so the project tracks the upstream fix instead of silently forcing an incompatible version.

## Design status

This README is intentionally versioned through Git history. Commit 1 is the pre-code design baseline; the current version records how the Scenario 1 foundation was reused for the Scenario 2 recovery slice.
