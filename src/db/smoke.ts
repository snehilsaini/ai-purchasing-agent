import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { PostgresCaseRepository } from "@/repositories/postgres-case-repository";
import { PurchasingCaseService } from "@/workflows/purchasing-case-service";

const url = process.env.DATABASE_URL
  ?? "postgresql://purchasing:purchasing@localhost:5433/purchasing_agent";
const client = postgres(url, { max: 1 });
const database = drizzle(client, { schema });

try {
  const service = new PurchasingCaseService(new PostgresCaseRepository(database));
  const cases = await service.listCases();
  if (cases.length !== 4) throw new Error(`Expected four seeded cases, found ${cases.length}.`);

  const target = cases.find((item) => item.id === "CASE-1042");
  if (!target?.proposal) throw new Error("CASE-1042 has no proposal to approve.");

  const completed = await service.approve({
    caseId: target.id,
    proposalVersion: target.proposal.version,
    buyerId: "database-smoke-test",
  });
  if (completed.status !== "COMPLETED" || !completed.purchaseOrder) {
    throw new Error("Persistent approval did not complete and create a purchase order.");
  }

  const readBack = await service.getCase(target.id);
  if (readBack.purchaseOrder?.purchaseOrderId !== completed.purchaseOrder.purchaseOrderId) {
    throw new Error("The persisted purchase order did not survive a repository read-back.");
  }

  console.info(
    `PostgreSQL smoke test passed: ${completed.purchaseOrder.purchaseOrderId} persisted for ${target.id}.`,
  );
} finally {
  await client.end();
}
