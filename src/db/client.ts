import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

type DatabaseGlobals = typeof globalThis & {
  purchasingSqlClient?: ReturnType<typeof postgres>;
  purchasingDatabase?: ReturnType<typeof createDatabase>;
};

const databaseGlobals = globalThis as DatabaseGlobals;

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10 });
  return drizzle(client, { schema });
}

export type PurchasingDatabase = ReturnType<typeof createDatabase>;

export function getDatabase(): PurchasingDatabase {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required when DATABASE_MODE=postgres.");
  }

  if (!databaseGlobals.purchasingDatabase) {
    databaseGlobals.purchasingSqlClient = postgres(url, { max: 10 });
    databaseGlobals.purchasingDatabase = drizzle(databaseGlobals.purchasingSqlClient, { schema });
  }

  return databaseGlobals.purchasingDatabase;
}
