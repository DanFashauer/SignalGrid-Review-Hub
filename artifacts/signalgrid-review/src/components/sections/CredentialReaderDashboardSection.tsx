import type { ReactNode } from "react";
import {
  credentialReaderDashboardSummary,
  credentialReaderFlow,
  credentialReaderScenarios,
  type CredentialReaderDecision,
} from "@/data/credentialReaderDashboardData";

const decisionStyles: Record<CredentialReaderDecision, string> = {
  allowCandidate: "border-teal-500/50 bg-teal-950/30 text-teal-200",
  restrict: "bg-status-restrict",
  stepUp: "border-sky-500/50 bg-sky-950/30 text-sky-200",
  approvalRequired: "border-violet-500/50 bg-violet-950/30 text-violet-200",
};

const publicSafetyNotes = [
  "fixture-backed only",
  "no live reader or locker API calls",
  "no vendor partnership or endorsement claim",
  "systems of record stay authoritative",
  "approval gates remain explicit",
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

export default function CredentialReaderDashboardSection() {
  const decisions = Array.from(
    new Set(
      credentialReaderScenarios.map((scenario) => scenario.expected.decision),
    ),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-sky-500/30 bg-sky-950/10 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              {credentialReaderDashboardSummary.classification} ·{" "}
              {credentialReaderDashboardSummary.lane} lane
            </p>
            <h3 className="mt-2 text-2xl font-bold text-foreground">
              Credential Reader / Smart Locker Review Dashboard
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Visualizes the public-safe credential-reader scenario pack as a
              demo story: badge read, identity correlation, custody correlation,
              device and workflow context, decision, route owner, and
              verification expectation. The scenarios are deterministic
              fixtures, not live hardware integrations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
            {publicSafetyNotes.map((note) => (
              <Pill
                key={note}
                className="border-sky-500/40 bg-background/50 text-sky-100"
              >
                {note}
              </Pill>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-7">
        {credentialReaderFlow.map((step, index) => (
          <div key={step} className="flex items-center gap-2 lg:block">
            <div className="rounded-lg border border-border bg-card px-3 py-4 text-center text-xs font-semibold uppercase tracking-wide text-foreground">
              <span className="block text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              {step}
            </div>
            {index < credentialReaderFlow.length - 1 && (
              <span className="text-muted-foreground lg:hidden">→</span>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fixture pack
          </p>
          <p className="mt-2 font-mono text-sm text-foreground">
            {credentialReaderDashboardSummary.fixtureName}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {credentialReaderDashboardSummary.scenarioCount} scenarios
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Decision coverage
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {decisions.map((decision) => (
              <Pill key={decision} className={decisionStyles[decision]}>
                {decision}
              </Pill>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Proof evidence
          </p>
          <p className="mt-2 font-mono text-xs text-foreground">
            {credentialReaderDashboardSummary.proofCommand}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {credentialReaderDashboardSummary.artifactPath}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Scenario storyboards
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Each card follows the review demo chain from credential read through
            verification.
          </p>
        </div>
        <div className="divide-y divide-border">
          {credentialReaderScenarios.map((scenario) => (
            <article key={scenario.id} className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap gap-2">
                    <Pill
                      className={decisionStyles[scenario.expected.decision]}
                    >
                      {scenario.expected.decision}
                    </Pill>
                    <Pill className="border-border bg-muted text-muted-foreground">
                      route: {scenario.expected.route.ownerCategory}
                    </Pill>
                    <Pill className="border-border bg-background text-muted-foreground">
                      severity: {scenario.expected.route.severity}
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
                    {scenario.expected.reason}
                  </p>
                </div>
                <div className="text-sm md:w-64 md:text-right">
                  <p className="text-muted-foreground">
                    Verification expectation
                  </p>
                  <p className="text-foreground">
                    {scenario.expected.route.verificationExpectation}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-5">
                <Signal
                  label="Badge read"
                  value={scenario.credentialReadState}
                />
                <Signal
                  label="Identity"
                  value={scenario.identityCorrelationState}
                />
                <Signal
                  label="Custody"
                  value={scenario.custodyCorrelationState}
                />
                <Signal
                  label="Device/workflow"
                  value={`${scenario.deviceContext} · ${scenario.credentialWorkflowContext}`}
                />
                <Signal
                  label="Locker/dock"
                  value={scenario.lockerOrDockState}
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-xs text-foreground">
        {value}
      </p>
    </div>
  );
}
