import { getDatabase } from "@/db/client";
import { MemoryCaseRepository, type CaseRepository } from "@/repositories/case-repository";
import { PostgresCaseRepository } from "@/repositories/postgres-case-repository";
import { createDemoCases } from "@/workflows/demo-cases";
import { PurchasingCaseService } from "@/workflows/purchasing-case-service";

type ServiceGlobals = typeof globalThis & {
  purchasingCaseRepository?: CaseRepository;
};

const serviceGlobals = globalThis as ServiceGlobals;

export function getCaseRepository(): CaseRepository {
  if (!serviceGlobals.purchasingCaseRepository) {
    serviceGlobals.purchasingCaseRepository = process.env.DATABASE_MODE === "postgres"
      ? new PostgresCaseRepository(getDatabase())
      : new MemoryCaseRepository(createDemoCases());
  }
  return serviceGlobals.purchasingCaseRepository;
}

export function getPurchasingCaseService(): PurchasingCaseService {
  return new PurchasingCaseService(getCaseRepository());
}

export async function resetDemoCases(): Promise<void> {
  await getCaseRepository().replaceAll(createDemoCases());
}
