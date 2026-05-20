import { useState } from "react";
import {
  scorecardItems,
  strengths,
  risks,
  openQuestions,
  recommendedActions,
  dimensionReviews,
  overallScore,
  REVIEW_DATE,
  REVIEW_VERSION,
} from "@/data/reviewData";
import ScoreBar from "@/components/ScoreBar";
import TagBadge from "@/components/TagBadge";

const statusLabel = {
  strong: { label: "Solid", color: "text-teal-400", dot: "bg-teal-500" },
  developing: { label: "Developing", color: "text-amber-400", dot: "bg-amber-500" },
  gap: { label: "Gap", color: "text-red-400", dot: "bg-red-500" },
};

const NAV_ITEMS = [
  { id: "scorecard", label: "Scorecard" },
  { id: "strengths", label: "Strengths" },
  { id: "risks", label: "Risks" },
  { id: "questions", label: "Open Questions" },
  { id: "actions", label: "Next Actions" },
  { id: "dimensions", label: "Dimension Review" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function ReviewDashboard() {
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-primary/20 border border-primary/40 flex items-center justify-center">
              <div className="w-3 h-3 rounded-sm bg-primary" />
            </div>
            <div>
              <span className="font-semibold text-foreground tracking-tight">SignalGrid</span>
              <span className="ml-2 text-muted-foreground text-xs">Second-Opinion Review</span>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-20">

        {/* Hero */}
        <section className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded border border-border">
                {REVIEW_DATE} — {REVIEW_VERSION}
              </span>
              <span className="text-xs text-muted-foreground">Independent analysis · Not legal or compliance advice</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground leading-tight">
              SignalGrid<br />
              <span className="text-muted-foreground font-normal">Pre-Launch Second Opinion</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl text-base leading-relaxed mt-4">
              An independent review of SignalGrid's current state across product readiness, demo readiness, brand assets,
              launch outreach, GitHub hygiene, workflow automation, and market positioning. This review is a structured
              outside perspective, not a validator of production readiness, compliance posture, or integration completeness.
            </p>
          </div>

          {/* Positioning callout */}
          <div className="border border-primary/30 bg-primary/5 rounded-lg px-5 py-4 max-w-3xl">
            <p className="text-xs font-semibold text-primary tracking-wider uppercase mb-2">Reviewed Positioning</p>
            <p className="text-sm text-foreground leading-relaxed">
              SignalGrid is positioned as a <strong className="text-foreground">runtime decision layer</strong> and{" "}
              <strong className="text-foreground">Zero Trust orchestration platform</strong> for shared-device and mobile frontline
              environments — using identity, device posture, session context, and operational signals to determine access outcomes{" "}
              <em>before workflows break</em>. It is explicitly not a replacement for IAM, UEM, SIEM, or ITSM.
            </p>
          </div>

          {/* Overall score card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="md:col-span-2 border border-border bg-card rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">{overallScore.label}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-5xl font-bold text-foreground">{overallScore.value}</span>
                    <span className="text-xl text-muted-foreground">/ {overallScore.maxValue}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Composite across 8 dimensions</p>
                  <p className="text-xs text-amber-400 mt-1 font-medium">Developing → Ready</p>
                </div>
              </div>
              <ScoreBar score={overallScore.value} maxScore={overallScore.maxValue} status="developing" size="lg" />
              <p className="text-sm text-muted-foreground leading-relaxed">{overallScore.interpretation}</p>
            </div>
            <div className="border border-border bg-card rounded-lg p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Dimension Summary</p>
              {scorecardItems.slice(0, 4).map((item) => (
                <div key={item.dimension} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground truncate pr-2">{item.dimension}</span>
                    <span className={`text-xs font-semibold ${statusLabel[item.status].color} shrink-0`}>
                      {item.score}/{item.maxScore}
                    </span>
                  </div>
                  <ScoreBar score={item.score} maxScore={item.maxScore} status={item.status} size="sm" />
                </div>
              ))}
              <button
                onClick={() => scrollTo("scorecard")}
                className="text-xs text-primary hover:text-primary/80 transition-colors mt-1"
              >
                View full scorecard →
              </button>
            </div>
          </div>
        </section>

        {/* Scorecard */}
        <section id="scorecard" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Launch Readiness Scorecard"
            description="Eight dimensions scored 1–10 based on evidence available at review date. Scores reflect current state, not potential."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scorecardItems.map((item) => {
              const s = statusLabel[item.status];
              return (
                <div key={item.dimension} className="border border-border bg-card rounded-lg p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${s.dot} shrink-0 mt-0.5`} />
                      <p className="text-sm font-semibold text-foreground">{item.dimension}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold text-foreground">{item.score}</span>
                      <span className="text-xs text-muted-foreground">/{item.maxScore}</span>
                    </div>
                  </div>
                  <ScoreBar score={item.score} maxScore={item.maxScore} status={item.status} />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.rationale}</p>
                  </div>
                  <div>
                    <span className={`text-xs font-semibold ${s.color}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border border-border/50 bg-muted/20 rounded-lg px-5 py-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Scoring methodology:</strong> Scores are qualitative assessments based on reported
              state and independent review. They reflect evidence available at the time of review and should not be interpreted as
              audited, validated, or legally significant ratings. No compliance or security certification is implied or claimed.
            </p>
          </div>
        </section>

        {/* Strengths */}
        <section id="strengths" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Strengths"
            description="What SignalGrid is doing well at this stage, relative to comparable pre-launch B2B security projects."
          />
          <div className="space-y-3">
            {strengths.map((item, i) => (
              <ReviewCard key={i} item={item} variant="strength" index={i} />
            ))}
          </div>
        </section>

        {/* Risks */}
        <section id="risks" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Risks"
            description="Material gaps that could limit credibility or progress if left unaddressed before first external conversations."
          />
          <div className="space-y-3">
            {risks.map((item, i) => (
              <ReviewCard key={i} item={item} variant="risk" index={i} />
            ))}
          </div>
        </section>

        {/* Open Questions */}
        <section id="questions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Open Questions"
            description="Questions this review cannot answer with available information — and that need answers before scaling any go-to-market activity."
          />
          <div className="space-y-3">
            {openQuestions.map((item, i) => (
              <ReviewCard key={i} item={item} variant="question" index={i} />
            ))}
          </div>
        </section>

        {/* Recommended Actions */}
        <section id="actions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Recommended Next Actions"
            description="Ordered by impact. Priority 1 items are blocking or near-blocking. Priority 2 items should be completed before first customer conversations. Priority 3 items are important but not immediately blocking."
          />
          <div className="space-y-3">
            {recommendedActions.map((item, i) => (
              <ReviewCard key={i} item={item} variant="action" index={i} />
            ))}
          </div>
        </section>

        {/* Dimension-by-dimension deep dive */}
        <section id="dimensions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Dimension Review"
            description="Detailed observations, identified gaps, and specific actions by review area. Click any dimension to expand."
          />
          <div className="space-y-3">
            {dimensionReviews.map((dim) => {
              const isOpen = expandedDimension === dim.key;
              const scoreStatus =
                dim.score >= 7 ? "strong" : dim.score >= 5 ? "developing" : "gap";
              const s = statusLabel[scoreStatus];

              return (
                <div key={dim.key} className="border border-border bg-card rounded-lg overflow-hidden">
                  <button
                    onClick={() =>
                      setExpandedDimension(isOpen ? null : dim.key)
                    }
                    className="w-full text-left px-5 py-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                        <p className="text-sm font-semibold text-foreground truncate">{dim.label}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="hidden sm:flex items-center gap-3 w-32">
                          <ScoreBar score={dim.score} maxScore={10} status={scoreStatus} size="sm" />
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {dim.score}/10
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                        <span className="text-muted-foreground text-sm">{isOpen ? "−" : "+"}</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 text-left leading-relaxed pr-8">
                      {dim.summary}
                    </p>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-teal-400 tracking-wider uppercase">Observations</p>
                        <ul className="space-y-2">
                          {dim.observations.map((o, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="text-teal-600 mt-0.5 shrink-0">·</span>
                              <span>{o}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-amber-400 tracking-wider uppercase">Identified Gaps</p>
                        <ul className="space-y-2">
                          {dim.gaps.map((g, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="text-amber-700 mt-0.5 shrink-0">▸</span>
                              <span>{g}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-foreground tracking-wider uppercase">Recommended Actions</p>
                        <ul className="space-y-2">
                          {dim.actions.map((a, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="text-foreground/60 mt-0.5 shrink-0">{i + 1}.</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Footer disclaimer */}
        <footer className="border-t border-border pt-8 pb-16 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">Scope & Limitations</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This review is based on reported state and described artifacts as of {REVIEW_DATE}. It is not an audit, penetration
                test, compliance assessment, or security certification. No live system has been directly inspected. Scores and
                assessments are qualitative opinions and should not be relied upon as authoritative technical or legal guidance.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">What This Review Does Not Assert</p>
              <ul className="space-y-1">
                {[
                  "Production readiness of any SignalGrid component",
                  "Compliance with HIPAA, SOC 2, FedRAMP, or any other framework",
                  "Validation of any live enterprise integration",
                  "Replacement or equivalence to IAM, UEM, SIEM, or ITSM platforms",
                  "Investment recommendation or endorsement",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="text-muted-foreground/50 mt-0.5 shrink-0">×</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
                <div className="w-2 h-2 rounded-sm bg-primary" />
              </div>
              <span className="text-xs text-muted-foreground">SignalGrid Second-Opinion Review — {REVIEW_DATE}</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">{REVIEW_VERSION}</span>
          </div>
        </footer>

      </main>
    </div>
  );
}

function SectionHeader({ label, description }: { label: string; description: string }) {
  return (
    <div className="space-y-1 border-b border-border pb-4">
      <h2 className="text-xl font-semibold text-foreground tracking-tight">{label}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ReviewCard({
  item,
  variant,
  index,
}: {
  item: { title: string; body: string; tag?: string };
  variant: "strength" | "risk" | "action" | "question";
  index: number;
}) {
  const leftAccent = {
    strength: "border-l-teal-600",
    risk: "border-l-red-800",
    action: "border-l-amber-700",
    question: "border-l-stone-600",
  }[variant];

  const indexColor = {
    strength: "text-teal-600",
    risk: "text-red-700",
    action: "text-amber-700",
    question: "text-stone-600",
  }[variant];

  return (
    <div
      className={`border border-border border-l-2 ${leftAccent} bg-card rounded-lg px-5 py-4 space-y-2`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`text-xs font-mono font-semibold ${indexColor} shrink-0 mt-0.5`}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <p className="text-sm font-semibold text-foreground leading-tight">{item.title}</p>
        </div>
        {item.tag && (
          <div className="shrink-0">
            <TagBadge tag={item.tag} />
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed pl-7">{item.body}</p>
    </div>
  );
}
