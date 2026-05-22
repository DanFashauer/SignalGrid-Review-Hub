import { useState } from "react";
import { signalTypes, decisionOutcomes } from "@/data/architectureData";

const signalColors = [
  { border: "border-teal-700", bg: "bg-teal-900/20", dot: "bg-teal-500", text: "text-teal-300" },
  { border: "border-sky-700", bg: "bg-sky-900/20", dot: "bg-sky-500", text: "text-sky-300" },
  { border: "border-violet-700", bg: "bg-violet-900/20", dot: "bg-violet-500", text: "text-violet-300" },
  { border: "border-amber-700", bg: "bg-amber-900/20", dot: "bg-amber-500", text: "text-amber-300" },
];

export default function SignalArchitectureSection() {
  const [activeSignal, setActiveSignal] = useState<string | null>(null);

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
                  <span key={src} className="text-xs px-2 py-0.5 rounded bg-muted border border-border text-muted-foreground">
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
    </div>
  );
}
