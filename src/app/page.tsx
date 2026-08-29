import { BuyerWorkspace } from "@/components/buyer-workspace";
import { getPurchasingCaseService } from "@/workflows/service-container";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cases = await getPurchasingCaseService().listCases();
  return <BuyerWorkspace initialCases={cases} />;
}
