"use client";

import type { AgentBriefing } from "@/agent/purchasing-briefing";
import type { ConstraintResult, PurchasingCase } from "@/domain/purchasing";

type Notice = { tone: "success" | "warning" | "error"; message: string } | null;

function money(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function constraintIcon(status: ConstraintResult["status"]) {
  return status === "PASS" ? "✓" : status === "ADJUSTED" ? "↳" : "!";
}

export function CaseDetail({
  purchasingCase,
  notice,
  isPending,
  onApprove,
  onSimulateChange,
  onSupplierConfirmation,
  briefing,
  onGenerateBriefing,
}: {
  purchasingCase: PurchasingCase;
  notice: Notice;
  isPending: boolean;
  onApprove: () => void;
  onSimulateChange: () => void;
  onSupplierConfirmation: (quantity: number) => void;
  briefing: AgentBriefing | null;
  onGenerateBriefing: () => void;
}) {
  const { evidence, analysis, proposal, purchaseOrder } = purchasingCase;
  const decision = analysis.decision;
  const plan = analysis.plan;
  const recommendation = evidence.recommendation.value;
  const inventory = evidence.inventory.value;
  const supplier = evidence.supplier.value;
  const isAwaiting = purchasingCase.status === "AWAITING_APPROVAL" && proposal;

  return (
    <section className="detail-panel">
      <header className="detail-header">
        <div>
          <div className="breadcrumb">Purchasing cases <span>/</span> {purchasingCase.id}</div>
          <h2>{recommendation.productName}</h2>
          <p>{recommendation.nodeName} · {supplier.supplierName}</p>
        </div>
        <div className="header-status">
          <span className={`priority-pill ${purchasingCase.priority.toLowerCase()}`}>
            {purchasingCase.priority} priority
          </span>
          <span className="status-pill">{purchasingCase.status.replaceAll("_", " ")}</span>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`}>{notice.message}</div>}

      <div className="detail-content">
        <section className={`decision-hero decision-${decision.decision.toLowerCase()}`}>
          <div className="decision-copy">
            <div className="eyebrow">Agent recommendation · {decision.confidence} confidence</div>
            <h3>{decision.summary}</h3>
            <p>The upstream recommendation was independently rebuilt from live operational evidence.</p>
          </div>
          <div className="quantity-change">
            <div><span>System</span><strong>{decision.originalQuantity}</strong><small>units</small></div>
            <span className="arrow">→</span>
            <div className="recommended"><span>Agent</span><strong>{decision.recommendedQuantity}</strong><small>units</small></div>
          </div>
          {isAwaiting && (
            <div className="approval-actions">
              <button className="primary-button" onClick={onApprove} disabled={isPending}>
                {isPending ? "Revalidating…" : `Approve proposal v${proposal.version}`}
              </button>
              <span>Revalidates live data before any PO is created.</span>
            </div>
          )}
          {purchasingCase.status === "COMPLETED" && purchaseOrder && (
            <div className="completed-action">
              <span className="success-check">✓</span>
              <div><strong>{purchaseOrder.purchaseOrderId} submitted and validated</strong><span>Exactly one matching order exists.</span></div>
            </div>
          )}
          {purchasingCase.status === "RECOVERY_REQUIRED" && (
            <div className="recovery-action">
              <strong>Recovery required</strong>
              <span>The supplier shortfall has re-entered the purchasing workflow.</span>
            </div>
          )}
        </section>

        <div className="content-grid">
          <div className="main-column">
            <section className="surface">
              <div className="section-heading">
                <div><span className="section-number">01</span><div><h3>Evidence reviewed</h3><p>Sources, values, and freshness used for this decision</p></div></div>
                <span className="fresh-badge">● Live evidence</span>
              </div>
              <div className="evidence-grid">
                <EvidenceCard label="Usable on hand" value={`${Math.max(0, inventory.onHandUnits - inventory.reservedUnits - inventory.damagedUnits - inventory.quarantinedUnits - inventory.backorderUnits)}`} unit="units" source={evidence.inventory.source} observedAt={evidence.inventory.observedAt} />
                <EvidenceCard label="Expected demand" value={`${evidence.demand.value.expectedUnits}`} unit={`${evidence.demand.value.protectionPeriodDays} days`} source={evidence.demand.source} observedAt={evidence.demand.observedAt} />
                <EvidenceCard label="Confirmed inbound" value={`${plan?.confirmedInboundUnits ?? 0}`} unit="units" source={evidence.openPurchaseOrders.source} observedAt={evidence.openPurchaseOrders.observedAt} accent />
                <EvidenceCard label="Available budget" value={money(evidence.budget.value.availableAmount, evidence.budget.value.currency)} source={evidence.budget.source} observedAt={evidence.budget.observedAt} />
                <EvidenceCard label="Supplier lead time" value={`${supplier.leadTimeDays}`} unit="days" source={evidence.supplier.source} observedAt={evidence.supplier.observedAt} />
                <EvidenceCard label="Free storage" value={`${evidence.storage.value.availableCapacityUnits}`} unit="units" source={evidence.storage.source} observedAt={evidence.storage.observedAt} />
              </div>
            </section>

            {plan && (
              <section className="surface">
                <div className="section-heading">
                  <div><span className="section-number">02</span><div><h3>How the quantity was calculated</h3><p>Deterministic planning math—not an LLM estimate</p></div></div>
                </div>
                <div className="calculation-strip">
                  <CalcItem label="Demand" value={evidence.demand.value.expectedUnits} />
                  <span>+</span>
                  <CalcItem label="Safety stock" value={evidence.demand.value.safetyStockUnits} />
                  <span>−</span>
                  <CalcItem label="Usable stock" value={plan.usableOnHandUnits} />
                  <span>−</span>
                  <CalcItem label="Inbound" value={plan.confirmedInboundUnits} />
                  <span>=</span>
                  <CalcItem label="Required" value={plan.rawRequirementUnits} highlight />
                </div>

                <div className="projection-wrap">
                  <div className="projection-summary">
                    <div><span>Projected ending balance</span><strong>{Math.round(plan.projectedEndingUnits)} units</strong></div>
                    <div><span>Order value</span><strong>{money(plan.orderCost, plan.currency)}</strong></div>
                    <div><span>Protection through</span><strong>{plan.protectionEndDate}</strong></div>
                  </div>
                  <div className="projection-chart" aria-label="Projected inventory balance">
                    {plan.proposedProjection.map((point) => {
                      const max = Math.max(...plan.proposedProjection.map((item) => Math.abs(item.closingUnits)), 1);
                      const height = Math.max(8, Math.round((Math.abs(point.closingUnits) / max) * 82));
                      return (
                        <div className="projection-bar-wrap" key={point.date} title={`${point.date}: ${point.closingUnits} units`}>
                          <div className={`projection-bar ${point.closingUnits < 0 ? "negative" : ""}`} style={{ height }} />
                          <span>{point.date.slice(8)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {plan && (
              <section className="surface">
                <div className="section-heading">
                  <div><span className="section-number">03</span><div><h3>Constraint checks</h3><p>Hard rules are enforced before an action is proposed</p></div></div>
                </div>
                <div className="constraint-list">
                  {plan.constraints.map((constraint) => (
                    <div className="constraint-row" key={constraint.code}>
                      <span className={`constraint-icon ${constraint.status.toLowerCase()}`}>{constraintIcon(constraint.status)}</span>
                      <div><strong>{constraint.label}</strong><span>{constraint.detail}</span></div>
                      <span className={`constraint-status ${constraint.status.toLowerCase()}`}>{constraint.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="context-column">
            <section className="surface sticky-card">
              <div className="section-heading compact"><div><span className="section-number">04</span><div><h3>Why this decision</h3></div></div></div>
              <div className="agent-briefing-control">
                <div>
                  <span>AI buyer briefing</span>
                  <small>
                    {briefing
                      ? `${briefing.mode.replaceAll("_", " ").toLowerCase()}${briefing.model ? ` · ${briefing.model}` : ""}`
                      : "Generated on demand from the evidence trail"}
                  </small>
                </div>
                <button className="briefing-button" onClick={onGenerateBriefing} disabled={isPending}>
                  {briefing ? "Refresh" : "Generate"}
                </button>
              </div>
              {briefing && (
                <div className="agent-briefing">
                  <strong>{briefing.headline}</strong>
                  <p>{briefing.executiveSummary}</p>
                  <span>{briefing.investigationTrace.length} read-only tools · structured output</span>
                </div>
              )}
              <ul className="factor-list">
                {decision.importantFactors.map((factor) => <li key={factor}>{factor}</li>)}
              </ul>

              {proposal && (
                <div className="proposal-card">
                  <div><span>Proposal</span><strong>v{proposal.version}</strong></div>
                  <div><span>Valid until</span><strong>{formatTime(proposal.validUntil)}</strong></div>
                  <div><span>Action fingerprint</span><code>{proposal.actionFingerprint.slice(0, 12)}…</code></div>
                </div>
              )}

              {isAwaiting && (
                <div className="demo-tools">
                  <span>Safety demo</span>
                  <button className="secondary-button" onClick={onSimulateChange} disabled={isPending}>+100 live inventory</button>
                  <small>Apply this first, then approve. The old action will be stopped and replaced.</small>
                </div>
              )}

              {purchaseOrder && purchasingCase.status === "COMPLETED" && purchaseOrder.status === "SUBMITTED" && (
                <div className="demo-tools">
                  <span>Supplier response demo</span>
                  <button className="secondary-button" onClick={() => onSupplierConfirmation(purchaseOrder.requested.quantity)} disabled={isPending}>Confirm full quantity</button>
                  <button className="secondary-button danger" onClick={() => onSupplierConfirmation(Math.max(0, purchaseOrder.requested.quantity - 150))} disabled={isPending}>Confirm 150 short</button>
                </div>
              )}
            </section>

            <section className="surface">
              <div className="section-heading compact"><div><span className="section-number">05</span><div><h3>Audit trail</h3></div></div></div>
              <div className="timeline">
                {[...purchasingCase.timeline].reverse().map((item) => (
                  <div className="timeline-item" key={item.id}>
                    <span className="timeline-dot" />
                    <div><strong>{item.title}</strong><p>{item.detail}</p><small>{item.actor.toLowerCase()} · {formatTime(item.at)}</small></div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}

function EvidenceCard({ label, value, unit, source, observedAt, accent = false }: {
  label: string;
  value: string;
  unit?: string;
  source: string;
  observedAt: string;
  accent?: boolean;
}) {
  return (
    <div className={`evidence-card ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <div><strong>{value}</strong>{unit && <small>{unit}</small>}</div>
      <p><span className="source-dot" />{source.replaceAll("-", " ")} · {formatTime(observedAt)}</p>
    </div>
  );
}

function CalcItem({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return <div className={highlight ? "highlight" : ""}><span>{label}</span><strong>{value}</strong></div>;
}
