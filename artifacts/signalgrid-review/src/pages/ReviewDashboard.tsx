import { useState, useEffect, useMemo } from "react";
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
import { integrationTargets } from "@/data/integrationData";
import { activationMilestones, outreachBatches } from "@/data/activationData";
import ScoreBar from "@/components/ScoreBar";
import TagBadge from "@/components/TagBadge";
import SignalArchitectureSection from "@/components/sections/SignalArchitectureSection";
import IntegrationTrackerSection from "@/components/sections/IntegrationTrackerSection";
import ActivationPlanSection from "@/components/sections/ActivationPlanSection";
import CompetitiveSection from "@/components/sections/CompetitiveSection";
import DemoScriptSection from "@/components/sections/DemoScriptSection";
import SignalGridSimulatorSection from "@/components/sections/SignalGridSimulatorSection";
import OperatorConsoleSection from "@/components/sections/OperatorConsoleSection";
import ConnectorEmulatorDashboard from "@/components/connector-emulator/ConnectorEmulatorDashboard";
import CredentialReaderDashboardSection from "@/components/sections/CredentialReaderDashboardSection";
import { useActionChecklist } from "@/hooks/useActionChecklist";
import { useScrollSpy } from "@/hooks/useScrollSpy";
import {
  useWorkspaceState,
  type OutreachBatchState,
} from "@/hooks/useWorkspaceState";

const statusLabel = {
  strong: { label: "Solid", color: "text-teal-400", dot: "bg-teal-500" },
  developing: {
    label: "Developing",
    color: "text-amber-400",
    dot: "bg-amber-500",
  },
  gap: { label: "Gap", color: "text-red-400", dot: "bg-red-500" },
};

const NAV_ITEMS = [
  { id: "operator-console", label: "Operator Console" },
  { id: "simulator", label: "Simulator" },
  { id: "app-suite", label: "App Suite" },
  { id: "connector-emulator", label: "Connector Emulator" },
  { id: "credential-reader", label: "Credential Reader" },
  { id: "scorecard", label: "Scorecard" },
  { id: "architecture", label: "Architecture" },
  { id: "integrations", label: "Integrations" },
  { id: "activation", label: "Activation" },
  { id: "competitive", label: "Competitive" },
  { id: "demo", label: "Demo Script" },
  { id: "strengths", label: "Strengths" },
  { id: "risks", label: "Risks" },
  { id: "questions", label: "Open Qs" },
  { id: "actions", label: "Actions" },
  { id: "dimensions", label: "Dimensions" },
];

const SECTION_IDS = NAV_ITEMS.map((n) => n.id);
const PRIORITY_FILTERS = [
  "All",
  "Priority 1",
  "Priority 2",
  "Priority 3",
] as const;
type PriorityFilter = (typeof PRIORITY_FILTERS)[number];

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  const headerOffset = 88;
  const top = window.scrollY + el.getBoundingClientRect().top - headerOffset;
  window.scrollTo({ top, behavior: "smooth" });
  history.replaceState(null, "", `#${id}`);
}

export default function ReviewDashboard() {
  const [expandedDimension, setExpandedDimension] = useState<string | null>(
    null,
  );
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("All");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { completed, toggle, reset } = useActionChecklist();
  const activeId = useScrollSpy(SECTION_IDS);

  // Build default states from data files (stable references via useMemo)
  const defaultIntegrationStatuses = useMemo(
    () => Object.fromEntries(integrationTargets.map((t) => [t.id, t.status])),
    [],
  );
  const defaultMilestoneStatuses = useMemo(
    () => Object.fromEntries(activationMilestones.map((m) => [m.id, m.status])),
    [],
  );
  const defaultBatches = useMemo(
    () =>
      Object.fromEntries(
        outreachBatches.map((b) => [
          b.id,
          {
            sendDate: b.sendDate,
            responsesCounted: b.responsesCounted,
            qualifiedConversations: b.qualifiedConversations,
            status: b.status,
            notes: b.notes,
          } satisfies OutreachBatchState,
        ]),
      ),
    [],
  );

  const {
    state: wsState,
    cycleIntegrationStatus,
    setIntegrationStatus,
    setIntegrationNote,
    cycleMilestoneStatus,
    setMilestoneStatus,
    updateOutreachBatch,
  } = useWorkspaceState(
    defaultIntegrationStatuses,
    defaultMilestoneStatuses,
    defaultBatches,
  );

  // Scroll to hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && SECTION_IDS.includes(hash)) {
      setTimeout(() => scrollTo(hash), 100);
    }
  }, []);

  const filteredActions =
    priorityFilter === "All"
      ? recommendedActions
      : recommendedActions.filter((a) => a.tag === priorityFilter);

  const completedCount = recommendedActions.filter((a) =>
    completed.has(a.id),
  ).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-72 bg-card border-l border-border p-6 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-foreground">
                Navigate
              </span>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={() => {
                    setMobileNavOpen(false);
                    window.setTimeout(() => scrollTo(item.id), 0);
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeId === item.id
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">
                {REVIEW_DATE} · {REVIEW_VERSION}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {wsState.lastUpdated
                  ? `Last updated: ${new Date(wsState.lastUpdated).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect
                  x="1"
                  y="1"
                  width="5"
                  height="5"
                  rx="1"
                  fill="currentColor"
                  className="text-primary"
                />
                <rect
                  x="8"
                  y="1"
                  width="5"
                  height="5"
                  rx="1"
                  fill="currentColor"
                  className="text-primary/50"
                />
                <rect
                  x="1"
                  y="8"
                  width="5"
                  height="5"
                  rx="1"
                  fill="currentColor"
                  className="text-primary/50"
                />
                <rect
                  x="8"
                  y="8"
                  width="5"
                  height="5"
                  rx="1"
                  fill="currentColor"
                  className="text-primary/30"
                />
              </svg>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-foreground tracking-tight">
                SignalGrid
              </span>
              <span className="text-muted-foreground text-xs hidden sm:inline">
                Review Workspace
              </span>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto flex-1 justify-start">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={() => window.setTimeout(() => scrollTo(item.id), 0)}
                className={`px-2.5 py-1.5 text-xs rounded-md whitespace-nowrap transition-colors ${
                  activeId === item.id
                    ? "bg-primary/15 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Mobile nav trigger */}
          <button
            className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            onClick={() => setMobileNavOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect
                y="2"
                width="16"
                height="1.5"
                rx="0.75"
                fill="currentColor"
              />
              <rect
                y="7.25"
                width="16"
                height="1.5"
                rx="0.75"
                fill="currentColor"
              />
              <rect
                y="12.5"
                width="16"
                height="1.5"
                rx="0.75"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-10 space-y-20">
        {/* ── Hero ── */}
        <section className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded border border-border">
                {REVIEW_DATE} · {REVIEW_VERSION}
              </span>
              <span className="text-xs text-muted-foreground">
                Independent analysis · Not legal or compliance advice
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground leading-tight">
              SignalGrid
              <br />
              <span className="text-muted-foreground font-normal">
                Pre-Launch Review Workspace
              </span>
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm md:text-base leading-relaxed mt-4">
              A live coordination workspace covering product readiness,
              integration surface, demo readiness, brand assets, launch
              outreach, competitive positioning, and 30/60/90-day activation.
              Integration statuses, milestone progress, and outreach metrics are
              all editable and saved locally.
            </p>
          </div>

          <div className="border border-primary/30 bg-primary/5 rounded-lg px-5 py-4 max-w-3xl">
            <p className="text-xs font-semibold text-primary tracking-wider uppercase mb-2">
              Documented Positioning
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              SignalGrid is a{" "}
              <strong className="text-foreground">
                runtime decision layer
              </strong>{" "}
              and{" "}
              <strong className="text-foreground">
                Zero Trust orchestration platform
              </strong>{" "}
              for shared-device and mobile frontline environments — using{" "}
              <span className="text-teal-400">identity</span>,{" "}
              <span className="text-sky-400">device posture</span>,{" "}
              <span className="text-violet-400">session context</span>, and{" "}
              <span className="text-amber-400">operational signals</span> to
              determine access outcomes{" "}
              <em className="text-foreground">before workflows break</em>.
              Explicitly not a replacement for IAM, UEM, SIEM, or ITSM.
            </p>
          </div>

          {/* Overall score */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 border border-border bg-card rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                    {overallScore.label}
                  </p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-5xl font-bold text-foreground">
                      {overallScore.value}
                    </span>
                    <span className="text-xl text-muted-foreground">
                      / {overallScore.maxValue}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    Composite · 8 dimensions
                  </p>
                  <p className="text-xs text-amber-400 mt-1 font-medium">
                    Developing → Ready
                  </p>
                </div>
              </div>
              <ScoreBar
                score={overallScore.value}
                maxScore={overallScore.maxValue}
                status="developing"
                size="lg"
              />
              <p className="text-sm text-muted-foreground leading-relaxed">
                {overallScore.interpretation}
              </p>
            </div>
            <div className="border border-border bg-card rounded-lg p-5 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                Dimension Summary
              </p>
              {scorecardItems.slice(0, 5).map((item) => (
                <div key={item.dimension} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground truncate pr-2">
                      {item.dimension}
                    </span>
                    <span
                      className={`text-xs font-semibold ${statusLabel[item.status].color} shrink-0`}
                    >
                      {item.score}/{item.maxScore}
                    </span>
                  </div>
                  <ScoreBar
                    score={item.score}
                    maxScore={item.maxScore}
                    status={item.status}
                    size="sm"
                  />
                </div>
              ))}
              <button
                onClick={() => scrollTo("scorecard")}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                View full scorecard →
              </button>
            </div>
          </div>
        </section>

        {/* Operator console — in-browser decision trace */}
        <section id="operator-console" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Operator Console — Decision Trace"
            description="Product-shaped, tenant-scoped decision loop running deterministically in-browser: each shared-device access decision is traced from outcome to matched rules, evidence snapshot, versioned policy, and a tamper-evident audit chain. Public-safe synthetic data only."
          />
          <OperatorConsoleSection />
        </section>

        {/* Real-life simulator foundation */}
        <section id="simulator" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="SignalGrid Real-Life Simulator"
            description="Fixture-based simulator for runtime trust, operational orchestration, owner routing, and audit evidence across shared-device and mobile environments."
          />
          <SignalGridSimulatorSection />
        </section>

        {/* Connector emulator review dashboard */}
        <section id="connector-emulator" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Connector Emulator Review Dashboard"
            description="Static, fixture-backed review surface for synthetic connector scenarios, decisions, routes, approval gates, and deterministic proof evidence."
          />
          <ConnectorEmulatorDashboard />
        </section>

        {/* Credential reader / smart locker review dashboard */}
        <section id="credential-reader" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Credential Reader / Smart Locker Review Dashboard"
            description="Static, fixture-backed dashboard for credential-reader and smart-locker scenarios: badge read, identity correlation, custody correlation, device/workflow context, decision, route owner, and verification expectation."
          />
          <CredentialReaderDashboardSection />
        </section>

        {/* ── Scorecard ── */}
        <section id="scorecard" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Launch Readiness Scorecard"
            description="Eight dimensions scored 1–10 based on evidence at review date. Integration Surface Coverage replaced 'workflow noise' as a product-stage-relevant dimension."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scorecardItems.map((item) => {
              const s = statusLabel[item.status];
              return (
                <div
                  key={item.dimension}
                  className="border border-border bg-card rounded-lg p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${s.dot} shrink-0`}
                      />
                      <p className="text-sm font-semibold text-foreground">
                        {item.dimension}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xl font-bold text-foreground">
                        {item.score}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        /{item.maxScore}
                      </span>
                    </div>
                  </div>
                  <ScoreBar
                    score={item.score}
                    maxScore={item.maxScore}
                    status={item.status}
                  />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {item.rationale}
                  </p>
                  <span className={`text-xs font-semibold ${s.color}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="border border-border/50 bg-muted/20 rounded-lg px-5 py-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Scoring methodology:</strong>{" "}
              Qualitative assessments based on reported state at review date.
              Not audited, validated, or legally significant. No compliance or
              security certification implied.
            </p>
          </div>
        </section>

        {/* ── Signal Architecture ── */}
        <section id="architecture" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Signal Architecture"
            description="The four signal types that feed SignalGrid's runtime decision engine — with real shared-device frontline scenarios for each. Click any signal type to expand."
          />
          <SignalArchitectureSection />
        </section>

        {/* ── Integration Tracker ── */}
        <section id="integrations" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Integration Proof Tracker"
            description="Named integration targets with editable status tracking. Microsoft Intune / Entra posture is the first concrete proof; Fleet, Jamf, Workspace ONE, and broader UEM paths are follow-on connector options. Click status badges to update progress — saved locally."
          />
          <IntegrationTrackerSection
            statuses={wsState.integrationStatuses}
            notes={wsState.integrationNotes}
            cycleStatus={cycleIntegrationStatus}
            setStatus={setIntegrationStatus}
            setNote={setIntegrationNote}
          />
        </section>

        {/* ── Activation Plan ── */}
        <section id="activation" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="30/60/90-Day Activation Plan"
            description="Editable milestone tracker and outreach batch tracker. Update milestone statuses, set a send date, and track responses. All changes saved locally."
          />
          <ActivationPlanSection
            milestoneStatuses={wsState.milestoneStatuses}
            cycleMilestoneStatus={cycleMilestoneStatus}
            setMilestoneStatus={setMilestoneStatus}
            batchState={wsState.outreachBatches}
            updateBatch={updateOutreachBatch}
          />
        </section>

        {/* ── Competitive ── */}
        <section id="competitive" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Competitive Positioning"
            description="Adjacent vendors that surface as objections in early prospect conversations — with the specific shared-device gap each leaves, and the prepared 'extend existing stack' objection response."
          />
          <CompetitiveSection />
        </section>

        {/* ── Demo Script ── */}
        <section id="demo" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Controlled Demo Script"
            description="Scripted, step-by-step demo narrative for the frontline shift-change access decision scenario. Includes prepared responses to the three most likely demo interruptions."
          />
          <DemoScriptSection />
        </section>

        {/* ── Strengths ── */}
        <section id="strengths" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Strengths"
            description="What SignalGrid is doing well at this stage, relative to comparable pre-launch B2B security projects."
          />
          <div className="space-y-3">
            {strengths.map((item, i) => (
              <ReviewCard
                key={item.id}
                item={item}
                variant="strength"
                index={i}
              />
            ))}
          </div>
        </section>

        {/* ── Risks ── */}
        <section id="risks" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Risks"
            description="Material gaps that could limit credibility or forward progress before first external conversations."
          />
          <div className="space-y-3">
            {risks.map((item, i) => (
              <ReviewCard key={item.id} item={item} variant="risk" index={i} />
            ))}
          </div>
        </section>

        {/* ── Open Questions ── */}
        <section id="questions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Open Questions"
            description="Questions that need external answers before any go-to-market activity scales."
          />
          <div className="space-y-3">
            {openQuestions.map((item, i) => (
              <ReviewCard
                key={item.id}
                item={item}
                variant="question"
                index={i}
              />
            ))}
          </div>
        </section>

        {/* ── Recommended Actions ── */}
        <section id="actions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Recommended Next Actions"
            description="Check off actions as completed — saved in your browser. Filter by priority to focus on what's blocking."
          />
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRIORITY_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setPriorityFilter(f)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    priorityFilter === f
                      ? "bg-primary/20 text-primary border border-primary/40"
                      : "bg-muted text-muted-foreground border border-border hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {completedCount}/{recommendedActions.length} completed
              </span>
              {completedCount > 0 && (
                <button
                  onClick={reset}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {completedCount > 0 && (
            <ScoreBar
              score={completedCount}
              maxScore={recommendedActions.length}
              status={
                completedCount === recommendedActions.length
                  ? "strong"
                  : "developing"
              }
              size="sm"
            />
          )}

          <div className="space-y-3">
            {filteredActions.map((item) => {
              const isDone = completed.has(item.id);
              const globalIndex = recommendedActions.indexOf(item);
              return (
                <div
                  key={item.id}
                  className={`border border-l-2 rounded-lg px-5 py-4 transition-all ${
                    isDone
                      ? "border-border border-l-teal-700 bg-teal-950/10 opacity-60"
                      : item.tag === "Priority 1"
                        ? "border-border border-l-red-800 bg-card"
                        : item.tag === "Priority 2"
                          ? "border-border border-l-amber-700 bg-card"
                          : "border-border border-l-stone-600 bg-card"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <button
                      onClick={() => toggle(item.id)}
                      className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                        isDone
                          ? "bg-teal-700 border-teal-600"
                          : "border-border hover:border-primary"
                      }`}
                    >
                      {isDone && (
                        <svg
                          width="10"
                          height="8"
                          viewBox="0 0 10 8"
                          fill="none"
                        >
                          <path
                            d="M1 4L3.5 6.5L9 1"
                            stroke="white"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="text-xs font-mono font-semibold text-muted-foreground shrink-0 mt-0.5">
                            {String(globalIndex + 1).padStart(2, "0")}
                          </span>
                          <p
                            className={`text-sm font-semibold leading-tight ${isDone ? "line-through text-muted-foreground" : "text-foreground"}`}
                          >
                            {item.title}
                          </p>
                        </div>
                        {item.tag && <TagBadge tag={item.tag} />}
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed pl-5">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredActions.length === 0 && (
            <div className="border border-border rounded-lg px-5 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No actions match this filter.
              </p>
            </div>
          )}
        </section>

        {/* ── Dimension Review ── */}
        <section id="dimensions" className="space-y-6 scroll-mt-20">
          <SectionHeader
            label="Dimension Review"
            description="Detailed observations, identified gaps, and specific actions per dimension. Click to expand."
          />
          <div className="space-y-3">
            {dimensionReviews.map((dim) => {
              const isOpen = expandedDimension === dim.key;
              const scoreStatus: "strong" | "developing" | "gap" =
                dim.score >= 7
                  ? "strong"
                  : dim.score >= 5
                    ? "developing"
                    : "gap";
              const s = statusLabel[scoreStatus];
              return (
                <div
                  key={dim.key}
                  className="border border-border bg-card rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setExpandedDimension(isOpen ? null : dim.key)
                    }
                    className="w-full text-left px-5 py-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-2 h-2 rounded-full ${s.dot} shrink-0`}
                        />
                        <p className="text-sm font-semibold text-foreground truncate">
                          {dim.label}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="hidden sm:flex items-center gap-2 w-28">
                          <ScoreBar
                            score={dim.score}
                            maxScore={10}
                            status={scoreStatus}
                            size="sm"
                          />
                          <span className="text-xs text-muted-foreground">
                            {dim.score}/10
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${s.color}`}>
                          {s.label}
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {isOpen ? "−" : "+"}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed pr-8">
                      {dim.summary}
                    </p>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border px-5 py-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-teal-400 tracking-wider uppercase">
                          Observations
                        </p>
                        <ul className="space-y-2">
                          {dim.observations.map((o, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-xs text-muted-foreground"
                            >
                              <span className="text-teal-600 mt-0.5 shrink-0">
                                ·
                              </span>
                              {o}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-amber-400 tracking-wider uppercase">
                          Identified Gaps
                        </p>
                        <ul className="space-y-2">
                          {dim.gaps.map((g, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-xs text-muted-foreground"
                            >
                              <span className="text-amber-700 mt-0.5 shrink-0">
                                ▸
                              </span>
                              {g}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-foreground tracking-wider uppercase">
                          Recommended Actions
                        </p>
                        <ul className="space-y-2">
                          {dim.actions.map((a, i) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 text-xs text-muted-foreground"
                            >
                              <span className="text-foreground/50 mt-0.5 shrink-0">
                                {i + 1}.
                              </span>
                              {a}
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

        {/* ── Footer ── */}
        <footer className="border-t border-border pt-8 pb-16 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">
                Scope & Limitations
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This workspace is based on reported state and described
                artifacts as of {REVIEW_DATE}. It is not an audit, penetration
                test, compliance assessment, or security certification. No live
                system has been directly inspected. Scores and assessments are
                qualitative opinions and should not be relied upon as
                authoritative technical or legal guidance.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-2">
                This Workspace Does Not Assert
              </p>
              <ul className="space-y-1">
                {[
                  "Production readiness of any SignalGrid component",
                  "Compliance with HIPAA, SOC 2, FedRAMP, or any other framework",
                  "Validation of any live enterprise integration",
                  "Replacement or equivalence to IAM, UEM, SIEM, or ITSM platforms",
                  "Investment recommendation or endorsement",
                ].map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-muted-foreground"
                  >
                    <span className="text-muted-foreground/40 mt-0.5 shrink-0">
                      ×
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center justify-between pt-4 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-primary/15 border border-primary/30 flex items-center justify-center">
                <div className="w-2 h-2 rounded-sm bg-primary" />
              </div>
              <span className="text-xs text-muted-foreground">
                SignalGrid Review Workspace · {REVIEW_DATE}
              </span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {REVIEW_VERSION}
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function SectionHeader({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="space-y-1 border-b border-border pb-4">
      <h2 className="text-xl font-semibold text-foreground tracking-tight">
        {label}
      </h2>
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
          <span
            className={`text-xs font-mono font-semibold ${indexColor} shrink-0 mt-0.5`}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <p className="text-sm font-semibold text-foreground leading-tight">
            {item.title}
          </p>
        </div>
        {item.tag && (
          <div className="shrink-0">
            <TagBadge tag={item.tag} />
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed pl-7">
        {item.body}
      </p>
    </div>
  );
}
