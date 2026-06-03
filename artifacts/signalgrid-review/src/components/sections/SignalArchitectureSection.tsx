import { useState } from "react";
import { signalTypes, decisionOutcomes, fleetSignalMap, signalTypeColors } from "@/data/architectureData";

const signalColors = [
  { border: "border-teal-700", bg: "bg-teal-900/20", dot: "bg-teal-500", text: "text-teal-300" },
  { border: "border-sky-700", bg: "bg-sky-900/20", dot: "bg-sky-500", text: "text-sky-300" },
  { border: "border-violet-700", bg: "bg-violet-900/20", dot: "bg-violet-500", text: "text-violet-300" },
  { border: "border-amber-700", bg: "bg-amber-900/20", dot: "bg-amber-500", text: "text-amber-300" },
];

const signalTypeLabels: Record<string, string> = {
  "device-posture": "Device Posture",
  identity: "Identity",
  "session-context": "Session Context",
  "operational-signals": "Operational Signals",
};

export default function SignalArchitectureSection() {
  const [activeSignal, setActiveSignal] = useState<string | null>(null);
  const [showFleetMap, setShowFleetMap] = useState(true);

  const active = signalTypes.find((s) => s.id === activeSignal);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        SignalGrid's decision engine evaluates four independent signal types simultaneously at workflow execution time — not at login time. Click any signal type to see how it applies in a real shared-device frontline scenario.
      </p>

      {/* Architecture flow diagram */}
      <div className="border border-border bg-card rounded-lg p-6">
        <div className="flex flex-col md:flex-row items-center gap-4">
          {/* Signal inputs */}
          <div className="flex flex-col gap-3 w-full md:w-64 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Signal Inputs</p>
            {signalTypes.map((s, i) => {
              const c = signalColors[i];
              const isActive = activeSignal === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSignal(isActive ? null : s.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                    isActive
                      ? `${c.border} ${c.bg} ring-1 ring-inset ${c.border}`
                      : "border-border hover:border-border/80 hover:bg-muted/30"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${c.dot} shrink-0`} />
                  <span className={`text-xs font-semibold ${isActive ? c.text : "text-foreground"}`}>
                    {s.shortName}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-1 shrink-0 rotate-90 md:rotate-0">
            <div className="text-muted-foreground/40 text-lg">→</div>
          </div>

          {/* Decision engine */}
          <div className="flex-1 flex items-center justify-center">
            <div className="border-2 border-primary/40 bg-primary/5 rounded-lg px-6 py-4 text-center max-w-xs">
              <div className="w-8 h-8 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center mx-auto mb-2">
                <div className="w-4 h-4 rounded-sm bg-primary/60" />
              </div>
              <p className="text-sm font-bold text-foreground">Decision Engine</p>
              <p className="text-xs text-muted-foreground mt-1">Runtime signal evaluation</p>
              <p className="text-xs text-primary/70 mt-2 font-mono">at workflow execution time</p>
            </div>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-1 shrink-0 rotate-90 md:rotate-0">
            <div className="text-muted-foreground/40 text-lg">→</div>
          </div>

          {/* Outcomes */}
          <div className="flex flex-col gap-2 w-full md:w-48 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Access Outcomes</p>
            {decisionOutcomes.map((o) => (
              <div key={o.id} className="flex items-center gap-2 px-3 py-1.5 rounded border border-border">
                <div className={`w-1.5 h-1.5 rounded-full ${o.dot} shrink-0`} />
                <span className={`text-xs font-semibold ${o.color}`}>{o.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Signal detail */}
      {active ? (
        <div className={`border rounded-lg p-5 space-y-4 ${signalColors[signalTypes.findIndex(s => s.id === active.id)].border} ${signalColors[signalTypes.findIndex(s => s.id === active.id)].bg}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={`text-xs font-semibold tracking-wider uppercase mb-1 ${signalColors[signalTypes.findIndex(s => s.id === active.id)].text}`}>
                Signal Type
              </p>
              <h3 className="text-base font-bold text-foreground">{active.name}</h3>
            </div>
            <button
              onClick={() => setActiveSignal(null)}
              className="text-muted-foreground hover:text-foreground text-sm shrink-0"
            >
              ×
            </button>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">{active.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Frontline Scenario</p>
              <p className="text-xs text-muted-foreground leading-relaxed italic border-l-2 border-border pl-3">
                {active.sharedDeviceExample}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Evaluation Question</p>
              <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-border pl-3">
                {active.evaluationQuestion}
              </p>
              <p className="text-xs font-semibold text-foreground tracking-wider uppercase mt-3">Signal Sources</p>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {active.sourceExamples.map((src) => (
                  <span key={src} className={`text-xs px-2 py-0.5 rounded border ${src.includes("Fleet") ? "bg-sky-900/30 border-sky-700/60 text-sky-300" : "bg-muted border-border text-muted-foreground"}`}>
                    {src}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-border/40 bg-muted/10 rounded-lg px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Select a signal type above to see its definition, a real frontline scenario, and the evaluation question SignalGrid answers for it.
          </p>
        </div>
      )}

      {/* Decision outcomes detail */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {decisionOutcomes.map((o) => (
          <div key={o.id} className="border border-border bg-card rounded-lg px-4 py-3 space-y-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${o.dot}`} />
              <span className={`text-xs font-bold ${o.color}`}>{o.label}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{o.description}</p>
          </div>
        ))}
      </div>

      {/* Fleet MDM follow-on signal map */}
      <div className="border border-sky-800/50 bg-sky-950/20 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowFleetMap((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-sky-900/10 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
            <div>
              <span className="text-sm font-bold text-sky-200">Fleet MDM — osquery Signal Map</span>
              <span className="ml-3 text-xs text-sky-400/70 font-mono">8 tables → 4 signal types</span>
            </div>
          </div>
          <span className="text-muted-foreground text-xs">{showFleetMap ? "▲ collapse" : "▼ expand"}</span>
        </button>

        {showFleetMap && (
          <div className="px-5 pb-5 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every Fleet osquery table is a potential SignalGrid signal source. The mapping below shows which standard osquery tables feed which signal type — and the exact condition that triggers a policy outcome. This is a follow-on UEM/device-management connector surface after the Microsoft Intune / Entra posture proof.
            </p>

            <div className="overflow-x-auto rounded-lg border border-sky-900/40">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-sky-900/40 bg-sky-900/20">
                    <th className="text-left px-4 py-2.5 font-semibold text-sky-300 whitespace-nowrap">osquery Table</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-sky-300 whitespace-nowrap">Key Columns</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-sky-300 whitespace-nowrap">Signal Type</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-sky-300">Policy Condition → Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {fleetSignalMap.map((row, i) => {
                    const colors = signalTypeColors[row.signalType];
                    return (
                      <tr
                        key={row.osqueryTable}
                        className={`border-b border-sky-900/20 ${i % 2 === 0 ? "bg-transparent" : "bg-sky-950/10"}`}
                      >
                        <td className="px-4 py-2.5 font-mono text-sky-200 whitespace-nowrap">{row.osqueryTable}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {row.columns.map((col) => (
                              <span key={col} className="font-mono text-[10px] px-1.5 py-0.5 bg-stone-800 border border-stone-700 rounded text-stone-300">
                                {col}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border ${colors.bg} ${colors.text} border-current/30`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            {signalTypeLabels[row.signalType]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground leading-relaxed">{row.signalingExample}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-start gap-2 px-3 py-2.5 rounded bg-sky-900/10 border border-sky-900/30">
              <div className="w-1 h-1 rounded-full bg-sky-500 mt-1.5 shrink-0" />
              <p className="text-xs text-sky-300/80">
                <span className="font-semibold text-sky-300">Proof-of-concept path:</span>{" "}
                After the Microsoft Intune / Entra posture proof is grounded, run <code className="font-mono bg-sky-950 px-1 rounded">fleetctl preview</code> locally → enroll two test hosts → write a Fleet policy against the <code className="font-mono bg-sky-950 px-1 rounded">disk_encryption</code> or <code className="font-mono bg-sky-950 px-1 rounded">mdm</code> table → call the Fleet REST API from SignalGrid to retrieve policy failure counts → map the response to a device-posture signal. That loop becomes a follow-on UEM/device-management connector proof, not the current first proof.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
