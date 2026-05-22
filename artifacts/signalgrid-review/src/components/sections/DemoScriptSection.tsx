import { useState } from "react";
import { demoScenarios, demoObjectionResponses } from "@/data/demoData";

const phaseStyles: Record<string, { border: string; label: string; color: string }> = {
  setup: { border: "border-l-stone-600", label: "Setup", color: "text-stone-400" },
  trigger: { border: "border-l-amber-700", label: "Trigger", color: "text-amber-400" },
  evaluation: { border: "border-l-teal-700", label: "Evaluation", color: "text-teal-400" },
  outcome: { border: "border-l-primary/60", label: "Outcome", color: "text-primary" },
};

const industryColors: Record<string, { bg: string; text: string; dot: string }> = {
  Healthcare: { bg: "bg-teal-900/20", text: "text-teal-300", dot: "bg-teal-500" },
  "Logistics / Distribution": { bg: "bg-amber-900/20", text: "text-amber-300", dot: "bg-amber-500" },
  Retail: { bg: "bg-violet-900/20", text: "text-violet-300", dot: "bg-violet-500" },
  "Enterprise IT / Technology": { bg: "bg-sky-900/20", text: "text-sky-300", dot: "bg-sky-500" },
  "Financial Services": { bg: "bg-emerald-900/20", text: "text-emerald-300", dot: "bg-emerald-500" },
};

const defaultColor = { bg: "bg-stone-900/20", text: "text-stone-300", dot: "bg-stone-500" };

export default function DemoScriptSection() {
  const [selectedId, setSelectedId] = useState(demoScenarios[0].id);
  const [showObjections, setShowObjections] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const scenario = demoScenarios.find((s) => s.id === selectedId) ?? demoScenarios[0];

  function handleSelectScenario(id: string) {
    setSelectedId(id);
    setActiveStep(null);
  }

  return (
    <div className="space-y-6">
      {/* Scenario picker */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">
          Demo Scenarios — {demoScenarios.length} available
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {demoScenarios.map((s) => {
            const color = industryColors[s.industry] ?? defaultColor;
            const isActive = selectedId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleSelectScenario(s.id)}
                className={`text-left px-4 py-3 rounded-lg border transition-all ${
                  isActive
                    ? `${color.bg} border-current/30 ring-1 ring-inset ring-current/20`
                    : "border-border hover:border-border/80 hover:bg-muted/20"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${color.dot} shrink-0 mt-1.5`} />
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold truncate ${isActive ? color.text : "text-muted-foreground"}`}>
                      {s.industry}
                    </p>
                    <p className={`text-xs font-medium mt-0.5 leading-snug ${isActive ? "text-foreground" : "text-muted-foreground/70"}`}>
                      {s.platform}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected scenario header */}
      <div className="border border-border bg-card rounded-lg p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full ${(industryColors[scenario.industry] ?? defaultColor).dot} shrink-0 mt-1.5`} />
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Demo Scenario</p>
            <h3 className="text-base font-bold text-foreground">{scenario.title}</h3>
            <p className={`text-xs mt-1 font-medium ${(industryColors[scenario.industry] ?? defaultColor).text}`}>
              {scenario.industry} · {scenario.platform}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Environment</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{scenario.environment}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Total Duration</p>
            <p className="text-xs text-foreground font-medium">{scenario.totalDuration}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Prerequisite</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{scenario.prerequisite}</p>
          </div>
        </div>

        <div className="border border-primary/20 bg-primary/5 rounded px-4 py-3">
          <p className="text-xs font-semibold text-primary tracking-wider uppercase mb-1">Opening Frame</p>
          <p className="text-sm text-muted-foreground leading-relaxed italic">{scenario.openingFrame}</p>
        </div>
      </div>

      {/* Step-by-step script */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">Demo Script</p>
        <p className="text-xs text-muted-foreground mb-4">Click any step to expand the full narrative and technical notes.</p>
        <div className="space-y-3">
          {scenario.steps.map((step, i) => {
            const ps = phaseStyles[step.phase];
            const isActive = activeStep === step.id;
            return (
              <div
                key={step.id}
                className={`border border-border border-l-2 ${ps.border} bg-card rounded-lg overflow-hidden`}
              >
                <button
                  onClick={() => setActiveStep(isActive ? null : step.id)}
                  className="w-full text-left px-5 py-3.5 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-xs font-mono font-semibold text-muted-foreground shrink-0 mt-0.5">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{step.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs font-medium ${ps.color}`}>{ps.label}</span>
                          <span className="text-muted-foreground/50">·</span>
                          <span className="text-xs text-muted-foreground">{step.duration}</span>
                        </div>
                      </div>
                    </div>
                    <span className="text-muted-foreground text-sm shrink-0">{isActive ? "−" : "+"}</span>
                  </div>
                </button>

                {isActive && (
                  <div className="border-t border-border px-5 py-4 space-y-4">
                    <div>
                      <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-2">Narrative</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">{step.narrative}</p>
                    </div>
                    {step.technicalNote && (
                      <div className="border border-teal-800/40 bg-teal-900/10 rounded px-4 py-3">
                        <p className="text-xs font-semibold text-teal-400 tracking-wider uppercase mb-1">Technical Note</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{step.technicalNote}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Shared objection responses */}
      <div className="border border-border bg-card rounded-lg overflow-hidden">
        <button
          onClick={() => setShowObjections(!showObjections)}
          className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-muted/20 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Demo Interruption Responses</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The four most likely objections during any live demo — prepared responses applicable across all scenarios.
            </p>
          </div>
          <span className="text-muted-foreground shrink-0 ml-4">{showObjections ? "−" : "+"}</span>
        </button>

        {showObjections && (
          <div className="border-t border-border px-5 py-5 space-y-4">
            {demoObjectionResponses.map((obj, i) => (
              <div key={i} className="space-y-2">
                <div className="border border-border rounded px-3 py-2 bg-muted/20">
                  <p className="text-xs text-foreground italic">{obj.objection}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-3 border-l-2 border-teal-700">
                  {obj.response}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border border-amber-800/30 bg-amber-900/10 rounded-lg px-4 py-3">
        <p className="text-xs text-amber-400 font-semibold mb-1">Before your first live demo</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Choose the scenario that matches your prospect's industry and MDM platform before the call. Run the full script once with an external observer. The observer's job is to flag every moment where you improvise — those moments need to be scripted before they're tested under pressure.
        </p>
      </div>
    </div>
  );
}
