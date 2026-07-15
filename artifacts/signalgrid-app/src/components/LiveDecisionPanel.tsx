import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { evaluateV1, type V1Decision, type V1EvaluateRequest, type V1Outcome } from "@/lib/v1";

/**
 * Live decision panel — calls the `/v1` deterministic core for a real,
 * core-computed decision (contrast with the fixture telemetry elsewhere on the
 * dashboard). Each preset is a seeded identity + device + workflow; the outcome,
 * reason codes, matched rule, and evidence id all come straight from the engine.
 */

type Preset = { label: string; sub: string; req: V1EvaluateRequest };

const PRESETS: Preset[] = [
  { label: "Compliant nurse", sub: "med-admin", req: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "med-admin" } },
  { label: "Non-compliant device", sub: "med-admin", req: { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "med-admin" } },
  { label: "Badge withdrawn", sub: "clinical-session", req: { identityRef: "nurse.badge_removed", deviceRef: "ipad-badge-01", workflowKey: "clinical-session" } },
  { label: "Tamper flag", sub: "med-admin", req: { identityRef: "nurse.tamper", deviceRef: "ipad-loan-02", workflowKey: "med-admin" } },
  { label: "Disabled account", sub: "med-admin", req: { identityRef: "nurse.disabled", deviceRef: "ipad-ward-04", workflowKey: "med-admin" } },
];

const TONE: Record<V1Outcome, { dot: string; text: string; ring: string; label: string }> = {
  allow: { dot: "bg-emerald-400", text: "text-emerald-400", ring: "border-emerald-400/40", label: "ALLOW" },
  step_up: { dot: "bg-amber-400", text: "text-amber-400", ring: "border-amber-400/40", label: "STEP-UP" },
  restrict: { dot: "bg-orange-400", text: "text-orange-400", ring: "border-orange-400/40", label: "RESTRICT" },
  deny: { dot: "bg-red-400", text: "text-red-400", ring: "border-red-400/40", label: "DENY" },
};

export function LiveDecisionPanel() {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [decision, setDecision] = useState<V1Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(idx: number) {
    setActiveIdx(idx);
    setLoading(true);
    setError(null);
    try {
      const result = await evaluateV1(PRESETS[idx].req);
      setDecision(result);
    } catch (e) {
      setDecision(null);
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setLoading(false);
    }
  }

  const tone = decision ? TONE[decision.outcome] : null;

  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Live decision · /v1 core
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Computed live by the deterministic decision core — not fixtures. Pick a scenario:
          </p>
        </div>
        <span className="text-[0.6rem] font-mono uppercase tracking-wider text-primary border border-primary/30 rounded px-1.5 py-0.5 whitespace-nowrap">
          real · /v1
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p, i) => (
            <button
              key={p.req.identityRef + p.req.workflowKey}
              onClick={() => run(i)}
              className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                activeIdx === i ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"
              }`}
            >
              <div className="font-mono text-xs font-medium">{p.label}</div>
              <div className="font-mono text-[0.65rem] text-muted-foreground">{p.sub}</div>
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-sm text-muted-foreground font-mono py-6 text-center">Evaluating…</div>
        )}

        {error && !loading && (
          <div className="text-sm text-red-400 border border-red-500/20 bg-red-500/5 rounded-lg p-3 font-mono">
            {error}
            <div className="text-xs text-muted-foreground mt-1">Is the api-server running? The console proxies /api to it.</div>
          </div>
        )}

        {decision && tone && !loading && (
          <div className={`rounded-lg border ${tone.ring} p-4`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${tone.text}`}>
                <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                {tone.label}
              </span>
              {decision.reasonCodes.map((c) => (
                <span key={c} className="font-mono text-[0.65rem] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                  {c}
                </span>
              ))}
              <span className="ml-auto font-mono text-[0.65rem] text-muted-foreground">{decision.latencyMs}ms</span>
            </div>

            <p className="text-sm mt-3">{decision.explanation}</p>

            {decision.matchedRules.length > 0 && (
              <div className="mt-3 space-y-1">
                {decision.matchedRules.map((r) => (
                  <div key={r.ruleId} className="flex items-center justify-between text-xs font-mono border-t border-border/50 pt-1.5">
                    <span className="text-muted-foreground">{r.ruleId}</span>
                    <span className={TONE[r.outcome as V1Outcome]?.text ?? "text-muted-foreground"}>
                      {r.outcome} · {r.severity}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 pt-2 border-t border-border/50 flex flex-wrap gap-x-4 gap-y-1 text-[0.62rem] font-mono text-muted-foreground">
              <span>decision {decision.decisionId}</span>
              <span>evidence {decision.evidenceSnapshotId}</span>
              <span>policy {decision.policyId} v{decision.policyVersion}</span>
            </div>
          </div>
        )}

        {!decision && !loading && !error && (
          <div className="text-sm text-muted-foreground p-6 text-center border border-dashed border-border rounded-lg">
            Select a scenario to evaluate a live decision against the core.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
