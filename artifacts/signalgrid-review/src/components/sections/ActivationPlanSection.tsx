import { activationMilestones, milestoneStatusMeta, outreachBatches } from "@/data/activationData";

const phaseColors: Record<string, string> = {
  "Day 30": "border-l-red-700",
  "Day 60": "border-l-amber-700",
  "Day 90": "border-l-teal-700",
};

const batchStatusColors: Record<string, string> = {
  planned: "text-stone-400 bg-stone-900/40 border-stone-700",
  sent: "text-amber-400 bg-amber-900/30 border-amber-800",
  complete: "text-teal-400 bg-teal-900/30 border-teal-700",
};

export default function ActivationPlanSection() {
  return (
    <div className="space-y-8">
      {/* 30/60/90 Timeline */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">30/60/90-Day Activation Plan</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Three milestone bands with specific exit criteria. A milestone is not complete until its exit gate is met — not when the tasks are done.
          </p>
        </div>

        {/* Timeline connector */}
        <div className="relative space-y-4">
          {activationMilestones.map((m, i) => {
            const meta = milestoneStatusMeta[m.status];
            return (
              <div key={m.id} className="relative">
                {/* Connector line */}
                {i < activationMilestones.length - 1 && (
                  <div className="absolute left-[18px] top-full w-px h-4 bg-border z-0" />
                )}

                <div className={`border border-border border-l-4 ${phaseColors[m.day]} bg-card rounded-lg p-5 space-y-4`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full ${meta.dot} mt-1.5 shrink-0`} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-semibold text-muted-foreground">{m.day}</span>
                          <span className="text-sm font-bold text-foreground">{m.title}</span>
                        </div>
                        <span className={`text-xs font-medium ${meta.color} mt-0.5 inline-block`}>{meta.label}</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">Success Criteria:</strong> {m.successCriteria}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Tasks</p>
                      <ul className="space-y-1.5">
                        {m.tasks.map((t, ti) => (
                          <li key={ti} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="text-muted-foreground/50 mt-0.5 shrink-0">{ti + 1}.</span>
                            <span>{t}</span>
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
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Outreach Activation Tracker */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Outreach Activation Tracker</h3>
          <p className="text-xs text-muted-foreground mt-1">
            First batch status, ICP profile, and response metrics. The outreach package exists — the gap is activation. Set a date.
          </p>
        </div>

        {outreachBatches.map((batch) => (
          <div key={batch.id} className="border border-border bg-card rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-foreground">Batch {batch.batchNumber}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-xs px-2 py-0.5 rounded border font-medium ${batchStatusColors[batch.status]}`}
                  >
                    {batch.status.charAt(0).toUpperCase() + batch.status.slice(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">Target: {batch.targetSize} sends</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Send date</p>
                <p className="text-sm font-semibold text-amber-400">{batch.sendDate}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="border border-border rounded px-3 py-2 text-center">
                <p className="text-lg font-bold text-foreground">{batch.responsesCounted}</p>
                <p className="text-xs text-muted-foreground">Responses</p>
              </div>
              <div className="border border-border rounded px-3 py-2 text-center">
                <p className="text-lg font-bold text-foreground">{batch.qualifiedConversations}</p>
                <p className="text-xs text-muted-foreground">Qualified calls</p>
              </div>
              <div className="border border-border rounded px-3 py-2 text-center">
                <p className="text-lg font-bold text-foreground">{batch.targetSize}</p>
                <p className="text-xs text-muted-foreground">Target sends</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-1">ICP Profile</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{batch.icpProfile}</p>
            </div>

            {batch.notes && (
              <div className="border border-border/50 bg-muted/10 rounded px-3 py-2">
                <p className="text-xs text-muted-foreground leading-relaxed">{batch.notes}</p>
              </div>
            )}
          </div>
        ))}

        <div className="border border-amber-800/40 bg-amber-900/10 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-amber-400 mb-1">⚡ Activation is the gap</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The outreach package exists. The ICP is defined. The only remaining step is picking a date and sending. 
            Set a specific date in the tracker above — not "soon", not "this week", a date — and treat that commitment as an exit gate for pre-launch preparation.
          </p>
        </div>
      </div>
    </div>
  );
}
