# Mock systems, data, and APIs

## Purpose

The assignment permits mock data, APIs, databases, and services. This project models the operational systems needed for Scenario 1 without requiring company infrastructure or credentials.

The mocks are deliberately typed and versioned so they preserve the important production boundaries: source ownership, data freshness, optimistic concurrency, approval, idempotency, and validation.

## Mock operational sources

Scenario 1 uses eight evidence envelopes. Each envelope contains a typed `value` plus `source`, `observedAt`, `maxAgeMinutes`, and `version`.

| Logical read tool | Mock source system | Data returned | Mutation capability |
| --- | --- | --- | --- |
| `get_recommendation` | Recommendation engine | Product, node, supplier, original quantity | Read-only |
| `get_inventory_position` | Warehouse management system | On-hand, reserved, damaged, quarantined, backorders | Read-only during investigation; demo endpoint can simulate change |
| `get_demand_forecast` | Forecast service | Protection period, expected and daily demand, safety stock, confidence | Read-only |
| `get_open_purchase_orders` | Purchase order service | Quantity, arrival date, and PO status | Read-only during investigation |
| `get_supplier_terms` | Supplier service | Lead time, MOQ, order multiple, price, capacity, reliability | Read-only |
| `get_available_budget` | Finance service | Available amount and currency | Read-only |
| `get_storage_capacity` | Capacity service | Available units at the destination node | Read-only |
| `get_product_policy` | Catalog service | Shelf life and maximum units before expiry exposure | Read-only |

These are logical adapters over the versioned case evidence in the current vertical slice; they are not eight independently deployed HTTP services. The trace shown in the UI records which logical source supplied each result.

In production, each adapter can be replaced with an HTTP, database, event-stream, or internal-service client while keeping the domain and planning interfaces unchanged.

## Mock dataset

The canonical dataset lives in [`src/evaluation/fixtures.ts`](../src/evaluation/fixtures.ts). The primary case represents:

| Field | Value |
| --- | ---: |
| Original recommendation | 800 units |
| Raw on-hand inventory | 230 units |
| Reserved inventory | 20 units |
| Damaged inventory | 5 units |
| Quarantined inventory | 5 units |
| Usable inventory | 200 units |
| Expected demand | 900 units over 10 days |
| Safety stock | 50 units |
| Confirmed inbound | 300 units |
| Supplier lead time | 2 days |
| MOQ | 100 units |
| Order multiple | 50 units |
| Unit cost | INR 120 |
| Available budget | INR 70,000 |
| Available storage | 600 units |
| Supplier capacity | 1,200 units |
| Expiry-exposure cap | 700 units |

This produces a raw and feasible requirement of 450 units.

[`src/workflows/demo-cases.ts`](../src/workflows/demo-cases.ts) derives four dashboard cases from this dataset:

| Case | Variation | Result |
| --- | --- | --- |
| `CASE-1042` | Original 800-unit recommendation | `MODIFY` to 450 |
| `CASE-1043` | Recommendation changed to 450 | `ACCEPT` 450 |
| `CASE-1044` | On-hand inventory increased to 1,000 | `REJECT` with zero order |
| `CASE-1045` | Inventory timestamp made stale | `INVESTIGATE_FURTHER` |

The reset API recreates these four cases with timestamps relative to the current time so freshness behavior remains demonstrable.

## Application API

Next.js route handlers expose the buyer workflow.

| Method and path | Purpose | Request body | State change |
| --- | --- | --- | --- |
| `GET /api/cases` | List attention-queue cases | None | No |
| `GET /api/cases/{caseId}` | Read one complete case | None | No |
| `POST /api/cases/{caseId}/briefing` | Generate OpenAI or deterministic buyer briefing | None | No case mutation |
| `POST /api/cases/{caseId}/approve` | Approve one exact proposal version | `proposalVersion`, `buyerId` | Revalidates and may execute |
| `POST /api/cases/{caseId}/simulate-change` | Change mock on-hand inventory | `onHandDelta` | Yes; demo-only evidence update |
| `POST /api/cases/{caseId}/supplier-confirmation` | Record supplier-confirmed quantity/date | `confirmedQuantity`, optional `confirmedDeliveryDate` | Yes; may create recovery |
| `POST /api/demo/reset` | Restore the four demo cases | None | Replaces demo cases |

All mutating payloads are validated with Zod. Workflow errors return appropriate HTTP conflict, validation, or not-found responses.

## Mock purchase-order executor

The action executor creates a PO record inside the case aggregate after approval-time revalidation passes. The record contains:

- generated PO ID;
- idempotency key;
- creation timestamp;
- requested action payload;
- submission/confirmation status;
- supplier-confirmed quantity and date.

The idempotency key is derived from case ID, proposal version, and action fingerprint. Repeating the same approved request returns the existing PO rather than creating a second record.

Immediate validation compares the stored requested payload with the approved fingerprint. Supplier confirmation provides the second validation stage: a partial confirmation moves the case to `RECOVERY_REQUIRED` and records the shortfall.

This mock is intentionally in-process. A production adapter would create the PO through the purchasing platform, read it back from that system, and reconcile budget, capacity, confirmation, and delivery state.

## Persistence modes

### Memory mode

- selected by default;
- requires only Node.js;
- seeds four cases when the application process starts;
- resets when the process restarts;
- intended for the fastest reviewer demonstration.

### PostgreSQL mode

- enabled with `DATABASE_MODE=postgres`;
- uses PostgreSQL 17 through Docker Compose on host port 5433;
- stores the complete case aggregate in JSONB;
- indexes lifecycle status and update time;
- uses a revision column for optimistic compare-and-swap updates;
- supports migration, seed, and persistent smoke-test commands.

The same `CaseRepository` interface isolates the workflow from the selected storage adapter.

## External OpenAI service

OpenAI is the only optional third-party runtime service. The server reads `OPENAI_API_KEY` and `OPENAI_MODEL`; credentials are never sent to the browser.

The application first sends compact case signals and four read-only function definitions to the Responses API. It validates and locally executes the selected functions, then sends the resulting trace plus deterministic result for structured buyer-facing synthesis. The model has no PO write capability. If the key is absent, deterministic policy selects optional reads; if the request/schema fails, the endpoint returns a deterministic fallback.

## Failure simulations

Two explicit controls demonstrate changing external reality:

1. **Inventory change before approval** updates the mock warehouse evidence and version. Approval revalidation then supersedes the old proposal.
2. **Supplier confirms less than requested** changes the mock PO to `PARTIALLY_CONFIRMED` and moves the case into recovery.

These controls are intentionally visible in the UI so a reviewer can reproduce both failure paths without editing data or calling APIs manually.

## Replacing mocks in production

| Mock boundary | Production replacement |
| --- | --- |
| Versioned evidence in case aggregate | Inventory, forecast, PO, supplier, finance, capacity, and catalog clients |
| Demo inventory-change endpoint | Warehouse events or a live inventory read |
| In-process PO record | Purchasing/ERP create-and-read-back adapter |
| Supplier-confirmation endpoint | Supplier portal, EDI, webhook, or event consumer |
| Local case repository | Managed PostgreSQL plus event/action ledgers |
| Manual reset endpoint | Test-fixture or sandbox-only administrative tooling |

The deterministic planner and approval policies should remain independent of these transport changes.
