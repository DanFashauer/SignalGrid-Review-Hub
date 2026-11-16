import type { ReactNode } from "react";
import {
  connectorEmulatorGuardrails,
  connectorEmulatorProof,
  connectorEmulatorScenarios,
  type ConnectorDecision,
} from "@/data/connectorEmulatorData";
import { connectorDecisionTone } from "@/lib/outcome-tone";

const flow = ["signals", "evaluation", "decision", "route", "verification"];
// The guardrail pills are COMPUTED over the committed proof results (see
// connectorEmulatorData.ts) — they used to be a hardcoded string array rendered
// with a green tick, which would have looked identical with the proof red.
const safetyNotes = [
  "synthetic emulator only",
  "not live integration evidence",
  "not production-ready",
  "not compliance certification",
  "not vendor partnership",
  "does not replace systems of record",
  "no autonomous production remediation",
];

function Pill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

export default function ConnectorEmulatorDashboard() {
  const decisions = Array.from(
    new Set(
      connectorEmulatorScenarios.map((scenario) => scenario.expectedDecision),
    ),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Connector Emulator Harness
            </p>
            <h3 className="mt-2 text-2xl font-bold text-foreground">
              Fixture-backed connector review dashboard
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Mobile-friendly review surface for synthetic connector scenarios,
              deterministic decisions, owner routes, approval gates, and proof
              evidence. It is static, public-safe, and requires no live vendor
              access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
            {[
              "synthetic/public-safe",
              "no live vendor access",
              "no secrets",
              "deterministic proof-backed",
            ].map((label) => (
              <Pill
                key={label}
                className="border-primary/40 bg-background text-primary"
              >
                {label}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Decision visualization
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
            {flow.map((step, index) => (
              <div key={step} className="flex items-center gap-2 sm:block">
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-center text-sm font-semibold capitalize text-foreground">
                  {step}
                </div>
                {index < flow.length - 1 && (
                  <span className="text-muted-foreground sm:hidden">→</span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {decisions.map((decision) => (
              <Pill key={decision} className={connectorDecisionTone(decision)}>
                {decision}
              </Pill>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Evidence panel
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Proof command</dt>
              <dd className="font-mono text-foreground">
                {connectorEmulatorProof.command}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Manual workflow</dt>
              <dd className="text-foreground">
                {connectorEmulatorProof.manualWorkflow}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Artifact</dt>
              <dd className="text-foreground">
                {connectorEmulatorProof.artifact}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Deterministic hash</dt>
              <dd className="break-all font-mono text-xs text-foreground">
                {connectorEmulatorProof.deterministicHash}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Guardrail indicators
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connectorEmulatorGuardrails.map((guardrail) => (
              <Pill
                key={guardrail.label}
                className={
                  guardrail.holds
                    ? "border-teal-500/40 bg-teal-950/20 text-teal-200"
                    : "border-red-500/50 bg-red-950/30 text-red-200"
                }
              >
                {guardrail.holds ? "✓" : "✗"} {guardrail.label}
              </Pill>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            Public safety note
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {safetyNotes.map((note) => (
              <Pill
                key={note}
                className="border-amber-500/40 bg-background/40 text-amber-100"
              >
                {note}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scenario overview
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {connectorEmulatorProof.scenarioCount} scenarios from{" "}
            {connectorEmulatorProof.fixturePacks.join(", ")} fixture packs.
          </p>
        </div>
        <div className="divide-y divide-border">
          {connectorEmulatorScenarios.map((scenario) => (
            <article key={scenario.id} className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className="border-border bg-muted text-muted-foreground">
                      {scenario.group}
                    </Pill>
                    {/* The ENGINE's decision from the committed proof run, not
                        the fixture's intent; a mismatch renders red. */}
                    <Pill
                      className={
                        scenario.actualDecision === "unverified"
                          ? "border-amber-500/50 bg-amber-950/30 text-amber-200"
                          : scenario.actualDecision === scenario.expectedDecision
                            ? connectorDecisionTone(scenario.actualDecision)
                            : "border-red-500/50 bg-red-950/30 text-red-200"
                      }
                    >
                      {scenario.actualDecision}
                      {scenario.actualDecision !== "unverified" &&
                        scenario.actualDecision !== scenario.expectedDecision &&
                        ` (expected ${scenario.expectedDecision})`}
                    </Pill>
                    <Pill className="border-border bg-background text-muted-foreground">
                      severity: {scenario.severity}
                    </Pill>
                    {scenario.approvalRequired && (
                      <Pill className="border-violet-500/50 bg-violet-950/30 text-violet-200">
                        approval gate
                      </Pill>
                    )}
                  </div>
                  <h4 className="mt-3 text-base font-semibold text-foreground">
                    {scenario.title}
                  </h4>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {scenario.reason}
                  </p>
                </div>
                <div className="text-sm md:w-64 md:text-right">
                  <p className="text-muted-foreground">Owner category</p>
                  <p className="font-semibold text-foreground">
                    {scenario.ownerCategory}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Domains</p>
                  <p className="text-foreground">
                    {scenario.domains.join(", ")}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    Destination placeholder
                  </p>
                  <p className="font-mono text-xs text-foreground">
                    {scenario.destinationPlaceholder}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    Verification expectation
                  </p>
                  <p className="text-foreground">
                    {scenario.verificationExpectation}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
