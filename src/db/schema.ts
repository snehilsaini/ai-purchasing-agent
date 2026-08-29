import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import type { PurchasingCase } from "@/domain/purchasing";

export const purchasingCases = pgTable(
  "purchasing_cases",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    decision: text("decision").notNull(),
    proposalVersion: integer("proposal_version"),
    revision: integer("revision").notNull().default(1),
    aggregate: jsonb("aggregate").$type<PurchasingCase>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("purchasing_cases_status_idx").on(table.status),
    index("purchasing_cases_updated_at_idx").on(table.updatedAt),
  ],
);

export type PurchasingCaseRow = typeof purchasingCases.$inferSelect;
