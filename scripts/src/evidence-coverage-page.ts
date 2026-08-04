// Browser entry for the standalone Evidence Coverage page.
//
// Bundled by `scripts/build-evidence-coverage.mjs` and inlined into
// `tools/evidence-coverage/shell.html` to produce one self-contained file that runs with
// no server and no network — the same shape as the Trusted Room Entry console.
//
// IT DIFFERS FROM ITS SIBLING IN ONE DELIBERATE WAY. `tools/room-console/shell.html`
// keeps its rendering code inside the HTML, so that code is never typechecked. This page
// puts the rendering HERE, and leaves the shell as markup + CSS. A customer-facing page
// whose only verification is "it looked right when I built it" is the failure this whole
// artifact is about.
//
// THIS FILE IS COMPILED BY ITS OWN TSCONFIG (`scripts/tsconfig.page.json`), not the
// package's, and the package's `typecheck` script runs both. The first version instead
// put `/// <reference lib="dom" />` at the top of this file — which adds the DOM libs to
// the WHOLE scripts program, 127 Node scripts included. A review demonstrated the cost:
// a Node-only sibling using undeclared `name`, `status`, `origin` and `length` went from
// four TS2304 errors to one, because DOM globals silently supplied the rest. Weakening
// every other file in the package to typecheck this one is not a trade worth making, and
// the comment that dismissed the alternative as "a second tsconfig AND a new workspace
// package" was wrong on the second half.

/// <reference lib="dom" />

import {
  buildCoverageReport,
  KNOWN_SOURCE_PLANES,
  SOURCE_PLANE_PROMPTS,
  type AxisCoverage,
  type AxisFinding,
  type SourcePlane,
} from "@workspace/flows/evidence-coverage";
// The SUBPATH, not the barrel. `@workspace/flows` re-exports ten modules and declares no
// `sideEffects: false`, so module-scope constants survive tree-shaking: the barrel import
// put 3,330 characters of REFERENCE_PROVISIONING_FLOWS — Autopilot/ADE/Zero-Touch step
// catalogs this page never mentions — into a file destined for a public marketing domain.
// A third of the payload was unrelated, and nothing would have flagged the next addition.

// The wedge the positioning docs lead with — an IdP plus an MDM. Opening with every
// plane ticked would show the flattering estate first; opening with none would open on
// an estate nobody runs. This one still leaves silent holes, which is the conversation.
const DEFAULT_PLANES: readonly SourcePlane[] = ["identity", "device_management"];

const COVERAGE_LABEL: Record<AxisCoverage, string> = {
  answerable: "answerable",
  needs_instrumentation: "dark",
  not_sourced: "not sourced",
};

const planeLabel = (plane: SourcePlane): string =>
  plane.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Silent holes first, then merely-dark, then answerable, then the axes no source plane
 * was ever expected to supply. A reader reads the top of a table; the rows they most
 * need are the ones where nothing will ever complain.
 */
const rank = (f: AxisFinding): number => {
  if (f.silentHole) return 0;
  if (f.coverage === "needs_instrumentation") return 1;
  if (f.coverage === "answerable") return 2;
  return 3;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let declared: SourcePlane[] = [...DEFAULT_PLANES];

/**
 * Build the plane toggles ONCE, then mutate them in place.
 *
 * The first version re-created every button on each press. `aria-pressed` flipped
 * correctly, but the element holding focus was destroyed mid-interaction, so
 * `document.activeElement` fell back to `<body>`: a keyboard user had to tab from the top
 * of the document again for every single plane, and the next Space press just scrolled.
 * `page.click()` cannot see that — it does not care where focus went.
 */
function buildPlanes(host: HTMLElement): void {
  for (const plane of KNOWN_SOURCE_PLANES) {
    const button = el("button", "p");
    button.type = "button";
    button.dataset.plane = plane;

    const tick = el("span", "tick", "✓");
    tick.setAttribute("aria-hidden", "true");
    button.appendChild(tick);

    const body = el("span");
    body.appendChild(el("span", "n", planeLabel(plane)));
    body.appendChild(el("span", "q", SOURCE_PLANE_PROMPTS[plane]));
    button.appendChild(body);

    button.addEventListener("click", () => {
      declared = declared.includes(plane)
        ? declared.filter((p) => p !== plane)
        : [...declared, plane];
      syncPlanes(host);
      renderReport(document.getElementById("report") as HTMLElement);
    });
    host.appendChild(button);
  }
}

/** Reflect `declared` onto the existing buttons. No node is replaced, so focus stays. */
function syncPlanes(host: HTMLElement): void {
  for (const button of Array.from(host.querySelectorAll("button.p"))) {
    const plane = (button as HTMLElement).dataset.plane as SourcePlane;
    button.setAttribute("aria-pressed", String(declared.includes(plane)));
  }
}

function stat(value: number, caption: string, detail: string, tone: string, testId: string): HTMLElement {
  const card = el("div", `stat ${tone}`);
  const n = el("div", "n", String(value));
  n.dataset.testid = testId;
  card.appendChild(n);
  card.appendChild(el("div", "cap", caption));
  card.appendChild(el("div", "d", detail));
  return card;
}

function renderReport(host: HTMLElement): void {
  const report = buildCoverageReport(declared);
  host.replaceChildren();

  // THE HEADLINE IS NOT A FOURTH BUCKET. `silentHoles` is a SUBSET of the dark axes.
  // Rendered as a peer of the three coverage buckets it produced four figures summing to
  // more than the axis total, with two of them equal — reading as disjoint groups. The
  // subset is stated as a subset, and only the partition is shown as counts.
  const headline = el("div", "headline");
  const row = el("div", "row");
  const big = el("span", "n", String(report.silentHoles));
  big.dataset.testid = "stat-silent-holes";
  row.appendChild(big);
  row.appendChild(
    el("span", "cap", `silent holes — of the ${report.needsInstrumentation} dark axes`),
  );
  headline.appendChild(row);
  headline.appendChild(
    el(
      "p",
      undefined,
      "Dark and ungraded: this estate cannot answer them, and the shipped rule set still " +
        "returns a grant when they are unknown. No operator sees a finding, and a naive " +
        "backtest reads the grant as health. Which axes those are was measured against the " +
        "real engine offline by proof:evidence-coverage — it is NOT computed on this page.",
    ),
  );
  host.appendChild(headline);

  const stats = el("div", "stats");
  stats.appendChild(
    stat(
      report.answerable,
      "answerable",
      "A declared plane supplies it. No inference — declared or nothing.",
      "ok",
      "stat-answerable",
    ),
  );
  stats.appendChild(
    stat(
      report.needsInstrumentation,
      "dark",
      "A plane could answer it; this estate does not have that plane. Includes the silent holes above.",
      "dark",
      "stat-dark",
    ),
  );
  stats.appendChild(
    stat(
      report.notSourced,
      "not sourced",
      "Posed by the calling app or derived by the core. Not a gap, and not counted as one.",
      "inert",
      "stat-not-sourced",
    ),
  );
  host.appendChild(stats);

  const denom = el(
    "p",
    "denom",
    `${report.answerable} + ${report.needsInstrumentation} + ${report.notSourced} = ` +
      `${report.totalAxes} evidence axes. Every axis is in exactly one bucket.`,
  );
  denom.dataset.testid = "coverage-denominator";
  host.appendChild(denom);

  const wrap = el("div", "tablewrap");
  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["The question it answers", "Coverage", "What would answer it"]) {
    headRow.appendChild(el("th", undefined, label));
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const f of [...report.findings].sort((a, b) => rank(a) - rank(b))) {
    const tr = el("tr");
    tr.dataset.axis = f.axis.id;
    tr.dataset.coverage = f.coverage;
    tr.dataset.silentHole = String(f.silentHole);

    const question = el("td");
    question.appendChild(el("span", undefined, f.axis.question));
    question.appendChild(el("code", "axis", f.axis.id));
    tr.appendChild(question);

    const coverage = el("td");
    coverage.appendChild(el("span", `badge b-${f.coverage}`, COVERAGE_LABEL[f.coverage]));
    if (f.silentHole) {
      coverage.appendChild(
        el("span", "holenote", "SILENT HOLE — the active rules grant when this is unknown"),
      );
    }
    tr.appendChild(coverage);

    tr.appendChild(
      el(
        "td",
        "rem",
        f.missingPlanes.length > 0
          ? f.missingPlanes.map(planeLabel).join(" or ")
          : f.coverage === "answerable"
            ? "Already declared"
            : "No source plane — the calling app poses it, or the core derives it",
      ),
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  host.appendChild(wrap);
}

function render(): void {
  const planes = document.getElementById("planes");
  const report = document.getElementById("report");
  if (!planes || !report) return;
  // The report region is wholly replaced on every toggle. Without a live region a screen
  // reader gets no signal that any number changed — the control announces itself and the
  // answer stays silent, which on THIS page is the wrong thing to be silent about.
  report.setAttribute("aria-live", "polite");
  report.setAttribute("aria-atomic", "true");
  buildPlanes(planes);
  syncPlanes(planes);
  renderReport(report);
}

render();
