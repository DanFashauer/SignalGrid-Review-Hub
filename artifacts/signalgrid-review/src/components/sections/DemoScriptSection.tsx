import { useState } from "react";
import { demoScenario, demoSteps, demoObjectionResponses } from "@/data/demoData";

const phaseStyles: Record<string, { border: string; label: string; color: string }> = {
  setup: { border: "border-l-stone-600", label: "Setup", color: "text-stone-400" },
  trigger: { border: "border-l-amber-700", label: "Trigger", color: "text-amber-400" },
  evaluation: { border: "border-l-teal-700", label: "Evaluation", color: "text-teal-400" },
  outcome: { border: "border-l-primary/60", label: "Outcome", color: "text-primary" },
};

export default function DemoScriptSection() {
  const [showObjections, setShowObjections] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Scenario header */}
      <div className="border border-border bg-card rounded-lg p-5 space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Demo Scenario</p>
          <h3 className="text-base font-bold text-foreground">{demoScenario.title}</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Environment</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{demoScenario.environment}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Total Duration</p>
            <p className="text-xs text-foreground font-medium">{demoScenario.totalDuration}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">Prerequisite</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{demoScenario.prerequisite}</p>
          </div>
        </div>

        <div className="border border-primary/20 bg-primary/5 rounded px-4 py-3">
          <p className="text-xs font-semibold text-primary tracking-wider uppercase mb-1">Opening Frame</p>
          <p className="text-sm text-muted-foreground leading-relaxed italic">{demoScenario.openingFrame}</p>
        </div>
      </div>

      {/* Step-by-step script */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3">Demo Script</p>
        <p className="text-xs text-muted-foreground mb-4">Click any step to expand the full narrative and technical notes.</p>
        <div className="space-y-3">
          {demoSteps.map((step, i) => {
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

      {/* Objection responses */}
      <div className="border border-border bg-card rounded-lg overflow-hidden">
        <button
          onClick={() => setShowObjections(!showObjections)}
          className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-muted/20 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Demo Interruption Responses</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The three most likely objections during a live demo — with prepared responses.
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
          Run the full script once with an external observer before the first live prospect meeting. The observer's job is to flag every moment where you improvise — those are the moments that need to be scripted before they're tested under pressure.
        </p>
      </div>
    </div>
  );
}
