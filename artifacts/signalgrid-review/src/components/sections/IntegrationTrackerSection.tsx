import { useState } from "react";
import {
  integrationTargets,
  integrationStatusMeta,
  type IntegrationStatus,
} from "@/data/integrationData";

const categoryFilters = ["All", "Identity Provider", "MDM / UEM", "ITSM / Workflow", "SIEM / Analytics"] as const;

const priorityColors: Record<string, string> = {
  P1: "text-red-400 bg-red-900/30 border-red-800/50",
  P2: "text-amber-400 bg-amber-900/30 border-amber-800/50",
  P3: "text-stone-400 bg-stone-800/50 border-stone-700/50",
};

const STATUS_ORDER: IntegrationStatus[] = [
  "not-started",
  "in-progress",
  "sandbox-validated",
  "demo-ready",
];

interface Props {
  statuses: Record<string, IntegrationStatus>;
  notes: Record<string, string>;
  cycleStatus: (id: string) => void;
  setNote: (id: string, note: string) => void;
}

export default function IntegrationTrackerSection({ statuses, notes, cycleStatus, setNote }: Props) {
  const [filter, setFilter] = useState<string>("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showQuickstart, setShowQuickstart] = useState<string | null>(null);

  const filtered = filter === "All"
    ? integrationTargets
    : integrationTargets.filter((t) => t.category === filter);

  const statusCounts = integrationTargets.reduce<Record<IntegrationStatus, number>>(
    (acc, t) => {
      const s = statuses[t.id] ?? t.status;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    { "not-started": 0, "in-progress": 0, "sandbox-validated": 0, "demo-ready": 0 }
  );

  const totalDone = statusCounts["sandbox-validated"] + statusCounts["demo-ready"];

  return (
    <div className="space-y-5">
      {/* Progress summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["demo-ready", "sandbox-validated", "in-progress", "not-started"] as IntegrationStatus[]).map((s) => {
          const meta = integrationStatusMeta[s];
          return (
            <div key={s} className={`border border-border rounded-lg px-4 py-3 ${meta.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <span className={`text-xs font-semibold ${meta.color}`}>{meta.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{statusCounts[s]}</p>
              <p className="text-xs text-muted-foreground">of {integrationTargets.length}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          The runtime decision layer is only as good as the signals it can receive. Click any status badge to update progress — all changes are saved locally.{" "}
          <span className="text-primary font-medium">Fleet MDM</span> is added as a P1 open-source alternative with a full API quickstart below.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-1.5 w-24 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-600 rounded-full transition-all duration-500"
              style={{ width: `${(totalDone / integrationTargets.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{totalDone}/{integrationTargets.length} validated</span>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        {categoryFilters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-primary/20 text-primary border border-primary/40"
                : "bg-muted text-muted-foreground border border-border hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Integration list */}
      <div className="space-y-2">
        {filtered.map((target) => {
          const currentStatus = statuses[target.id] ?? target.status;
          const meta = integrationStatusMeta[currentStatus];
          const currentNote = notes[target.id] ?? "";
          const isExpanded = expanded === target.id;
          const isQuickstart = showQuickstart === target.id;
          const statusIdx = STATUS_ORDER.indexOf(currentStatus);

          return (
            <div
              key={target.id}
              className={`border bg-card rounded-lg overflow-hidden transition-all ${
                target.id === "fleet" ? "border-primary/30" : "border-border"
              }`}
            >
              {/* Fleet badge */}
              {target.id === "fleet" && (
                <div className="px-5 pt-3 pb-0">
                  <span className="text-xs px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30 font-semibold">
                    ✦ Recommended first integration · Open source · Free sandbox
                  </span>
                </div>
              )}

              <div className="flex items-center gap-0 px-5 py-3.5">
                {/* Left: clickable expand area */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded(isExpanded ? null : target.id)}
                  onKeyDown={(e) => e.key === "Enter" && setExpanded(isExpanded ? null : target.id)}
                  className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <div className={`w-2 h-2 rounded-full ${meta.dot} shrink-0`} />
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-semibold text-foreground">{target.vendor}</span>
                    <span className="text-stone-600">·</span>
                    <span className="text-sm text-muted-foreground">{target.product}</span>
                  </div>
                </div>
                {/* Right: controls */}
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end ml-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${priorityColors[target.priority]}`}>
                    {target.priority}
                  </span>
                  <button
                    onClick={() => cycleStatus(target.id)}
                    title="Click to update status"
                    className={`text-xs px-2 py-0.5 rounded border font-medium transition-all hover:ring-1 hover:ring-primary/40 ${meta.bg} ${meta.color} border-border`}
                  >
                    {meta.label} ↻
                  </button>
                  <div className="flex gap-0.5">
                    {STATUS_ORDER.map((_, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full ${i <= statusIdx ? meta.dot : "bg-border"}`} />
                    ))}
                  </div>
                  <div className="hidden sm:flex gap-1">
                    {target.signalTypes.map((st) => (
                      <span key={st} className="text-xs px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                        {st}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : target.id)}
                    className="text-muted-foreground text-sm w-5 text-center"
                  >
                    {isExpanded ? "−" : "+"}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-border px-5 py-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-1">
                      Integration Notes
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{target.notes}</p>
                  </div>

                  {target.blockers && (
                    <div>
                      <p className="text-xs font-semibold text-amber-400 tracking-wider uppercase mb-1">
                        Current Blockers
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-amber-700 pl-3">
                        {target.blockers}
                      </p>
                    </div>
                  )}

                  {/* Workspace notes — editable */}
                  <div>
                    <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-1">
                      Your Notes
                    </p>
                    <textarea
                      value={currentNote}
                      onChange={(e) => setNote(target.id, e.target.value)}
                      placeholder="Add notes, progress updates, blockers, or next steps..."
                      rows={3}
                      className="w-full bg-muted/30 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
                    />
                  </div>

                  {/* Status stepper */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">
                      Update Status
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {STATUS_ORDER.map((s) => {
                        const sm = integrationStatusMeta[s];
                        const isActive = currentStatus === s;
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              if (!isActive) {
                                const targetIdx = STATUS_ORDER.indexOf(s);
                                const currentIdx = STATUS_ORDER.indexOf(currentStatus);
                                const clicks = (targetIdx - currentIdx + STATUS_ORDER.length) % STATUS_ORDER.length;
                                for (let i = 0; i < clicks; i++) cycleStatus(target.id);
                              }
                            }}
                            className={`text-xs px-2.5 py-1 rounded border font-medium transition-all ${
                              isActive
                                ? `${sm.bg} ${sm.color} border-current`
                                : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {sm.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Category:</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                        {target.category}
                      </span>
                    </div>
                    {target.apiDocs && (
                      <a
                        href={target.apiDocs}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        API Docs →
                      </a>
                    )}
                  </div>

                  {/* Fleet quickstart */}
                  {target.quickstartSteps && target.quickstartSteps.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <button
                        onClick={() => setShowQuickstart(isQuickstart ? null : target.id)}
                        className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                      >
                        <span>{isQuickstart ? "Hide" : "Show"} Integration Quickstart</span>
                        <span>{isQuickstart ? "▲" : "▼"}</span>
                      </button>

                      {isQuickstart && (
                        <div className="mt-4 space-y-4">
                          {target.quickstartSteps.map((step, i) => (
                            <div key={i} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold text-primary w-5 shrink-0">
                                  {i + 1}.
                                </span>
                                <p className="text-xs font-semibold text-foreground">{step.title}</p>
                              </div>
                              <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                                {step.description}
                              </p>
                              {step.code && (
                                <div className="ml-7 relative">
                                  <pre className="bg-stone-950 border border-border rounded-md px-4 py-3 text-xs text-teal-300 overflow-x-auto leading-relaxed font-mono whitespace-pre">
                                    {step.code}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border border-border/50 bg-muted/10 rounded-lg px-4 py-3">
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">Status tracking is saved locally.</strong> Click any status badge to cycle through states.
          Click the <span className="text-primary">Integration Quickstart</span> inside Fleet or ServiceNow to see actual API calls.
          All changes persist in your browser until you clear local storage.
        </p>
      </div>
    </div>
  );
}
