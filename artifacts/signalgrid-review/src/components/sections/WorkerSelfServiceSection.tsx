import { useMemo, useState } from "react";
import {
  SignalGridCore,
  type Decision,
  type DecisionOutcome,
  type ResolutionPlan,
  type ResolutionSimulation,
} from "@workspace/signalgrid-core";

/**
 * Worker Self-Service — the frontline worker's view on the shared device.
 *
 * This is the customer-facing side of the Resolution Assistant: when a session
 * is blocked, the worker sees, in plain language, what is happening and the
 * steps they can take to resolve it themselves — with the safe path highlighted
 * and only genuine security/compliance blocks handed to an operator. It runs
 * the deterministic core in-browser over synthetic data (no network).
 */

const OPERATOR_TOKEN = "sgk_demo_northwind_operator";

interface WorkerScenario {
  worker: string;
  role: string;
  device: string;
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
  workflowLabel: string;
}

const SCENARIOS: WorkerScenario[] = [
  { worker: "Alex R.", role: "Nurse", device: "Ward iPad 01", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session", workflowLabel: "Clinical session" },
  { worker: "Priya S.", role: "Nurse", device: "Ward iPad 03", identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session", workflowLabel: "Clinical session" },
  { worker: "Marco T.", role: "Nurse", device: "Ward iPad 02", identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session", workflowLabel: "Clinical session" },
  { worker: "Dana K.", role: "Technician", device: "Personal iPad", identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "general-lookup", workflowLabel: "Directory lookup" },
  { worker: "Sam W.", role: "Nurse", device: "Ward iPad 04", identityRef: "nurse.disabled", deviceRef: "ipad-ward-04", workflowKey: "clinical-session", workflowLabel: "Clinical session" },
];

interface WorkerCase {
  scenario: WorkerScenario;
  decision: Decision;
  resolution: ResolutionPlan;
  sim: ResolutionSimulation;
}

const title: Record<DecisionOutcome, string> = {
  allow: "You're all set",
  step_up: "One quick step needed",
  restrict: "Access is limited right now",
  deny: "Access is blocked",
};

const tone: Record<DecisionOutcome, string> = {
  allow: "text-teal-300",
  step_up: "text-amber-300",
  restrict: "text-orange-300",
  deny: "text-red-300",
};

const channelLabel: Record<string, string> = {
  device_prompt: "On this device",
  credential_reader: "At the badge reader",
  smart_locker: "At the locker / bay",
  operator_console: "Your operator",
  itsm_ticket: "IT — request raised",
  notify_owner: "Your manager / IT",
};

export default function WorkerSelfServiceSection() {
  const cases = useMemo<WorkerCase[]>(() => {
    const core = SignalGridCore.demo();
    return SCENARIOS.map((scenario) => {
      const result = core.evaluate(OPERATOR_TOKEN, {
        identityRef: scenario.identityRef,
        deviceRef: scenario.deviceRef,
        workflowKey: scenario.workflowKey,
      });
      const decision = core.getDecision(OPERATOR_TOKEN, result.decisionId);
      const resolution = core.getResolution(OPERATOR_TOKEN, decision.id);
      const sim = core.simulateResolution(OPERATOR_TOKEN, decision.id);
      return { scenario, decision, resolution, sim };
    });
  }, []);

  const [selected, setSelected] = useState(1); // default to the self-service case
  const current = cases[selected] ?? cases[0];

  return (
    <div className="space-y-5">
      <div className="border border-primary/30 bg-primary/5 rounded-lg px-5 py-3">
        <p className="text-xs text-foreground leading-relaxed">
          <strong className="text-primary">What the worker sees.</strong> When a
          shared-device session is blocked, SignalGrid shows the frontline worker
          a plain-language reason and the steps to fix it — resolving the safe
          cases in place and only escalating genuine security or compliance
          blocks. Public-safe synthetic data, deterministic, in your browser.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Persona picker */}
        <div className="lg:col-span-2 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
            Try a worker
          </p>
          {cases.map((c, i) => (
            <button
              key={c.decision.id}
              onClick={() => setSelected(i)}
              className={`w-full text-left border rounded-lg px-3.5 py-3 transition-colors ${
                i === selected
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card hover:bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground">
                  {c.scenario.worker}{" "}
                  <span className="text-muted-foreground">· {c.scenario.role}</span>
                </span>
                <span className={`text-[10px] font-mono font-semibold ${tone[c.decision.outcome]}`}>
                  {c.decision.outcome === "allow" ? "OK" : title[c.decision.outcome]}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {c.scenario.device} · {c.scenario.workflowLabel}
              </p>
            </button>
          ))}
        </div>

        {/* Device frame */}
        <div className="lg:col-span-3 flex justify-center">
          <DeviceFrame case_={current} />
        </div>
      </div>
    </div>
  );
}

function DeviceFrame({ case_ }: { case_: WorkerCase }) {
  const { scenario, decision, resolution, sim } = case_;
  const isAllow = decision.outcome === "allow";
  const workerSteps = resolution.steps.filter(
    (s) => s.resolutionClass === "auto_proposed",
  );
  const handedOff = resolution.steps.filter(
    (s) => s.resolutionClass !== "auto_proposed",
  );

  return (
    <div className="w-full max-w-sm rounded-[28px] border border-border bg-[#0c1118] p-3 shadow-2xl">
      <div className="rounded-[20px] border border-border/70 bg-background overflow-hidden">
        {/* status bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
          <span className="text-[10px] font-mono text-muted-foreground tracking-wider">
            SignalGrid · {scenario.device}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        </div>

        <div className="px-5 py-6 space-y-5">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              {scenario.worker} · {scenario.workflowLabel}
            </p>
            <h3 className={`text-xl font-bold tracking-tight ${tone[decision.outcome]}`}>
              {title[decision.outcome]}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isAllow
                ? "Identity and device checks passed — your session is starting."
                : resolution.summaryForWorker}
            </p>
          </div>

          {!isAllow && workerSteps.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-teal-300 tracking-wider uppercase">
                You can do this now
              </p>
              {workerSteps.map((step) => (
                <div
                  key={step.order}
                  className="flex items-start gap-3 border border-teal-800/40 bg-teal-950/20 rounded-lg px-3 py-2.5"
                >
                  <span className="w-5 h-5 rounded-full bg-teal-800/50 text-teal-200 text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                    {step.order}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-foreground leading-snug">
                      {step.action}
                    </p>
                    <p className="text-[10px] text-teal-300/80 font-mono mt-0.5">
                      {channelLabel[step.channel] ?? step.channel}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isAllow && handedOff.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-amber-300 tracking-wider uppercase">
                Being handled for you
              </p>
              {handedOff.map((step) => (
                <div
                  key={step.order}
                  className="flex items-start gap-3 border border-border rounded-lg px-3 py-2.5"
                >
                  <span className="text-amber-300 text-xs shrink-0 mt-0.5">→</span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted-foreground leading-snug">
                      {step.action}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">
                      {channelLabel[step.channel] ?? step.channel}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* projected outcome */}
          {!isAllow && (
            <div className="border-t border-border/60 pt-3">
              {sim.resolved ? (
                <p className="text-[13px] text-teal-300">
                  ✓ Once these steps are done, you'll be able to continue.
                </p>
              ) : (
                <p className="text-[13px] text-amber-300">
                  This needs a person to review — your operator has been notified.
                </p>
              )}
            </div>
          )}

          {isAllow && (
            <button className="w-full rounded-lg bg-primary/20 border border-primary/40 text-primary text-sm font-semibold py-2.5">
              Continue to {scenario.workflowLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
