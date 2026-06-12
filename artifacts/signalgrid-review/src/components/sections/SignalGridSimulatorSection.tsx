import { useMemo, useState } from "react";
import {
  listSimulatorScenarios,
  runSimulatorScenario,
} from "@/lib/simulator/decisionEngine";
import type { DecisionOutcome, SignalGridLayer, SimulatorRunResult } from "@/lib/simulator/types";

const layerLabels: Record<SignalGridLayer, string> = {
  identity: "Identity Trust",
  device_state_compliance: "Device State & Compliance",
  device: "Device Trust",
  operational_health: "Operational Health / DEX",
  location: "RTLS / Location",
  dockbridge: "DockBridge",
  workflow: "Workflow / ITSM",
  integration: "Integration Health",
  decision: "Decision Engine",
  audit: "Audit Evidence",
};

const outcomeTone: Partial<Record<DecisionOutcome, string>> = {
  allow: "text-teal-300 bg-teal-950/40 border-teal-700/50",
  step_up: "text-amber-300 bg-amber-950/40 border-amber-700/50",
  restrict: "text-red-300 bg-red-950/40 border-red-700/50",
  deny: "text-red-300 bg-red-950/40 border-red-700/50",
  alert_operator: "text-sky-300 bg-sky-950/40 border-sky-700/50",
  create_ticket: "text-violet-300 bg-violet-950/40 border-violet-700/50",
  route_to_owner: "text-stone-200 bg-stone-800/60 border-stone-700",
  request_remediation: "text-amber-200 bg-amber-950/30 border-amber-700/50",
  verify_remediation: "text-teal-200 bg-teal-950/30 border-teal-700/50",
  record_audit: "text-stone-300 bg-stone-900 border-stone-700",
};

const suiteCards = [
  {
    name: "Operator App",
    purpose: "Alert inbox and assigned-action cockpit for frontline operational exceptions.",
    actions: ["Acknowledge", "Escalate", "Verify"],
    events: ["device.low_battery", "rtls.wrong_zone", "dock.device_missing"],
    futureRole: "Mobile and desktop operator workflow for exception triage.",
  },
  {
    name: "Admin App",
    purpose: "Policy, ownership, integration, and audit review surface.",
    actions: ["Review policy", "Tune routing", "Inspect audit"],
    events: ["api.integration_failed", "workflow.assignment_changed"],
    futureRole: "Governed administration for simulator rules and future private-core controls.",
  },
  {
    name: "DockBridge App",
    purpose: "Physical shared-device event shell for dock slots, returns, and overdue devices.",
    actions: ["Inspect slot", "Flag missing", "Resolve return"],
    events: ["dock.device_docked", "dock.device_undocked", "dock.wrong_slot_return"],
    futureRole: "Bridge for smart dock or edge event adapters after software validation.",
  },
  {
    name: "Shared Device Assistant",
    purpose: "Checkout, check-in, QR, badge, and NFC placeholder flow for shared devices.",
    actions: ["Check out", "Check in", "Show session"],
    events: ["identity.authenticated", "device.posture_observed"],
    futureRole: "First software-first mobile/PWA surface before hardware work.",
  },
  {
    name: "Remediation Assistant",
    purpose: "Recommended action, approval gate, validation evidence, and ticket update shell.",
    actions: ["Request review", "Collect evidence", "Verify"],
    events: ["remediation.requested", "remediation.verified", "ticket.updated"],
    futureRole: "Human-approved remediation workflow, not autonomous production action.",
  },
];

export default function SignalGridSimulatorSection() {
  const scenarios = useMemo(() => listSimulatorScenarios(), []);
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [runResult, setRunResult] = useState<SimulatorRunResult>(() => runSimulatorScenario(scenarios[0]?.id ?? ""));

  const layers = useMemo(() => {
    const present = new Set(runResult.normalizedSignals.map((signal) => signal.layer));
    return (Object.keys(layerLabels) as SignalGridLayer[]).map((layer) => ({
      layer,
      active: present.has(layer) || layer === "decision" || layer === "audit",
    }));
  }, [runResult]);

  function runSelectedScenario(nextId = scenarioId) {
    setRunResult(runSimulatorScenario(nextId));
  }

  return (
    <div className="space-y-8">
      <div className="border border-amber-700/40 bg-amber-950/20 rounded-lg px-5 py-4">
        <p className="text-xs font-semibold text-amber-300 tracking-wider uppercase mb-1">
          Simulator boundary
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Public-safe deterministic simulator. It uses fixture data only: no credentials, no customer data, no Microsoft Graph calls, no vendor API calls, and no production enforcement.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-5">
        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
              Simulator Overview
            </p>
            <h3 className="text-xl font-semibold text-foreground mt-1">Runtime trust orchestration loop</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">
              The simulator correlates identity, device posture, operational health, location, DockBridge, workflow, and integration signals, then produces a decision, routed actions, owner assignment, and audit evidence.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Scenarios" value={String(scenarios.length)} />
            <Stat label="Run status" value={runResult.status} />
            <Stat label="Owner" value={runResult.scenario.expectedOwnerTeam} />
            <Stat label="Audit records" value={String(runResult.auditEvidence.length)} />
          </div>
        </div>

        <div className="border border-primary/30 bg-primary/5 rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-primary tracking-wider uppercase">
                Scenario Runner
              </p>
              <h3 className="text-xl font-semibold text-foreground mt-1">{runResult.scenario.title}</h3>
            </div>
            <span className="text-xs px-2 py-1 rounded border border-primary/40 text-primary bg-background/40">
              {runResult.scenario.persona}
            </span>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{runResult.scenario.summary}</p>

          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={scenarioId}
              onChange={(event) => {
                setScenarioId(event.target.value);
                runSelectedScenario(event.target.value);
              }}
              className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
            <button
              onClick={() => runSelectedScenario()}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Run Scenario
            </button>
          </div>

          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            {runResult.scenario.safeDemoNote}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          <PanelTitle title="Signal Grid" subtitle="Active layers in the selected fixture." />
          <div className="space-y-2">
            {layers.map((item) => (
              <div
                key={item.layer}
                className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                  item.active ? "border-primary/40 bg-primary/10" : "border-border bg-muted/20 opacity-55"
                }`}
              >
                <span className="text-xs font-medium text-foreground">{layerLabels[item.layer]}</span>
                <span className={`w-2 h-2 rounded-full ${item.active ? "bg-primary" : "bg-muted-foreground/40"}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 border border-border bg-card rounded-lg p-5 space-y-4">
          <PanelTitle title="Decision Timeline" subtitle="Normalized signal sequence and deterministic decision output." />
          <div className="space-y-3">
            {runResult.normalizedSignals.map((signal, index) => (
              <div key={signal.id} className="grid grid-cols-[2rem_1fr] gap-3">
                <div className="flex flex-col items-center">
                  <span className="w-6 h-6 rounded-full border border-primary/50 bg-primary/10 text-primary text-xs flex items-center justify-center">
                    {index + 1}
                  </span>
                  {index < runResult.normalizedSignals.length - 1 && <span className="w-px h-full bg-border" />}
                </div>
                <div className="pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-foreground">{signal.type}</span>
                    <span className="text-xs text-muted-foreground">{signal.source}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{signal.summary}</p>
                </div>
              </div>
            ))}
            <div className="border-t border-border pt-4">
              <DecisionSummary result={runResult} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          <PanelTitle title="Routed Actions" subtitle="Simulated owner routing, ticketing, retries, and operator alerts." />
          <div className="space-y-3">
            {runResult.routedActions.map((action) => (
              <div key={action.id} className="rounded-md border border-border bg-background/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-foreground">{action.title}</p>
                  <span className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground">
                    {action.priority}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.ownerTeam} via {action.route} - {action.status}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          <PanelTitle title="Audit Evidence" subtitle="Deterministic evidence records produced for the selected run." />
          <div className="space-y-3">
            {runResult.auditEvidence.map((record) => (
              <div key={record.id} className="rounded-md border border-border bg-background/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{record.evidenceType}</p>
                  <span className="text-xs text-muted-foreground">{new Date(record.recordedAt).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{record.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div id="app-suite" className="space-y-5 scroll-mt-20">
        <PanelTitle title="App Suite Preview" subtitle="Thin simulator shells for the first app-suite surfaces." />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {suiteCards.map((app) => (
            <div key={app.name} className="border border-border bg-card rounded-lg p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{app.name}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">{app.purpose}</p>
              </div>
              <div className="space-y-1">
                {app.actions.map((action) => (
                  <div key={action} className="text-xs rounded border border-border bg-muted/20 px-2 py-1 text-muted-foreground">
                    {action}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{app.futureRole}</p>
              <p className="text-[11px] text-amber-300 border-t border-border pt-2">
                Demo shell only. No production integration or credential flow.
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DecisionSummary({ result }: { result: SimulatorRunResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {result.decision.outcomes.map((outcome) => (
          <span
            key={outcome}
            className={`text-xs px-2 py-1 rounded border font-semibold ${outcomeTone[outcome] ?? "text-stone-300 bg-stone-900 border-stone-700"}`}
          >
            {outcome}
          </span>
        ))}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{result.decision.explanation}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {result.decision.reasonCodes.map((code) => (
          <span key={code} className="text-[11px] px-2 py-0.5 rounded bg-muted border border-border text-muted-foreground">
            {code}
          </span>
        ))}
      </div>
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">{title}</p>
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">{subtitle}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-1 line-clamp-2">{value}</p>
    </div>
  );
}
