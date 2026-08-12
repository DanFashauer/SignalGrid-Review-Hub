// Launch-profile proof — the declared Limited GA scope is internally coherent,
// and its figures are published so no document can quote a stale one.
//
// `scripts/check-launch-profile.mjs` already holds the profile against the
// REPOSITORY: every declared id exists, every real item is classified. That is the
// hard half. This proof covers the half a bijection cannot see — whether the
// profile is coherent WITH ITSELF, and whether the numbers it implies are
// available to the docs↔proof figure guard rather than retyped by hand.
//
// The distinction matters because of how this repo has been burned before. A count
// stated in prose goes stale silently: `WHAT_SIGNALGRID_DOES_TODAY.md` said the
// core proof made 188 assertions, was corrected to 206, and had drifted to 209 by
// the time anyone re-derived it. Correcting a number is not the fix; making it
// countable is. So the launch figures are emitted here, and `docs/LAUNCH_PROFILE.md`
// is checked against this line on every preflight run.

import type { LaunchStatus, ProfileEntry, ProfileSurface } from "../launch-profile.mjs";
import {
  SURFACES,
  STATUSES,
  GAPS,
  CRITERION,
  DEFERRED_RATIONALE,
  LAUNCH_PROFILE_VERSION,
  PRODUCT_NAME,
} from "../launch-profile.mjs";

const failures: string[] = [];
let passed = 0;
const check = (name: string, ok: boolean) => {
  if (ok) passed += 1;
  else failures.push(name);
};

type Entry = string | ProfileEntry;
const idOf = (e: Entry) => (typeof e === "string" ? e : e.id);
const reasonOf = (e: Entry) => (typeof e === "string" ? null : (e.reason ?? null));

// ── Shape ─────────────────────────────────────────────────────────────────────

// The criterion pin moved with the v3 amendment (owner-directed source-agnostic
// redirect, 2026-08-11): the connector clause now names the evidence-source
// ROLE — open-source lab first, Entra/Intune as the first enterprise production
// connector. Both halves are pinned so neither the lab-first framing nor the
// Microsoft commercial target can silently drop out of the criterion.
check("the profile carries a version, a product name and the owner's criterion verbatim",
  Number.isInteger(LAUNCH_PROFILE_VERSION) &&
    LAUNCH_PROFILE_VERSION >= 3 &&
    PRODUCT_NAME.length > 0 &&
    CRITERION.includes("one read-only device-management evidence source") &&
    CRITERION.includes("open-source lab first") &&
    CRITERION.includes("Entra/Intune as the first enterprise production connector"));

check("there are exactly four statuses, and they are the ones the gate enforces",
  STATUSES.length === 4 &&
    (["launch", "deferred", "demo_only", "internal"] as LaunchStatus[]).every((s) =>
      STATUSES.includes(s)));

check("every surface declares how its real membership is derived",
  SURFACES.every((s: ProfileSurface) => typeof s.derivedFrom === "string" && s.derivedFrom.length > 20));

check("at least one surface exists and none is empty",
  SURFACES.length > 0 &&
    SURFACES.every((s: ProfileSurface) => STATUSES.reduce((n: number, st: LaunchStatus) => n + (s[st] ?? []).length, 0) > 0));

// ── Coherence ─────────────────────────────────────────────────────────────────

const counts: Record<string, number> = { launch: 0, deferred: 0, demo_only: 0, internal: 0 };
let duplicateWithinSurface = 0;
let unreasoned = 0;
let emptyId = 0;

for (const surface of SURFACES as ProfileSurface[]) {
  const seen = new Set<string>();
  for (const status of STATUSES) {
    for (const entry of (surface[status] ?? []) as Entry[]) {
      const id = idOf(entry);
      if (typeof id !== "string" || id.trim().length === 0) emptyId += 1;
      if (seen.has(id)) duplicateWithinSurface += 1;
      seen.add(id);
      counts[status] += 1;
      // `deferred` shares DEFERRED_RATIONALE by design — 134 copies of one sentence
      // would be volume, not rigor. Every other status is an arguable decision and
      // has to carry the argument next to it.
      if (status !== "deferred") {
        const r = reasonOf(entry);
        if (r === null || r.trim().length < 20) unreasoned += 1;
      }
    }
  }
}

check("no id appears twice within one surface", duplicateWithinSurface === 0);
check("no entry has an empty id", emptyId === 0);
check("every launch / demo_only / internal entry carries its own reason", unreasoned === 0);
check("the shared deferred rationale is stated once and is substantive",
  DEFERRED_RATIONALE.length > 60);

// ── The criterion is actually restrictive ─────────────────────────────────────
//
// A launch profile that classified most things as `launch` would be a scope
// document that had not made a decision. The criterion says ONE of most things, so
// the launch set must be a small minority — asserted rather than assumed, because
// this is precisely the property that erodes one merge at a time.

const total = Object.values(counts).reduce((a, b) => a + b, 0);
check("the launch set is a small minority of the classified surface",
  counts["launch"] > 0 && counts["launch"] * 4 < total);

check("something is actually deferred — a freeze that defers nothing is not a freeze",
  counts["deferred"] > counts["launch"]);

const families = SURFACES.find((s: ProfileSurface) => s.key === "connector-families");
check("the connector-families surface exists and names a launch set",
  families !== undefined && families.launch.length > 0);
check("the one read-only Entra/Intune connector is `graph`",
  families !== undefined && families.launch.some((e: ProfileEntry) => idOf(e) === "graph"));

// ── Gaps ──────────────────────────────────────────────────────────────────────
//
// GAPS are the honesty mechanism. A launch set whose unmet prerequisites live only
// in prose reads as a readiness claim, which is the exact defect class this repo
// keeps finding. They must exist, and each must say what is missing.

check("gaps are declared rather than left to prose", GAPS.length > 0);
check("every gap names what is missing, at length",
  GAPS.every((g) => typeof g.whatIsMissing === "string" && g.whatIsMissing.length > 40));
check("every gap names a surface the profile actually has",
  GAPS.every((g) => SURFACES.some((s: ProfileSurface) => s.key === g.surface)));

// This assertion USED to read: "the Entra/Intune transport gap is recorded", passing
// if that gap's text still matched /Graph transport/. It was green throughout the
// period when the Graph transport had been written — because it tested the wording,
// not the world. Two other gaps went stale under the same blind spot.
//
// So the assertion is now about the mechanism rather than the sentence: every gap
// must carry a machine-checkable closure condition, which `check-launch-profile.mjs`
// evaluates against source and FAILS on when met. A gap that cannot be shown to be
// closed is a gap nobody will ever be told to delete.
check("every gap carries a machine-checkable closure condition",
  GAPS.every((g) => Array.isArray(g.closedWhen) && g.closedWhen.length > 0));
// Read as plain records rather than through the union. `launch-profile.d.mts` is a
// hand-written declaration over a plain-JS module, so the union constrains what this
// FILE may assume and not what that file actually contains — the two can drift, and
// a structural assertion that only restates the type would be another check on a
// description. These read the real objects.
const conditions = GAPS.flatMap((g) => g.closedWhen as unknown as Record<string, unknown>[]);
check("…and each condition names a file or a directory to read, not a claim to trust",
  conditions.every((c) => typeof c.file === "string" || typeof c.dir === "string"));
check("…and states what presence or absence would close it",
  conditions.every((c) =>
    typeof c.contains === "string" || typeof c.absent === "string" || Array.isArray(c.anyFileContainsAll)));

// ── figures= — the line `scripts/check-proof-figures.mjs` reads ───────────────
//
// Derived, never restated. `docs/LAUNCH_PROFILE.md` quotes these, and the figure
// guard fails the build if the document and this run disagree.
console.log(
  `\nfigures=launchItems=${counts["launch"]},deferredItems=${counts["deferred"]},` +
    `demoOnlyItems=${counts["demo_only"]},internalItems=${counts["internal"]},` +
    `classifiedItems=${total},declaredGaps=${GAPS.length},profileSurfaces=${SURFACES.length}`,
);
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
