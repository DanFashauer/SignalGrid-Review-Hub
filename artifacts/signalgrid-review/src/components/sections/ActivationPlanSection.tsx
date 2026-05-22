import { useState } from "react";
import { activationMilestones, milestoneStatusMeta, type MilestoneStatus } from "@/data/activationData";
import type { OutreachBatchState } from "@/hooks/useWorkspaceState";

const MILESTONE_ORDER: MilestoneStatus[] = ["not-started", "in-progress", "complete", "blocked"];

const phaseAccent: Record<string, string> = {
  "Day 30": "border-l-red-700",
  "Day 60": "border-l-amber-700",
  "Day 90": "border-l-teal-700",
};

const batchStatusOptions: { value: OutreachBatchState["status"]; label: string; color: string }[] = [
  { value: "planned", label: "Planned", color: "text-stone-400 bg-stone-900/40 border-stone-700" },
  { value: "sent", label: "Sent", color: "text-amber-400 bg-amber-900/30 border-amber-800" },
  { value: "complete", label: "Complete", color: "text-teal-400 bg-teal-900/30 border-teal-700" },
];

interface Props {
  milestoneStatuses: Record<string, MilestoneStatus>;
  cycleMilestoneStatus: (id: string) => void;
  batchState: Record<string, OutreachBatchState>;
  updateBatch: (id: string, patch: Partial<OutreachBatchState>) => void;
}

export default function ActivationPlanSection({
  milestoneStatuses,
  cycleMilestoneStatus,
  batchState,
  updateBatch,
}: Props) {
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>("m30");

  const allComplete = activationMilestones.every(
    (m) => milestoneStatuses[m.id] === "complete"
  );

  const completedCount = activationMilestones.filter(
    (m) => milestoneStatuses[m.id] === "complete"
  ).length;

  return (
    <div className="space-y-8">
      {/* 30/60/90 header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">30/60/90-Day Activation Plan</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Click any status badge to update milestone progress. A milestone is complete when its exit gate is met — not when all tasks are done.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {activationMilestones.map((m) => {
                const s = milestoneStatuses[m.id] ?? m.status;
                const meta = milestoneStatusMeta[s];
                return <div key={m.id} className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />;
              })}
            </div>
            <span className="text-xs text-muted-foreground">
              {completedCount}/{activationMilestones.length} complete
            </span>
          </div>
        </div>

        {/* Timeline */}
        <div className="relative space-y-3">
          {/* Vertical connector */}
          <div className="absolute left-[22px] top-6 bottom-6 w-px bg-border" />

          {activationMilestones.map((m) => {
            const currentStatus = milestoneStatuses[m.id] ?? m.status;
            const meta = milestoneStatusMeta[currentStatus];
            const isExpanded = expandedMilestone === m.id;

            return (
              <div key={m.id} className="relative pl-10">
                {/* Timeline dot */}
                <div className={`absolute left-4 top-4 w-3 h-3 rounded-full border-2 border-background ${meta.dot} z-10`} />

                <div className={`border border-border border-l-4 ${phaseAccent[m.day]} bg-card rounded-lg overflow-hidden`}>
                  <div className="flex items-start gap-0 px-4 py-3.5">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedMilestone(isExpanded ? null : m.id)}
                      onKeyDown={(e) => e.key === "Enter" && setExpandedMilestone(isExpanded ? null : m.id)}
                      className="flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity pr-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-muted-foreground">{m.day}</span>
                        <span className="text-sm font-bold text-foreground">{m.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                        {m.successCriteria}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => cycleMilestoneStatus(m.id)}
                        title="Click to update status"
                        className={`text-xs px-2 py-0.5 rounded border font-medium transition-all hover:ring-1 hover:ring-primary/40 ${meta.color} border-current bg-transparent`}
                      >
                        {meta.label} ↻
                      </button>
                      <button
                        onClick={() => setExpandedMilestone(isExpanded ? null : m.id)}
                        className="text-muted-foreground text-sm w-5 text-center"
                      >
                        {isExpanded ? "−" : "+"}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border px-4 py-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Tasks</p>
                          <ul className="space-y-1.5">
                            {m.tasks.map((t, ti) => (
                              <li key={ti} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <span className="text-muted-foreground/50 mt-0.5 shrink-0">{ti + 1}.</span>
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Exit Gate</p>
                          <div className="border border-border rounded px-3 py-2 bg-muted/20">
                            <p className="text-xs text-muted-foreground leading-relaxed italic">{m.exitGate}</p>
                          </div>
                        </div>
                      </div>

                      {/* Status selector */}
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">Update Status</p>
                        <div className="flex gap-2 flex-wrap">
                          {MILESTONE_ORDER.map((s) => {
                            const sm = milestoneStatusMeta[s];
                            const isActive = currentStatus === s;
                            return (
                              <button
                                key={s}
                                onClick={() => {
                                  if (!isActive) {
                                    const targetIdx = MILESTONE_ORDER.indexOf(s);
                                    const currentIdx = MILESTONE_ORDER.indexOf(currentStatus);
                                    const clicks = (targetIdx - currentIdx + MILESTONE_ORDER.length) % MILESTONE_ORDER.length;
                                    for (let i = 0; i < clicks; i++) cycleMilestoneStatus(m.id);
                                  }
                                }}
                                className={`text-xs px-2.5 py-1 rounded border font-medium transition-all ${
                                  isActive
                                    ? `${sm.color} border-current bg-muted/30`
                                    : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {sm.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {allComplete && (
          <div className="border border-teal-700/50 bg-teal-900/10 rounded-lg px-4 py-3">
            <p className="text-xs text-teal-400 font-semibold">All three milestones complete — update the outreach tracker below with your results.</p>
          </div>
        )}
      </div>

      {/* Outreach Activation Tracker */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Outreach Activation Tracker</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Track your first batch. All fields are editable — update send date, status, and response counts as you go.
          </p>
        </div>

        {Object.entries(batchState).map(([batchId, batch]) => {
          const statusMeta = batchStatusOptions.find((s) => s.value === batch.status) ?? batchStatusOptions[0];
          const responseRate = batch.responsesCounted > 0
            ? Math.round((batch.responsesCounted / 25) * 100)
            : 0;
          const conversionRate = batch.responsesCounted > 0
            ? Math.round((batch.qualifiedConversations / batch.responsesCounted) * 100)
            : 0;

          return (
            <div key={batchId} className="border border-border bg-card rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-bold text-foreground">
                    Batch {batchId.replace("batch", "")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Target: 25 sends · ICP: Operations/IT leader in shared-device environment</p>
                </div>
                {/* Batch status selector */}
                <div className="flex gap-1.5">
                  {batchStatusOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => updateBatch(batchId, { status: opt.value })}
                      className={`text-xs px-2 py-0.5 rounded border font-medium transition-all ${
                        batch.status === opt.value
                          ? opt.color
                          : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable send date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground tracking-wider uppercase block mb-1.5">
                    Send Date
                  </label>
                  <input
                    type="text"
                    value={batch.sendDate}
                    onChange={(e) => updateBatch(batchId, { sendDate: e.target.value })}
                    placeholder="e.g. June 3, 2026"
                    className="w-full bg-muted/30 border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {(batch.sendDate === "TBD — set a specific date" || !batch.sendDate) && (
                    <p className="text-xs text-amber-400 mt-1">Set a specific date. Not a range — a date.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground tracking-wider uppercase block mb-1.5">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={batch.notes}
                    onChange={(e) => updateBatch(batchId, { notes: e.target.value })}
                    placeholder="Outreach notes, copy version, target list..."
                    className="w-full bg-muted/30 border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>

              {/* Editable response metrics */}
              <div>
                <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-2">Response Metrics</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="border border-border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Responses</p>
                    <input
                      type="number"
                      min={0}
                      value={batch.responsesCounted}
                      onChange={(e) => updateBatch(batchId, { responsesCounted: parseInt(e.target.value) || 0 })}
                      className="w-full text-center text-xl font-bold text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary/50 rounded"
                    />
                  </div>
                  <div className="border border-border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Qualified calls</p>
                    <input
                      type="number"
                      min={0}
                      value={batch.qualifiedConversations}
                      onChange={(e) => updateBatch(batchId, { qualifiedConversations: parseInt(e.target.value) || 0 })}
                      className="w-full text-center text-xl font-bold text-foreground bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary/50 rounded"
                    />
                  </div>
                  <div className="border border-border rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Response rate</p>
                    <p className="text-xl font-bold text-foreground">{responseRate}%</p>
                  </div>
                </div>
              </div>

              {/* ICP Profile */}
              <div>
                <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-1">ICP Profile</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Operations director or IT manager at a 200–2,000 employee organization in healthcare, logistics, or field services. Uses shared iOS/Android devices across frontline workforce. Responsible for workflow continuity and device management.
                </p>
              </div>
            </div>
          );
        })}

        {/* Activation urgency */}
        <div className="border border-amber-800/40 bg-amber-900/10 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">⚡ The only remaining step is picking a date</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The package exists. The ICP is defined. Update the Send Date field above with a specific date — not "soon," not "this week." Treat that date as the exit gate for pre-launch preparation. Nothing else needs to be ready before it.
          </p>
        </div>
      </div>
    </div>
  );
}
