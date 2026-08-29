"use client";

import { useMemo, useState, useTransition } from "react";

import type { AgentBriefing } from "@/agent/purchasing-briefing";
import { CaseDetail } from "@/components/case-detail";
import type { PurchasingCase } from "@/domain/purchasing";

type Notice = { tone: "success" | "warning" | "error"; message: string } | null;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed.");
  return payload;
}

function decisionTone(decision: PurchasingCase["analysis"]["decision"]["decision"]): string {
  return {
    ACCEPT: "badge-green",
    MODIFY: "badge-amber",
    REJECT: "badge-slate",
    INVESTIGATE_FURTHER: "badge-red",
  }[decision];
}

export function BuyerWorkspace({ initialCases }: { initialCases: PurchasingCase[] }) {
  const [cases, setCases] = useState(initialCases);
  const [selectedId, setSelectedId] = useState(initialCases[0]?.id ?? "");
  const [notice, setNotice] = useState<Notice>(null);
  const [briefings, setBriefings] = useState<Record<string, AgentBriefing>>({});
  const [isPending, startTransition] = useTransition();
  const selected = useMemo(
    () => cases.find((item) => item.id === selectedId) ?? cases[0],
    [cases, selectedId],
  );

  function replaceCase(updated: PurchasingCase) {
    setCases((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  function run(action: () => Promise<{ case: PurchasingCase }>, success: (item: PurchasingCase) => Notice) {
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await action();
        replaceCase(response.case);
        setNotice(success(response.case));
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Request failed." });
      }
    });
  }

  function approve() {
    if (!selected?.proposal) return;
    const approvedVersion = selected.proposal.version;
    run(
      () => postJson(`/api/cases/${selected.id}/approve`, {
        proposalVersion: approvedVersion,
        buyerId: "buyer@procura.demo",
      }),
      (updated) => updated.status === "AWAITING_APPROVAL"
        ? {
          tone: "warning",
          message: `Execution stopped safely. Live data changed, so proposal v${updated.proposal?.version} needs fresh approval.`,
        }
        : { tone: "success", message: `${updated.purchaseOrder?.purchaseOrderId} was created once and validated.` },
    );
  }

  function simulateChange() {
    if (!selected) return;
    run(
      () => postJson(`/api/cases/${selected.id}/simulate-change`, { onHandDelta: 100 }),
      () => ({
        tone: "warning",
        message: "Demo event applied: live on-hand inventory increased by 100. Approve to see revalidation stop the old proposal.",
      }),
    );
  }

  function confirmSupplier(quantity: number) {
    if (!selected) return;
    run(
      () => postJson(`/api/cases/${selected.id}/supplier-confirmation`, { confirmedQuantity: quantity }),
      (updated) => updated.status === "RECOVERY_REQUIRED"
        ? { tone: "warning", message: "Supplier shortfall detected. The case moved into the recovery workflow." }
        : { tone: "success", message: "The supplier confirmed the full order." },
    );
  }

  function generateBriefing() {
    if (!selected) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await postJson<{ briefing: AgentBriefing }>(
          `/api/cases/${selected.id}/briefing`,
        );
        setBriefings((current) => ({ ...current, [selected.id]: response.briefing }));
        setNotice({
          tone: "success",
          message: response.briefing.mode === "OPENAI"
            ? `AI briefing generated with ${response.briefing.model}.`
            : "Briefing generated in deterministic fallback mode; add OPENAI_API_KEY to enable model synthesis.",
        });
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Briefing failed.",
        });
      }
    });
  }

  function reset() {
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await postJson<{ cases: PurchasingCase[] }>("/api/demo/reset");
        setCases(response.cases);
        setSelectedId("CASE-1042");
        setNotice({ tone: "success", message: "Demo cases reset to their initial state." });
      } catch (error) {
        setNotice({ tone: "error", message: error instanceof Error ? error.message : "Reset failed." });
      }
    });
  }

  if (!selected) return null;

  const awaiting = cases.filter((item) => item.status === "AWAITING_APPROVAL").length;
  const escalated = cases.filter((item) => ["ESCALATED", "RECOVERY_REQUIRED"].includes(item.status)).length;

  return (
    <main className="app-shell">
      <aside className="nav-rail">
        <div className="brand-mark">P</div>
        <nav aria-label="Primary navigation">
          <button className="rail-button active" aria-label="Cases"><span>▦</span></button>
          <button className="rail-button" aria-label="Analytics"><span>⌁</span></button>
          <button className="rail-button" aria-label="Suppliers"><span>◇</span></button>
          <button className="rail-button" aria-label="Settings"><span>⚙</span></button>
        </nav>
        <div className="buyer-avatar">BS</div>
      </aside>

      <section className="queue-panel">
        <div className="queue-header">
          <div>
            <div className="eyebrow">Procura workspace</div>
            <h1>Purchasing cases</h1>
          </div>
          <button className="icon-button" onClick={reset} title="Reset demo">↻</button>
        </div>

        <div className="queue-stats">
          <div><strong>{awaiting}</strong><span>Awaiting you</span></div>
          <div><strong>{escalated}</strong><span>Exceptions</span></div>
        </div>

        <div className="queue-filter">
          <span>Attention queue</span>
          <span className="count-pill">{cases.length}</span>
        </div>

        <div className="case-list">
          {cases.map((item) => {
            const recommendation = item.evidence.recommendation.value;
            return (
              <button
                className={`case-card ${item.id === selected.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => { setSelectedId(item.id); setNotice(null); }}
              >
                <div className="case-card-top">
                  <span className="case-id">{item.id}</span>
                  <span className={`decision-badge ${decisionTone(item.analysis.decision.decision)}`}>
                    {item.analysis.decision.decision.replace("_FURTHER", "")}
                  </span>
                </div>
                <strong>{recommendation.productName}</strong>
                <span>{recommendation.nodeName}</span>
                <div className="case-card-bottom">
                  <span className={`priority-dot ${item.priority.toLowerCase()}`} />
                  {item.status.replaceAll("_", " ").toLowerCase()}
                  <time>{formatTime(item.updatedAt)}</time>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <CaseDetail
        purchasingCase={selected}
        notice={notice}
        isPending={isPending}
        onApprove={approve}
        onSimulateChange={simulateChange}
        onSupplierConfirmation={confirmSupplier}
        briefing={briefings[selected.id] ?? null}
        onGenerateBriefing={generateBriefing}
      />
    </main>
  );
}
