import { useState } from "react";
import { competitors, threatMeta, objectionResponse } from "@/data/competitiveData";

export default function CompetitiveSection() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showObjection, setShowObjection] = useState(false);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Adjacent vendors that will surface as objections in the first ten prospect conversations. Understanding the specific gap each leaves in shared-device environments is the foundation of a credible differentiation story.
      </p>

      {/* Competitor cards */}
      <div className="space-y-3">
        {competitors.map((c) => {
          const threat = threatMeta[c.threat];
          const isExpanded = expanded === c.id;
          return (
            <div key={c.id} className="border border-border bg-card rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isExpanded ? null : c.id)}
                className="w-full text-left px-5 py-4 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full ${threat.dot} shrink-0 mt-1`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{c.vendor}</span>
                        <span className="text-sm text-muted-foreground">·</span>
                        <span className="text-sm text-muted-foreground">{c.product}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{c.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded border ${threat.bg} ${threat.color} font-medium`}>
                      {threat.label}
                    </span>
                    <span className="text-muted-foreground text-sm">{isExpanded ? "−" : "+"}</span>
                  </div>
                </div>
                {!isExpanded && (
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed pr-8 line-clamp-2">
                    {c.whatItDoes}
                  </p>
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-border px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-teal-400 tracking-wider uppercase">What It Does</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.whatItDoes}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-400 tracking-wider uppercase">Shared-Device Gap</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.sharedDeviceGap}</p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-foreground tracking-wider uppercase">SignalGrid Difference</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.signalgridDifference}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Objection response */}
      <div className="border border-primary/30 bg-primary/5 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowObjection(!showObjection)}
          className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-primary/10 transition-colors"
        >
          <div>
            <p className="text-xs font-semibold text-primary tracking-wider uppercase mb-1">Prepared Objection Response</p>
            <p className="text-sm font-medium text-foreground">{objectionResponse.title}</p>
          </div>
          <span className="text-muted-foreground shrink-0 ml-4">{showObjection ? "−" : "+"}</span>
        </button>

        {showObjection && (
          <div className="border-t border-primary/20 px-5 py-5 space-y-4">
            <div className="border border-border rounded px-4 py-3 bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">The Objection</p>
              <p className="text-sm text-foreground italic">{objectionResponse.objection}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground tracking-wider uppercase mb-2">Prepared Response</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{objectionResponse.response}</p>
            </div>
            <div className="border border-amber-800/30 bg-amber-900/10 rounded px-3 py-2">
              <p className="text-xs text-amber-400 font-semibold mb-1">Before your first call</p>
              <p className="text-xs text-muted-foreground">
                Test this response with one technical peer before using it in a live prospect conversation. The specific examples (Conditional Access login time vs. workflow execution time) will land differently depending on the prospect's stack. Know which vendor they run before you walk in.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
