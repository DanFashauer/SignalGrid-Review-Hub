import { useMemo, useState } from "react";
import {
  buildCoverageReport,
  KNOWN_SOURCE_PLANES,
  SOURCE_PLANE_PROMPTS,
  type AxisCoverage,
  type AxisFinding,
  type SourcePlane,
} from "@workspace/flows";

/**
 * Evidence Coverage — "what can YOUR systems actually tell us?"
 *
 * This is the readable form of `GET /cp/v1/grid/evidence-coverage`. It calls
 * `buildCoverageReport` from `@workspace/flows` IN THE BROWSER — the same function the
 * control-plane route calls — so neither surface holds a transcribed copy of the
 * other's numbers. (Not a guarantee they always agree: this is a static build that
 * inlines `lib/flows` at build time, so a console deployed from an older commit than
 * the api-server can disagree with it. Same source, two build times. The E2E asserts
 * the two agree for the build under test, which is the part a gate can hold.)
 *
 * It cannot flatter the product. Every number gets WORSE as the estate gets thinner,
 * and the figure it leads with counts holes rather than coverage: untick every plane
 * and sixteen of eighteen axes are dark, ELEVEN of them silently — ungraded, so the
 * engine grants and no operator sees a finding. That is the honest opening position
 * for a first conversation.
 *
 * `dayOneQuiet` — the flag behind every "silent hole" on this page — is NOT evaluated
 * here. It is a field on the axis table, verified against the shipped rule set offline
 * by `proof:evidence-coverage`, which runs the real engine over each axis's ignorance
 * member. The page says so rather than letting a reader assume, next to sections that
 * really do run the decision core in the browser, that this one did too.
 */

const coverageStyles: Record<AxisCoverage, string> = {
  answerable: "border-teal-500/50 bg-teal-950/30 text-teal-200",
  needs_instrumentation: "border-amber-500/50 bg-amber-950/30 text-amber-200",
  not_sourced: "border-slate-500/40 bg-slate-900/40 text-slate-300",
};

const coverageLabel: Record<AxisCoverage, string> = {
  answerable: "ANSWERABLE",
  needs_instrumentation: "DARK",
  not_sourced: "NOT SOURCED",
};

// The wedge the positioning docs lead with — an IdP plus an MDM — and the default this
// page opens on. Opening with every plane ticked would show the flattering estate
// first; opening with none would open on an estate nobody runs. This one still leaves
// six silent holes, which is the point of the conversation.
const DEFAULT_PLANES: readonly SourcePlane[] = ["identity", "device_management"];

const planeLabel = (plane: SourcePlane): string =>
  plane.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Rank order: silent holes first, then merely-dark, then answerable, then the axes no
 * source plane was ever expected to supply. A prospect reads the top of a table; the
 * rows they most need are the ones where nothing will ever complain.
 */
const rank = (f: AxisFinding): number => {
  if (f.silentHole) return 0;
  if (f.coverage === "needs_instrumentation") return 1;
  if (f.coverage === "answerable") return 2;
  return 3;
};

function Stat({
  value,
  label,
  detail,
  tone,
  testId,
}: {
  value: number;
  label: string;
  detail: string;
  tone: string;
  testId: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      {/* The value carries its own test id. Locating a KPI by its Tailwind classes and
          a text filter is a trap: "Dark" also appears inside the silent-hole card's
          prose ("Dark AND ungraded"), so a class+text locator silently matches two
          cards the moment the copy changes. */}
      <div className="text-3xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider">{label}</div>
      <p className="mt-2 text-xs leading-relaxed opacity-80">{detail}</p>
    </div>
  );
}

export default function EvidenceCoverageSection() {
  const [planes, setPlanes] = useState<readonly SourcePlane[]>(DEFAULT_PLANES);

  const report = useMemo(() => buildCoverageReport(planes), [planes]);
  const rows = useMemo(
    () => [...report.findings].sort((a, b) => rank(a) - rank(b)),
    [report],
  );

  const toggle = (plane: SourcePlane): void =>
    setPlanes((current) =>
      current.includes(plane)
        ? current.filter((p) => p !== plane)
        : [...current, plane],
    );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          Computed in your browser · reads no customer data · calls no connector
        </p>
        <h3 className="mt-2 text-2xl font-bold text-foreground">
          Evidence Coverage — what can your systems actually tell us?
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The decision engine reads {report.totalAxes} evidence axes. Tick the source
          planes a deployment really has and this reports which axes it can answer,
          which are dark, and — the row that matters — which are dark <em>and</em>{" "}
          ungraded, where the engine returns a grant and nobody sees a finding.{" "}
          <strong className="text-foreground">This report</strong> is fail-closed by
          construction — an undeclared plane can never make an axis answerable, so the
          numbers only get worse as the estate gets thinner. The <em>engine</em> is the
          opposite on the ungraded axes, and that is exactly what the silent-hole count
          measures.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-5">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Which of these do you have?
        </h4>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {KNOWN_SOURCE_PLANES.map((plane) => {
            const on = planes.includes(plane);
            return (
              <button
                key={plane}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(plane)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                  on
                    ? "border-teal-500/50 bg-teal-950/20"
                    : "border-border bg-background/40 opacity-70 hover:opacity-100"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${
                    on
                      ? "border-teal-400 bg-teal-500/30 text-teal-200"
                      : "border-muted-foreground/50 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span>
                  <span className="block text-sm font-semibold text-foreground">
                    {planeLabel(plane)}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {SOURCE_PLANE_PROMPTS[plane]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/*
        THE HEADLINE IS NOT A FOURTH BUCKET. `silentHoles` is a SUBSET of the dark axes,
        so rendering it as a peer of the three coverage buckets made four numbers that
        summed to 24 across 18 axes — with "Dark 6" and "Silent holes 6" sitting side by
        side reading as two disjoint groups. A denominator a reader cannot check is the
        first thing a reviewer distrusts, so the subset is stated as a subset and only
        the three buckets that partition the table are shown as counts.
      */}
      <div className="rounded-xl border border-red-500/50 bg-red-950/30 p-5 text-red-200">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-bold tabular-nums" data-testid="stat-silent-holes">
            {report.silentHoles}
          </span>
          <span className="text-sm font-semibold uppercase tracking-wider">
            silent holes — of the {report.needsInstrumentation} dark axes
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed opacity-90">
          Dark <em>and</em> ungraded: this estate cannot answer them, and the shipped rule
          set still returns a grant when they are unknown. No operator sees a finding, and
          a naive backtest reads the grant as health. Which axes those are was measured
          against the real engine offline by <code>proof:evidence-coverage</code>, not
          computed on this page.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          value={report.answerable}
          label="Answerable"
          testId="stat-answerable"
          detail="A declared plane supplies it. No inference — declared or nothing."
          tone="border-teal-500/50 bg-teal-950/20 text-teal-200"
        />
        <Stat
          value={report.needsInstrumentation}
          label="Dark"
          testId="stat-dark"
          detail="A plane could answer it; this estate does not have that plane. Includes the silent holes above."
          tone="border-amber-500/50 bg-amber-950/20 text-amber-200"
        />
        <Stat
          value={report.notSourced}
          label="Not sourced"
          testId="stat-not-sourced"
          detail="Posed by the calling app or derived by the core. Not a gap, and not counted as one."
          tone="border-slate-500/40 bg-slate-900/40 text-slate-300"
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground" data-testid="coverage-denominator">
        {report.answerable} + {report.needsInstrumentation} + {report.notSourced} ={" "}
        {report.totalAxes} evidence axes. Every axis is in exactly one bucket.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-card/60 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">The question it answers</th>
              <th className="px-4 py-3 font-semibold">Coverage</th>
              <th className="px-4 py-3 font-semibold">What would answer it</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr
                key={f.axis.id}
                data-axis={f.axis.id}
                data-coverage={f.coverage}
                data-silent-hole={String(f.silentHole)}
                className={`border-t border-border/60 align-top ${
                  f.silentHole ? "bg-red-950/10" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <span className="block text-foreground">{f.axis.question}</span>
                  <code className="mt-1 block text-[11px] text-muted-foreground">
                    {f.axis.id}
                  </code>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${coverageStyles[f.coverage]}`}
                  >
                    {coverageLabel[f.coverage]}
                  </span>
                  {f.silentHole && (
                    <span className="mt-1.5 block text-[11px] font-semibold text-red-300">
                      SILENT HOLE — the active rules grant when this is unknown
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {f.missingPlanes.length > 0
                    ? f.missingPlanes.map(planeLabel).join(" or ")
                    : f.coverage === "answerable"
                      ? "Already declared"
                      : "No source plane — the calling app poses it, or the core derives it"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Why this and not a replay of your history: a backtest of existing exports would
        leave every dark axis absent for every row by construction, and the engine —
        deliberately quiet on those axes so a pending integration cannot block a fleet —
        would emit clean grants at scale. The grants would have come from absence of
        data, on the one product whose claim is that it refuses to convert silence into
        a pass. This report says the same thing without the lie: here is what your
        systems can and cannot tell us, and here is the question each missing one would
        have answered.
      </p>
    </div>
  );
}
