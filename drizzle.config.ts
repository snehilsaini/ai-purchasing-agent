import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL
      ?? "postgresql://purchasing:purchasing@localhost:5433/purchasing_agent",
  },
  strict: true,
  verbose: true,
});
