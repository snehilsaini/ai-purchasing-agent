import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { PostgresCaseRepository } from "@/repositories/postgres-case-repository";
import { createDemoCases } from "@/workflows/demo-cases";

const url = process.env.DATABASE_URL
  ?? "postgresql://purchasing:purchasing@localhost:5433/purchasing_agent";
const client = postgres(url, { max: 1 });
const database = drizzle(client, { schema });

try {
  const repository = new PostgresCaseRepository(database);
  await repository.replaceAll(createDemoCases());
  console.info("Seeded four Scenario 1 purchasing cases.");
} finally {
  await client.end();
}
