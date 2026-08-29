import { and, desc, eq, sql } from "drizzle-orm";

import { purchasingCases } from "@/db/schema";
import type { PurchasingDatabase } from "@/db/client";
import type { PurchasingCase } from "@/domain/purchasing";
import {
  CaseNotFoundError,
  CaseRevisionConflictError,
  type CaseRepository,
} from "@/repositories/case-repository";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function rowValues(purchasingCase: PurchasingCase) {
  return {
    id: purchasingCase.id,
    eventType: purchasingCase.eventType,
    status: purchasingCase.status,
    priority: purchasingCase.priority,
    decision: purchasingCase.analysis.decision.decision,
    proposalVersion: purchasingCase.proposal?.version ?? null,
    aggregate: clone(purchasingCase),
    createdAt: purchasingCase.createdAt,
    updatedAt: purchasingCase.updatedAt,
  };
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly database: PurchasingDatabase) {}

  async list(): Promise<PurchasingCase[]> {
    const rows = await this.database
      .select({ aggregate: purchasingCases.aggregate })
      .from(purchasingCases)
      .orderBy(desc(purchasingCases.updatedAt));
    return rows.map((row) => clone(row.aggregate));
  }

  async get(caseId: string): Promise<PurchasingCase | null> {
    const [row] = await this.database
      .select({ aggregate: purchasingCases.aggregate })
      .from(purchasingCases)
      .where(eq(purchasingCases.id, caseId))
      .limit(1);
    return row ? clone(row.aggregate) : null;
  }

  async mutate(
    caseId: string,
    mutation: (current: PurchasingCase) => PurchasingCase,
  ): Promise<PurchasingCase> {
    const [row] = await this.database
      .select({
        revision: purchasingCases.revision,
        aggregate: purchasingCases.aggregate,
      })
      .from(purchasingCases)
      .where(eq(purchasingCases.id, caseId))
      .limit(1);

    if (!row) throw new CaseNotFoundError(`Case ${caseId} was not found.`);

    const updated = mutation(clone(row.aggregate));
    const [saved] = await this.database
      .update(purchasingCases)
      .set({
        ...rowValues(updated),
        revision: sql`${purchasingCases.revision} + 1`,
      })
      .where(and(
        eq(purchasingCases.id, caseId),
        eq(purchasingCases.revision, row.revision),
      ))
      .returning({ aggregate: purchasingCases.aggregate });

    if (!saved) {
      throw new CaseRevisionConflictError(
        `Case ${caseId} changed during this operation. Reload it and retry.`,
      );
    }
    return clone(saved.aggregate);
  }

  async replaceAll(cases: PurchasingCase[]): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(purchasingCases);
      if (cases.length > 0) {
        await transaction.insert(purchasingCases).values(
          cases.map((item) => ({ ...rowValues(item), revision: 1 })),
        );
      }
    });
  }
}
