# Three-minute interview demo

## Reset

Open the application and click the reset icon beside **Purchasing cases**. Select `CASE-1042`.

## 1. Challenge the upstream recommendation

Start with the green decision panel:

- the upstream system says 800;
- usable stock is 200, not raw on-hand 230;
- 300 confirmed inbound units are already on order;
- demand plus safety stock is 950;
- deterministic need is therefore 450;
- all hard constraints pass, producing `MODIFY`, not blind acceptance.

Point out the source/timestamp on every evidence card, the arithmetic strip, daily projection, and constraint results.

## 2. Show the AI boundary

Click **Generate** under **AI buyer briefing**.

Without an API key, it labels itself `deterministic fallback`. With a key, it uses a Zod-validated OpenAI Structured Output. In both modes the trace shows eight read-only tools. The model can explain the signed result but cannot calculate or execute the PO.

## 3. Demonstrate delayed-approval safety

Click **+100 live inventory**, then **Approve proposal v1**.

The approval does not create a PO. Revalidation detects that usable stock changed from 200 to 300, recomputes the action from 450 to 350, records why v1 was stopped, and asks for fresh approval of v2.

This is the main safety differentiator: approval applies to an exact proposal, not to whatever action happens to be current later.

## 4. Execute and validate

Approve proposal v2.

The UI shows a PO ID and records:

- buyer approval;
- successful live revalidation;
- idempotent action execution;
- exact field validation and completion.

Explain that retrying the same request returns the existing PO because the idempotency key is tied to the proposal fingerprint.

## 5. Close the feedback loop

Click **Confirm 150 short**.

The completed case becomes `RECOVERY_REQUIRED`. The supplier shortfall is not hidden behind a successful PO API response; it becomes a `SUPPLIER_SHORTFALL_REPORTED` event ready for the Scenario 2 handler.

## Optional reviewer commands

```bash
npm test
npm run eval
npm run build
```

For the persistent path:

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run db:smoke
```
