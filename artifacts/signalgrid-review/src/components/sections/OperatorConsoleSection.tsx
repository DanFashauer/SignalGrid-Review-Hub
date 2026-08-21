import { useMemo, useState } from "react";
import {
  SignalGridCore,
  reconcileDecisions,
  type AuditEvent,
  type Decision,
  type DecisionOutcome,
  type DecisionProvenance,
  type ReconcilableDecision,
  type StandingBound,
  type EvidenceSnapshot,
  type MetricsSummary,
  type PolicyVersion,
  type RemediationAction,
  type ResolutionPlan,
  type ResolutionSimulation,
  type SimulationResult,
  type WebhookDelivery,
} from "@workspace/signalgrid-core";

/**
 * Operator Console — a public-safe, in-browser trace of the SignalGrid decision
 * loop. It runs the deterministic core directly in the browser (no network, no
 * credentials, no live vendor calls) so a reviewer can follow a shared-device
 * access decision from outcome → matched rules → evidence snapshot → policy
 * version → tamper-evident audit chain.
 */

const OPERATOR_TOKEN = "sgk_demo_northwind_operator";
const OWNER_TOKEN = "sgk_demo_northwind_owner";

interface ScenarioSpec {
  label: string;
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
}

const SCENARIOS: ScenarioSpec[] = [
  { label: "Compliant nurse · clinical session", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  { label: "Non-compliant device", identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" },
  { label: "Stale posture", identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" },
  { label: "Unmanaged personal device", identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "general-lookup" },
  { label: "Disabled account", identityRef: "nurse.disabled", deviceRef: "ipad-ward-04", workflowKey: "clinical-session" },
  { label: "Missing posture (never synced)", identityRef: "nurse.nosync", deviceRef: "ipad-ward-05", workflowKey: "clinical-session" },
  { label: "Critical workflow · untrusted device", identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "med-admin" },
  { label: "Overdue device return (DockBridge)", identityRef: "nurse.overdue", deviceRef: "ipad-loan-01", workflowKey: "clinical-session" },
  { label: "Device flagged for tamper (DockBridge)", identityRef: "nurse.tamper", deviceRef: "ipad-loan-02", workflowKey: "clinical-session" },
  // Fully charged AND restricted — the pair that only makes sense once battery
  // HEALTH is its own evidence row. Added because the E2E suite proved the row
  // rendered nowhere: the core carried BATTERY_FAILING, the console had the row,
  // and no scenario ever produced a batteryHealth value to show in it.
  { label: "Failing battery (SmartDock)", identityRef: "nurse.failbatt", deviceRef: "ipad-loan-04", workflowKey: "clinical-session" },
  { label: "Critically low battery (DockBridge)", identityRef: "nurse.lowbatt", deviceRef: "ipad-loan-03", workflowKey: "clinical-session" },
  { label: "Security-baseline drift (CIS)", identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06", workflowKey: "clinical-session" },
  { label: "Badge pulled from reader case", identityRef: "nurse.badge_removed", deviceRef: "ipad-badge-01", workflowKey: "clinical-session" },
  { label: "Badge forced from reader case", identityRef: "nurse.badge_forced", deviceRef: "ipad-badge-02", workflowKey: "clinical-session" },
  { label: "SmartDock faulted", identityRef: "nurse.dock_faulted", deviceRef: "ipad-dock-01", workflowKey: "clinical-session" },
  { label: "SmartDock offline", identityRef: "nurse.dock_offline", deviceRef: "ipad-dock-02", workflowKey: "clinical-session" },
];

const outcomeTone: Record<DecisionOutcome, string> = {
  allow: "bg-status-allow",
  step_up: "bg-status-step-up",
  restrict: "bg-status-restrict",
  deny: "bg-status-deny",
};

const outcomeLabel: Record<DecisionOutcome, string> = {
  allow: "ALLOW",
  step_up: "STEP-UP",
  restrict: "RESTRICT",
  deny: "DENY",
};

interface Row {
  label: string;
  decision: Decision;
  snapshot: EvidenceSnapshot;
  evidenceVerified: boolean;
  simulations: SimulationResult[];
  resolution: ResolutionPlan;
  resolutionSim: ResolutionSimulation;
}

export default function OperatorConsoleSection() {
  const { rows, auditChain, metrics, versions, audit, deliveries, remediations } =
    useMemo(() => {
    const core = SignalGridCore.demo();
    const evaluated = SCENARIOS.map((scenario) => {
      const result = core.evaluate(OPERATOR_TOKEN, {
        identityRef: scenario.identityRef,
        deviceRef: scenario.deviceRef,
        workflowKey: scenario.workflowKey,
      });
      return { scenario, result };
    });
    const policyId = evaluated[0]?.result.policyId ?? "";
    const policyVersions = policyId
      ? core.listPolicyVersions(OWNER_TOKEN, policyId)
      : [];
    const built: Row[] = evaluated.map(({ scenario, result }) => {
      const decision = core.getDecision(OPERATOR_TOKEN, result.decisionId);
      const snapshot = core.getSnapshot(OPERATOR_TOKEN, result.evidenceSnapshotId);
      const evidenceVerified = core.verifyEvidence(OPERATOR_TOKEN, snapshot.id);
      const simulations = policyVersions.map((version) =>
        core.simulateDecision(OPERATOR_TOKEN, decision.id, version.id),
      );
      const resolution = core.getResolution(OPERATOR_TOKEN, decision.id);
      const resolutionSim = core.simulateResolution(OPERATOR_TOKEN, decision.id);
      return {
        label: scenario.label,
        decision,
        snapshot,
        evidenceVerified,
        simulations,
        resolution,
        resolutionSim,
      };
    });
    return {
      rows: built,
      auditChain: core.verifyAudit(OWNER_TOKEN),
      metrics: core.metrics(OPERATOR_TOKEN),
      versions: policyVersions,
      audit: core.listAudit(OWNER_TOKEN).slice(-9).reverse(),
      deliveries: core.listWebhookDeliveries(OWNER_TOKEN),
      remediations: core.listRemediations(OWNER_TOKEN),
    };
  }, []);

  const [selectedId, setSelectedId] = useState<string>(rows[0]?.decision.id ?? "");
  const selected = rows.find((row) => row.decision.id === selectedId) ?? rows[0];

  return (
    <div className="space-y-5">
      <div className="border border-primary/30 bg-primary/5 rounded-lg px-5 py-3">
        <p className="text-xs text-foreground leading-relaxed">
          <strong className="text-primary">Public-safe alpha.</strong> Every
          decision below is produced by the deterministic SignalGrid core running{" "}
          <em>in your browser</em> against synthetic fixtures — no credentials, no
          tenant data, no Microsoft Graph call. It demonstrates the product-shaped
          decision loop, versioned policy, evidence snapshots, and tamper-evident
          audit chain; it is not a production system.
        </p>
      </div>

      <MetricsTiles metrics={metrics} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Decisions list */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            Decisions ({rows.length})
          </p>
          <div className="space-y-1.5">
            {rows.map((row) => {
              const active = row.decision.id === selected?.decision.id;
              return (
                <button
                  key={row.decision.id}
                  onClick={() => setSelectedId(row.decision.id)}
                  className={`w-full text-left border rounded-lg px-3.5 py-3 transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-card hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground truncate">
                      {row.label}
                    </span>
                    <span
                      className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 ${outcomeTone[row.decision.outcome]}`}
                    >
                      {outcomeLabel[row.decision.outcome]}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 font-mono truncate">
                    {row.decision.reasonCodes.join(", ")}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="border border-border/60 bg-muted/20 rounded-lg px-3.5 py-3 mt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Audit chain (Northwind tenant)
              </span>
              <span
                className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                  auditChain.valid
                    ? "text-teal-300 bg-teal-950/40 border-teal-700/50"
                    : "text-red-300 bg-red-950/40 border-red-700/50"
                }`}
              >
                {auditChain.valid ? "VERIFIED" : "BROKEN"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {auditChain.length} tamper-evident events, digest-chained.
            </p>
          </div>
        </div>

        {/* Decision detail trace */}
        <div className="lg:col-span-3">
          {selected && (
            <DecisionDetail row={selected} versions={versions} />
          )}
        </div>
      </div>

      <ContinuityPanel />

      <OperationsPanels
        audit={audit}
        deliveries={deliveries}
        remediations={remediations}
      />
    </div>
  );
}

/**
 * Decision continuity — what happens when the device and the control plane
 * disagree because the network was down.
 *
 * Runs the REAL reconciler (`reconcileDecisions` from `@workspace/signalgrid-core`)
 * in the browser, exactly as the rest of this console runs the real core. Nothing here
 * is a mock-up of an answer: the outcome, reason codes, frontier and expiry below are
 * whatever the function returns for the inputs shown next to them, so a change to the
 * reduction changes what a reviewer reads here.
 *
 * The four cases are the ones that distinguish this from the two merges a reader will
 * assume — a clock tiebreak and a CRDT join. Case 1 is the reason it is not
 * last-write-wins, case 2 is the reason it is not a pure join, case 3 is what happens
 * when neither side is newer, and case 4 is the bound on how long an offline answer may
 * stand.
 */
function ContinuityPanel() {
  const cases = useMemo(() => {
    const prov = (over: Partial<DecisionProvenance>): DecisionProvenance => ({
      policyVersion: 1,
      evaluatedOffline: false,
      policyKnownSuperseded: false,
      ...over,
    });
    const specs: Array<{
      title: string;
      question: string;
      records: ReconcilableDecision[];
      standingBound?: StandingBound;
    }> = [
      {
        title: "Offline device holds the NEWER policy and says allow",
        question:
          "The control plane, fully connected, said deny under policy 7. The device evaluated policy 8 alone with a source unreachable. Newer — but on less evidence.",
        records: [
          { id: "control-plane", outcome: "deny", provenance: prov({ policyVersion: 7, coreNormalizationVersion: 2 }) },
          { id: "device", outcome: "allow", provenance: prov({ policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true }) },
        ],
      },
      {
        title: "Connected control plane relaxes a stale deny",
        question:
          "The same shape with the authority ONLINE. Policy 8 exists precisely so something policy 7 restricted can now be allowed — a lattice that could not do this would be safe and stuck.",
        records: [
          { id: "stale-device", outcome: "deny", provenance: prov({ policyVersion: 7, coreNormalizationVersion: 2 }) },
          { id: "control-plane", outcome: "allow", provenance: prov({ policyVersion: 8, coreNormalizationVersion: 2 }) },
        ],
      },
      {
        title: "Staged rollout — neither side is newer",
        question:
          "One node is ahead on policy, the other on the core build. The provenances are incomparable, so no side is the authority.",
        records: [
          { id: "node-a", outcome: "allow", provenance: prov({ policyVersion: 8, coreNormalizationVersion: 1 }) },
          { id: "node-b", outcome: "restrict", provenance: prov({ policyVersion: 7, coreNormalizationVersion: 2 }) },
        ],
      },
      {
        title: "An offline answer whose age nobody stated",
        question:
          "A bound is posed but the caller says nothing about how long this decision has been standing. Silence is not freshness.",
        records: [
          { id: "device", outcome: "allow", provenance: prov({ policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true }) },
        ],
        standingBound: { maxStandingSeconds: 3600, elapsedSecondsById: {} },
      },
    ];
    return specs.map((spec) => ({
      ...spec,
      result: reconcileDecisions(spec.records, spec.standingBound ? { standingBound: spec.standingBound } : {}),
    }));
  }, []);

  return (
    <div className="border border-border rounded-lg bg-card/40 p-5 space-y-4">
      <div>
        <p className="text-sm font-semibold text-foreground">
          Decision continuity — which decision wins after a partition
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          A device that keeps working offline keeps deciding offline, so on reconnect two
          answers exist for one subject and action. This runs the real reconciler in your
          browser. It is not a clock tiebreak — on a shared device the clock is settable
          by whoever holds it — and not a CRDT join, because a join only moves one way
          and policy relaxation moves the other.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {cases.map((c) => (
          <div key={c.title} className="border border-border/70 rounded-md p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-foreground">{c.title}</p>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{c.question}</p>
            </div>

            <div className="space-y-1">
              {c.records.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground truncate">
                    {r.id}
                    {r.provenance.evaluatedOffline ? " · offline" : ""}
                  </span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    p{r.provenance.policyVersion}
                    {r.provenance.coreNormalizationVersion === undefined
                      ? "/c?"
                      : `/c${r.provenance.coreNormalizationVersion}`}{" "}
                    said {outcomeLabel[r.outcome]}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60">
              <span className="text-[11px] text-muted-foreground">Stands</span>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${outcomeTone[c.result.outcome]}`}
              >
                {outcomeLabel[c.result.outcome]}
              </span>
            </div>

            <div className="space-y-1">
              <EvidenceRow
                label="Provenance authority"
                value={c.result.authorityIds.join(", ")}
                mono
              />
              <EvidenceRow
                label="Contested frontier"
                value={c.result.contested ? "yes — fail-closed" : "no"}
                tone={c.result.contested ? "warn" : undefined}
              />
              {c.result.expiredIds.length > 0 && (
                <EvidenceRow
                  label="Expired to floor"
                  value={c.result.expiredIds.join(", ")}
                  mono
                  tone="warn"
                />
              )}
            </div>

            <div className="flex flex-wrap gap-1">
              {c.result.reasonCodes.map((code) => (
                <span
                  key={code}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border/70 text-muted-foreground"
                >
                  {code}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationsPanels({
  audit,
  deliveries,
  remediations,
}: {
  audit: AuditEvent[];
  deliveries: WebhookDelivery[];
  remediations: RemediationAction[];
}) {
  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const retried = deliveries.filter(
    (d) => d.attempts.length > 1 && d.status === "delivered",
  ).length;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Audit ledger */}
      <div className="border border-border bg-card rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
          Audit ledger
        </p>
        <div className="space-y-2">
          {audit.map((event) => (
            <div key={event.id} className="flex items-start gap-2 text-[11px]">
              <span className="font-mono text-faint text-muted-foreground/70 tabular-nums">
                #{event.seq}
              </span>
              <div className="min-w-0">
                <span className="font-mono text-teal-300/80">{event.type}</span>
                <p className="text-muted-foreground truncate">{event.summary}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook deliveries */}
      <div className="border border-border bg-card rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
          Webhook deliveries
        </p>
        <p className="text-[11px] text-muted-foreground mb-3">
          {delivered}/{deliveries.length} delivered · {retried} recovered after
          retry/backoff (simulated sink).
        </p>
        <div className="space-y-1.5">
          {deliveries.slice(0, 6).map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="font-mono text-muted-foreground truncate">
                {d.endpointId.split("_").slice(-1)[0]} · {d.attempts.length} try
                {d.attempts.length > 1 ? "s" : ""}
              </span>
              <span
                className={`font-mono px-1.5 py-0.5 rounded border ${
                  d.status === "delivered"
                    ? "text-teal-300 bg-teal-950/40 border-teal-700/50"
                    : "text-red-300 bg-red-950/40 border-red-700/50"
                }`}
              >
                {d.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Remediation queue */}
      <div className="border border-border bg-card rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
          Remediation queue
        </p>
        <p className="text-[11px] text-muted-foreground mb-3">
          {remediations.length} proposed · every one approval-required and
          simulated. SignalGrid never executes a change.
        </p>
        <div className="space-y-1.5">
          {remediations.slice(0, 6).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="font-mono text-muted-foreground truncate">
                {r.kind}
              </span>
              <span className="font-mono px-1.5 py-0.5 rounded border text-amber-300 bg-amber-950/40 border-amber-700/50">
                approval
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricsTiles({ metrics }: { metrics: MetricsSummary }) {
  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    { label: "Decisions", value: String(metrics.totalDecisions) },
    {
      label: "Allow",
      value: String(metrics.byOutcome.allow),
      tone: "text-teal-300",
    },
    {
      label: "Step-up",
      value: String(metrics.byOutcome.step_up),
      tone: "text-amber-300",
    },
    {
      label: "Restrict / Deny",
      value: String(metrics.byOutcome.restrict + metrics.byOutcome.deny),
      tone: "text-red-300",
    },
    { label: "p95 latency", value: `${metrics.p95LatencyMs}ms` },
    {
      label: "With policy version",
      value: `${metrics.decisionsWithPolicyVersion}/${metrics.totalDecisions}`,
    },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="border border-border bg-card rounded-lg px-3 py-2.5"
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
            {tile.label}
          </p>
          <p className={`text-lg font-bold ${tile.tone ?? "text-foreground"}`}>
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function DecisionDetail({
  row,
  versions,
}: {
  row: Row;
  versions: PolicyVersion[];
}) {
  const { decision, snapshot, evidenceVerified } = row;
  const evidence = snapshot.evidence;

  return (
    <div className="border border-border bg-card rounded-lg p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Decision</p>
          <p className="text-sm font-mono text-foreground">{decision.id}</p>
        </div>
        <span
          className={`text-xs font-mono font-semibold px-2 py-1 rounded border ${outcomeTone[decision.outcome]}`}
        >
          {outcomeLabel[decision.outcome]}
        </span>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        {decision.explanation}
      </p>

      <TraceBlock title="Decision evidence">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <EvidenceRow label="Identity enabled" value={String(evidence.identityEnabled)} />
          <EvidenceRow label="Device managed" value={String(evidence.deviceManaged)} />
          <EvidenceRow label="Compliance" value={evidence.deviceCompliance} />
          <EvidenceRow label="Posture freshness" value={evidence.postureFreshness} />
          <EvidenceRow label="Encrypted" value={String(evidence.deviceEncrypted)} />
          <EvidenceRow label="OS supported" value={String(evidence.osSupported)} />
          <EvidenceRow label="Owner type" value={evidence.ownerType} />
          <EvidenceRow label="Workflow risk" value={evidence.workflowRiskTier} />
          {evidence.custodyState !== "unknown" && (
            <EvidenceRow
              label="Custody (dock)"
              value={evidence.custodyState}
              tone={
                evidence.custodyState === "overdue" || evidence.custodyState === "exception"
                  ? "warn"
                  : undefined
              }
            />
          )}
          {evidence.dockChargeState !== "unknown" && (
            <EvidenceRow
              label="Battery charge"
              value={evidence.dockChargeState}
              tone={evidence.dockChargeState === "critical" ? "warn" : undefined}
            />
          )}
          {/* Rendered separately from charge, and it has to be: a failing battery
              can sit next to `charged`, so without its own row an operator sees a
              RESTRICT with no visible cause. */}
          {evidence.batteryHealth !== "unknown" && (
            <EvidenceRow
              label="Battery health"
              value={evidence.batteryHealth}
              tone={evidence.batteryHealth === "failing" ? "warn" : undefined}
            />
          )}
          {evidence.tamperState !== "unknown" && evidence.tamperState !== "none" && (
            <EvidenceRow label="Tamper" value={evidence.tamperState} tone="warn" />
          )}
          {evidence.dockState !== "unknown" && evidence.dockState !== "occupied" && (
            <EvidenceRow
              label="Dock (SmartDock)"
              value={evidence.dockState}
              tone={
                evidence.dockState === "faulted" || evidence.dockState === "offline"
                  ? "warn"
                  : undefined
              }
            />
          )}
          {evidence.baselineCompliance !== "unknown" && (
            <EvidenceRow
              label="Security baseline (CIS)"
              value={evidence.baselineCompliance}
              tone={
                evidence.baselineCompliance === "aligned"
                  ? "ok"
                  : evidence.baselineCompliance === "drifted"
                    ? "warn"
                    : undefined
              }
            />
          )}
          {evidence.badgeBinding !== "unknown" && (
            <EvidenceRow
              label="Badge binding (reader case)"
              value={evidence.badgeBinding}
              tone={
                evidence.badgeBinding === "present"
                  ? "ok"
                  : evidence.badgeBinding === "forced"
                    ? "warn"
                    : evidence.badgeBinding === "removed"
                      ? "warn"
                      : undefined
              }
            />
          )}
          <EvidenceRow
            label="Critical evidence intact"
            value={String(evidence.criticalSignalsPresent)}
            tone={evidence.criticalSignalsPresent ? "ok" : "warn"}
          />
        </div>
      </TraceBlock>

      <TraceBlock title={`Matched rules (${decision.matchedRules.length})`}>
        {decision.matchedRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No rule matched — the engine defaulted to step-up (fail-closed).
          </p>
        ) : (
          <div className="space-y-1.5">
            {decision.matchedRules.map((rule) => (
              <div
                key={rule.ruleId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="font-mono text-muted-foreground truncate">
                  {rule.reasonCode}
                </span>
                <span
                  className={`font-mono px-1.5 py-0.5 rounded border shrink-0 ${outcomeTone[rule.outcome]}`}
                >
                  {outcomeLabel[rule.outcome]} · {rule.severity}
                </span>
              </div>
            ))}
          </div>
        )}
      </TraceBlock>

      <TraceBlock title="Evidence snapshot & policy">
        <div className="space-y-1.5">
          <EvidenceRow label="Policy version" value={`v${snapshot.policyVersion}`} />
          <EvidenceRow label="Policy version id" value={snapshot.policyVersionId} mono />
          <EvidenceRow label="Snapshot id" value={snapshot.id} mono />
          <EvidenceRow label="Snapshot digest" value={snapshot.digest} mono />
          <EvidenceRow
            label="Snapshot integrity"
            value={evidenceVerified ? "verified" : "tampered"}
            tone={evidenceVerified ? "ok" : "warn"}
          />
          {/*
            The THIRD STATE this panel did not previously have.

            "Snapshot integrity" is a boolean and renders only verified/tampered, which
            is why provenance is reported on its own row rather than folded into it: a
            snapshot minted before stamping existed is not tampered, it is simply
            unstamped, and there was no way to say that. Absence is shown as absence —
            never coerced to 0, never back-dated to 1.
          */}
          <EvidenceRow
            label="Core normalization"
            value={
              snapshot.coreNormalizationVersion === undefined
                ? "unstamped (pre-provenance)"
                : `v${snapshot.coreNormalizationVersion}`
            }
          />
          <div className="pt-1">
            <p className="text-[11px] text-muted-foreground mb-1">
              Source references
            </p>
            {snapshot.sourceReferences.map((ref) => (
              <p key={ref} className="text-[11px] font-mono text-muted-foreground">
                {ref}
              </p>
            ))}
          </div>
        </div>
      </TraceBlock>

      <TraceBlock title="Policy Lab — replay against policy versions">
        <p className="text-[11px] text-muted-foreground mb-2">
          The same immutable evidence, re-evaluated against each policy version.
          No stored state changes.
        </p>
        <div className="space-y-1.5">
          {row.simulations.map((sim) => {
            const version = versions.find(
              (v) => v.id === sim.simulatedPolicyVersionId,
            );
            const isActive = version?.status === "active";
            return (
              <div
                key={sim.simulatedPolicyVersionId}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground">
                  Policy v{sim.simulatedPolicyVersion}
                  {isActive ? " (active)" : version ? ` (${version.status})` : ""}
                </span>
                <span className="flex items-center gap-2">
                  {sim.changed && (
                    <span className="text-[10px] text-amber-300">changed</span>
                  )}
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded border ${outcomeTone[sim.simulatedOutcome]}`}
                  >
                    {outcomeLabel[sim.simulatedOutcome]}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </TraceBlock>

      {decision.outcome !== "allow" && (
        <TraceBlock title="Resolution Assistant — self-service &amp; escalation">
          <p className="text-[11px] text-muted-foreground mb-2">
            {row.resolution.summaryForWorker}
          </p>
          <div className="space-y-1.5">
            {row.resolution.steps.map((step) => (
              <div
                key={step.order}
                className="flex items-start justify-between gap-2 text-[11px]"
              >
                <span className="text-muted-foreground min-w-0">
                  <span className="text-foreground/80">{step.audience}</span> ·{" "}
                  {step.action}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {step.channel}
                  </span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded border ${resolutionClassTone[step.resolutionClass]}`}
                  >
                    {resolutionClassLabel[step.resolutionClass]}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/60">
            <span className="text-[11px] text-muted-foreground">
              Simulated resolution (approval-gated · nothing executed)
            </span>
            <span
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                row.resolutionSim.resolved
                  ? "text-teal-300 bg-teal-950/40 border-teal-700/50"
                  : "text-amber-300 bg-amber-950/40 border-amber-700/50"
              }`}
            >
              {row.resolutionSim.resolved
                ? "→ ALLOW"
                : `→ ${outcomeLabel[row.resolutionSim.projectedOutcome]} · needs escalation`}
            </span>
          </div>
        </TraceBlock>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border pt-3">
        <span>
          Review status:{" "}
          <span className="text-foreground">{decision.reviewStatus}</span>
        </span>
        <span>latency ~{decision.latencyMs}ms</span>
      </div>
    </div>
  );
}

const resolutionClassTone: Record<string, string> = {
  auto_proposed: "text-teal-300 bg-teal-950/40 border-teal-700/50",
  requires_approval: "text-amber-300 bg-amber-950/40 border-amber-700/50",
  manual_only: "text-red-300 bg-red-950/40 border-red-700/50",
};

const resolutionClassLabel: Record<string, string> = {
  auto_proposed: "self-service",
  requires_approval: "approval",
  manual_only: "manual",
};

function TraceBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

function EvidenceRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "ok" | "warn";
}) {
  const valueTone =
    tone === "ok"
      ? "text-teal-300"
      : tone === "warn"
        ? "text-amber-300"
        : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={`text-[11px] ${mono ? "font-mono" : ""} ${valueTone} truncate max-w-[60%] text-right`}
      >
        {value}
      </span>
    </div>
  );
}
