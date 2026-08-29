import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL
  ?? "postgresql://purchasing:purchasing@localhost:5433/purchasing_agent";
const client = postgres(url, { max: 1 });
const database = drizzle(client);

try {
  await migrate(database, { migrationsFolder: "drizzle" });
  console.info("Database migrations completed.");
} finally {
  await client.end();
}
