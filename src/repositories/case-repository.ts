import type { PurchasingCase } from "@/domain/purchasing";

export interface CaseRepository {
  list(): Promise<PurchasingCase[]>;
  get(caseId: string): Promise<PurchasingCase | null>;
  mutate(
    caseId: string,
    mutation: (current: PurchasingCase) => PurchasingCase,
  ): Promise<PurchasingCase>;
  replaceAll(cases: PurchasingCase[]): Promise<void>;
}

export class CaseNotFoundError extends Error {}
export class CaseRevisionConflictError extends Error {}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryCaseRepository implements CaseRepository {
  private cases = new Map<string, PurchasingCase>();

  constructor(initialCases: PurchasingCase[] = []) {
    this.cases = new Map(initialCases.map((item) => [item.id, clone(item)]));
  }

  async list(): Promise<PurchasingCase[]> {
    return [...this.cases.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async get(caseId: string): Promise<PurchasingCase | null> {
    const found = this.cases.get(caseId);
    return found ? clone(found) : null;
  }

  async mutate(
    caseId: string,
    mutation: (current: PurchasingCase) => PurchasingCase,
  ): Promise<PurchasingCase> {
    const current = this.cases.get(caseId);
    if (!current) {
      throw new CaseNotFoundError(`Case ${caseId} was not found.`);
    }

    const updated = mutation(clone(current));
    this.cases.set(caseId, clone(updated));
    return clone(updated);
  }

  async replaceAll(cases: PurchasingCase[]): Promise<void> {
    this.cases = new Map(cases.map((item) => [item.id, clone(item)]));
  }
}
