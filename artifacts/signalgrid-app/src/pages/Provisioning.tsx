import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { controlPlane, type ProvisioningResp, type ProvisioningStep, type RecordingStep } from "@/lib/control-plane";

// Device Action Recorder / Designer (docs/ZERO_TOUCH_PROVISIONING.md,
// docs/OPEN_ORCHESTRATION_VISION.md): a setup is recorded ONCE as a versionable
// artifact; the Grid replays it zero-touch so the end user never hand-configures a
// device. This operator view shows the recording (the Designer), the CI validation
// on it, and the SIMULATED plan against a device — enforcement stays off, a
// sensitive step needs approval, and a device that doesn't match is never touched.

const KIND_LABEL: Record<string, string> = {
  wifi: "Wi-Fi", profile: "Profile", cert: "Certificate", app_install: "App",
  policy: "Policy", restriction: "Restriction", account: "Account",
};

const DISP_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  held_simulated: { dot: "bg-sky-400", text: "text-sky-400", label: "simulated" },
  approval_required: { dot: "bg-amber-400", text: "text-amber-400", label: "needs approval" },
  auto_apply: { dot: "bg-emerald-400", text: "text-emerald-400", label: "auto-apply" },
};

export function Provisioning() {
  const [serial, setSerial] = React.useState<string>("CLIN-00042");
  const q = useQuery({ queryKey: ["cp-provisioning", serial], queryFn: () => controlPlane.provisioning(serial) });
  const data = q.data;

  const rec = data?.recording;
  const plan = data?.plan;
  const errors = (data?.issues ?? []).filter((i) => i.severity === "error");
  const warnings = (data?.issues ?? []).filter((i) => i.severity === "warning");
  const devices = data?.devices ?? [];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Device recorder</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">RECORD ONCE · VALIDATE · REPLAY ZERO-TOUCH (SIMULATED)</p>
      </div>

      {/* The recording — the Designer artifact */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2 flex-row items-center justify-between gap-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-primary">
            {rec ? rec.name : "Recording"}
          </CardTitle>
          {data && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${data.recordingValid ? "border-emerald-400/30 text-emerald-400" : "border-red-400/30 text-red-400"}`}>
              {data.recordingValid ? "valid" : `${errors.length} error${errors.length === 1 ? "" : "s"}`}
            </span>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {rec && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs font-mono">
              <Field label="Recording id" value={rec.id} />
              <Field label="Matches serials" value={rec.match.serialPrefix ? `${rec.match.serialPrefix}*` : "—"} />
              <Field label="Matches model" value={rec.match.model ?? "any"} />
              <Field label="Fires on" value={rec.triggers.map((t) => t.replace(/_/g, " ")).join(", ")} />
              <Field label="Steps" value={String(rec.steps.length)} />
              <Field label="Enforcement" value="off (simulated)" valueClass="text-sky-400" />
            </div>
          )}

          {/* The recorded steps — the Designer canvas, in order */}
          <div className="space-y-1.5">
            {(rec?.steps ?? []).map((s: RecordingStep, i: number) => (
              <div key={s.key} className="flex items-center gap-3 text-xs font-mono">
                <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="w-24 shrink-0 text-muted-foreground uppercase">{KIND_LABEL[s.kind] ?? s.kind}</span>
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5">
                  {s.gridLifted && <span className="px-1.5 py-0.5 rounded border border-primary/30 text-primary">grid-lifted</span>}
                  {s.sensitive && <span className="px-1.5 py-0.5 rounded border border-amber-400/30 text-amber-400">sensitive</span>}
                </span>
              </div>
            ))}
            {!data && <div className="text-sm text-muted-foreground">Loading…</div>}
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <div className="space-y-1 pt-1">
              {errors.map((e, i) => (
                <div key={`e${i}`} className="text-xs font-mono text-red-400">✕ {e.code}: {e.message}</div>
              ))}
              {warnings.map((w, i) => (
                <div key={`w${i}`} className="text-xs font-mono text-amber-400">! {w.code}: {w.message}</div>
              ))}
            </div>
          )}
          <p className="text-[0.68rem] text-muted-foreground font-mono">
            The recording is a versionable artifact — the CI/CD pipeline validates it (like grid-config) before the Grid replays it. Authored once; no device is hand-configured.
          </p>
        </CardContent>
      </Card>

      {/* Zero-touch plan preview — pick a device, see what the Grid would do */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Zero-touch plan · preview against a device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {devices.map((d) => (
              <button
                key={d.serial}
                onClick={() => setSerial(d.serial)}
                className={`px-3 py-1.5 rounded border text-xs font-mono transition-colors ${serial === d.serial ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30"}`}
              >
                {d.serial}{d.model ? ` · ${d.model}` : ""}
              </button>
            ))}
          </div>

          {plan && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Metric label="Device" value={plan.deviceSerial} accent={plan.matched ? "text-emerald-400" : "text-muted-foreground"} sub={plan.matched ? "matches recording" : "no match"} />
                <Metric label="Steps planned" value={String(plan.steps.length)} sub={plan.matched ? "in order" : "device untouched"} />
                <Metric label="Need approval" value={String(plan.requiresApproval)} accent={plan.requiresApproval > 0 ? "text-amber-400" : undefined} sub="sensitive steps" />
                <Metric label="Would apply" value={plan.willApplyAnything ? "yes" : "no"} accent={plan.willApplyAnything ? "text-amber-400" : "text-emerald-400"} sub={plan.mode} />
              </div>

              {plan.matched ? (
                <div className="space-y-1.5">
                  {plan.steps.map((s: ProvisioningStep) => {
                    const d = DISP_STYLE[s.disposition] ?? { dot: "bg-muted", text: "text-muted-foreground", label: s.disposition };
                    return (
                      <div key={s.key} className="flex items-center justify-between gap-3 text-xs font-mono">
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full ${d.dot}`} />
                          <span className="w-20 shrink-0 text-muted-foreground uppercase">{KIND_LABEL[s.kind] ?? s.kind}</span>
                          <span className="truncate">{s.label}</span>
                        </span>
                        <span className={`shrink-0 uppercase ${d.text}`}>{d.label}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs font-mono text-muted-foreground border border-border rounded p-3">
                  {plan.reason} — the Grid touches nothing on a device that doesn't match the recording. Fail-safe by design.
                </div>
              )}
            </>
          )}
          {!data && <div className="text-sm text-muted-foreground">Loading…</div>}

          <p className="text-[0.68rem] text-muted-foreground font-mono">
            Every step is <span className="text-sky-400">simulated</span> until an owner turns enforcement on. Even then, a <span className="text-amber-400">sensitive</span> step waits for administrator approval — never auto-applied. Read live from <span className="text-muted-foreground">/cp/v1</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-muted-foreground uppercase text-[0.62rem] tracking-wider">{label}</div>
      <div className={`mt-0.5 ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl md:text-2xl font-mono font-bold tracking-tight truncate ${accent ?? ""}`}>{value}</div>
        {sub && <div className="text-xs font-mono text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default Provisioning;
