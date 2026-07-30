// Response-accountability proof — OFFLINE and deterministic.
//
// Asserted, in order of how much each matters:
//   1. THE WATERMELON IS CAUGHT and outranks every green process metric around it.
//   2. THE RULE IS NARROW — open work, honest closures and unverified closures are
//      each graded differently, because collapsing them makes the dimension noise.
//   3. THE CEILING HOLDS: never restrict. Every finding is a process failure, and the
//      worker on the device did not close the ticket.
//   4. Routing is deterministic and its holes are visible.
//   5. The gate refuses, each condition isolated. No network I/O.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveAcknowledgement,
  deriveResolutionTimeliness,
  evaluateResponse,
  evaluateResponseFixture,
  resolveResponseConnector,
  routeConcern,
  RESPONSE_FIXTURES,
} from "@workspace/integrations/response-accountability";
import type {
  NormalizedResponseRecord,
  ResponseAcknowledgement,
  ResponseOwnerState,
  ResponseResolutionClaim,
} from "@workspace/integrations/response-accountability";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Response-accountability proof — green outside, red inside\n");

const healthy: NormalizedResponseRecord = {
  concernRef: "c", owningTeam: "endpoint-team", owner: "assigned",
  acknowledgement: "acknowledged_within_target", resolution: "resolved",
  underlyingConcernStillPresent: false,
  acknowledgedAfterSeconds: 60, acknowledgementTargetSeconds: 300,
  elapsedSinceRaisedSeconds: 3600, resolutionTargetSeconds: 14400, reportIntegrity: "intact",
};

// ── 1. THE WATERMELON ────────────────────────────────────────────────────────
{
  const clean = evaluateResponse(healthy);
  check("a genuinely resolved concern is clean and says VERIFIED",
    clean.recommendedAction === "none" && clean.reasonCode === "RESPONSE_VERIFIED_RESOLVED" &&
    clean.posture === "resolved_verified");

  // THE CORE CLAIM. Identical to `healthy` in EVERY process metric — owned,
  // acknowledged in 60s against a 300s target, closed as resolved — differing only in
  // that the concern is still there. Green dashboard, red reality.
  const melon = evaluateResponse({ ...healthy, underlyingConcernStillPresent: true });
  check("claimed RESOLVED while the concern is still present → alert, named as the watermelon",
    melon.recommendedAction === "alert" &&
    melon.reasonCode === "WATERMELON_CLOSED_BUT_UNRESOLVED" &&
    melon.posture === "falsely_resolved");
  check("...and it differs from the healthy record ONLY in the underlying state",
    JSON.stringify(evaluateResponse(healthy)) !== JSON.stringify(melon));

  // It must WIN over every calm signal, because a watermelon is green everywhere else
  // by construction — that is what makes it hard to see.
  const melonWithNoise = evaluateResponse({
    ...healthy, underlyingConcernStillPresent: true, acknowledgement: "acknowledged_late",
  });
  check("the watermelon outranks a merely-late acknowledgement on the same record",
    melonWithNoise.reasonCode === "WATERMELON_CLOSED_BUT_UNRESOLVED");

  // NOT a watermelon: closed WITHOUT claiming a fix. Nobody asserted the problem went
  // away, so nobody is being caught out.
  //
  // THIS ASSERTION USED TO SAY ONLY WHAT THE VERDICT IS NOT — `!== "WATERMELON_..."` —
  // and it passed for two years' worth of the wrong answer. The verdict it was actually
  // getting was RESPONSE_VERIFIED_RESOLVED / posture `resolved_verified`: "the concern is
  // confirmed gone", asserted about a record whose own fields said the concern was
  // CONFIRMED STILL THERE. The next check down, for `open`, was written positively
  // (`=== "RESPONSE_IN_PROGRESS"`); that inconsistency was the tell. A negative
  // assertion excludes one wrong answer and licenses every other one.
  {
    const closedLive = evaluateResponse({
      ...healthy, resolution: "closed_unresolved", underlyingConcernStillPresent: true,
    });
    check("closed_unresolved with the concern STILL PRESENT is monitor — closed is not resolved",
      closedLive.recommendedAction === "monitor" &&
      closedLive.reasonCode === "CLOSED_CONCERN_NOT_RESOLVED" &&
      closedLive.posture === "resolved_unverified");
    check("...and it is NOT the watermelon — nobody claimed a fix, so nobody lied",
      closedLive.reasonCode !== "WATERMELON_CLOSED_BUT_UNRESOLVED" &&
      closedLive.recommendedAction !== "alert");
    check("closed_unresolved with nobody re-checking grades the same — absence is not a fix",
      evaluateResponse({ ...healthy, resolution: "closed_unresolved", underlyingConcernStillPresent: null })
        .reasonCode === "CLOSED_CONCERN_NOT_RESOLVED");
    // NON-VACUITY: closed_unresolved must still be able to come out clean, or the fix is
    // just "always complain about closed_unresolved".
    check("closed_unresolved with the concern CONFIRMED GONE is clean and says VERIFIED",
      evaluateResponse({ ...healthy, resolution: "closed_unresolved", underlyingConcernStillPresent: false })
        .reasonCode === "RESPONSE_VERIFIED_RESOLVED");
  }

  // THE STRUCTURAL GUARANTEE, asserted directly rather than inferred from the cases
  // above: the affirmative verdict is the fold's SEED, so it is what the evaluator says
  // when nothing fires — and "nothing fired" is not evidence a concern was fixed. Every
  // resolution value, present and future, must fail to earn it without a positive check.
  for (const resolution of ["resolved", "closed_unresolved", "open", "unknown"] as const) {
    for (const present of [true, null] as const) {
      const v = evaluateResponse({ ...healthy, resolution, underlyingConcernStillPresent: present });
      check(`VERIFIED_RESOLVED is unreachable without a positive check (${resolution}/${present})`,
        v.reasonCode !== "RESPONSE_VERIFIED_RESOLVED" && v.posture !== "resolved_verified");
    }
  }
  // NOT a watermelon: still open. Open work is work.
  check("an OPEN concern with the problem still present is in_progress, not a watermelon",
    evaluateResponse({ ...healthy, resolution: "open", underlyingConcernStillPresent: true })
      .reasonCode === "RESPONSE_IN_PROGRESS");

  // Unverified closure: the state a watermelon hides in. Distinct from both.
  const unverified = evaluateResponse({ ...healthy, underlyingConcernStillPresent: null });
  check("resolved but NEVER RE-CHECKED is its own state — monitor, not clean, not alert",
    unverified.recommendedAction === "monitor" && unverified.reasonCode === "RESOLUTION_UNVERIFIED" &&
    unverified.posture === "resolved_unverified");
  check("...and null is never read as 'the concern is gone'",
    evaluateResponse({ ...healthy, underlyingConcernStillPresent: null }).recommendedAction !== "none");
}

// ── 2. Process failures, each distinct ───────────────────────────────────────
{
  check("an unowned concern steps up — a queue is not an owner",
    evaluateResponse({ ...healthy, owner: "unassigned", owningTeam: null, resolution: "open" })
      .reasonCode === "RESPONSE_UNOWNED");
  check("assigned but with NO routed team is reported separately — a routing-table hole",
    evaluateResponse({ ...healthy, owningTeam: null, resolution: "open" })
      .reasonCode === "OWNER_UNROUTED");
  check("unacknowledged steps up; late only monitors — an absent team differs from a slow one",
    evaluateResponse({ ...healthy, acknowledgement: "unacknowledged", resolution: "open" }).recommendedAction === "step_up" &&
    evaluateResponse({ ...healthy, acknowledgement: "acknowledged_late", resolution: "open" }).recommendedAction === "monitor");
  check("an isolated UNKNOWN forecloses and is INDETERMINATE, not an affirmative failure",
    (["owner", "acknowledgement", "resolution"] as const).every((f) => {
      const r = evaluateResponse({ ...healthy, [f]: "unknown" });
      return r.recommendedAction === "step_up" && r.posture === "indeterminate";
    }));
  check("...and each unknown names a DISTINCT field",
    new Set((["owner", "acknowledgement", "resolution"] as const).map(
      (f) => evaluateResponse({ ...healthy, [f]: "unknown" }).reasonCode)).size === 3);
  check("a malformed report short-circuits to its own code",
    evaluateResponse({ ...healthy, reportIntegrity: "malformed" }).reasonCode === "RESPONSE_REPORT_MALFORMED");
  check("the verdict carries the notify team and the concern ref, so routing needs no second lookup",
    evaluateResponse(healthy).notifyTeam === "endpoint-team" && evaluateResponse(healthy).concernRef === "c");
}

// ── 2b. RESOLUTION TIMING — SLA achievement, time-to-restore, backlog aging ──
//
// One elapsed field, one caller-supplied target, read differently depending on whether
// the work is finished. These are the only three measures from the ITSM KPI set this
// dimension can carry honestly; the rest are rates and means over a corpus of tickets
// the fabric does not hold, and computing those would need a clock it must not read.
{
  const late = { elapsedSinceRaisedSeconds: 172800, resolutionTargetSeconds: 14400 };

  check("CLOSED past the committed target is a missed resolution target — monitor, not alert",
    (() => {
      const v = evaluateResponse({ ...healthy, ...late });
      return v.recommendedAction === "monitor" && v.reasonCode === "RESOLUTION_TARGET_MISSED";
    })());
  check("...and a SLOW fix is never graded as a FALSE one — the watermelon's alert is not reused",
    evaluateResponse({ ...healthy, ...late }).recommendedAction !== "alert");
  check("OPEN past the same target is backlog aging — the same number, a different remedy",
    (() => {
      const v = evaluateResponse({ ...healthy, ...late, resolution: "open", underlyingConcernStillPresent: true });
      return v.recommendedAction === "monitor" && v.reasonCode === "BACKLOG_AGED_BEYOND_LIMIT";
    })());
  check("closed_unresolved past the target is ALSO a missed target — the commitment was to resolve, not to claim",
    evaluateResponse({ ...healthy, ...late, resolution: "closed_unresolved" }).reasonCode === "RESOLUTION_TARGET_MISSED");

  // NON-VACUITY: inside the target must stay clean, or the axis is "always complain".
  check("inside the committed target stays clean — the axis is not always-complain",
    evaluateResponse({ ...healthy, elapsedSinceRaisedSeconds: 3600, resolutionTargetSeconds: 14400 })
      .reasonCode === "RESPONSE_VERIFIED_RESOLVED");
  check("the boundary is INCLUSIVE, matching the acknowledgement comparison",
    deriveResolutionTimeliness(300, 300) === "within_target" &&
    deriveResolutionTimeliness(301, 300) === "breached");

  // THE THREE ABSENCES, KEPT APART. Same principle that separates acknowledged_ungraded
  // from unknown: a missing policy, a missing measurement and a broken number are
  // different facts, and collapsing them lets the worst wear the face of the mildest.
  check("NO TARGET is ungraded — and, unlike the acknowledgement axis, raises nothing",
    deriveResolutionTimeliness(172800, null) === "ungraded" &&
    evaluateResponse({ ...healthy, elapsedSinceRaisedSeconds: 172800, resolutionTargetSeconds: null })
      .reasonCode === "RESPONSE_VERIFIED_RESOLVED");
  check("NO ELAPSED is unmeasured — the clock is missing, not the policy",
    deriveResolutionTimeliness(null, 14400) === "unmeasured");
  check("...and unmeasured is NOT ungraded — the two absences stay distinct",
    deriveResolutionTimeliness(null, 14400) !== deriveResolutionTimeliness(3600, null));
  check("a NEGATIVE or FRACTIONAL duration is unknown, never a met target",
    deriveResolutionTimeliness(-1, 14400) === "unknown" &&
    deriveResolutionTimeliness(1.5, 14400) === "unknown" &&
    deriveResolutionTimeliness(3600, -1) === "unknown");
  check("...and an unreadable clock is REPORTED rather than skipped — it is not a pass",
    evaluateResponse({ ...healthy, elapsedSinceRaisedSeconds: -1, resolutionTargetSeconds: 14400 })
      .reasonCode === "RESOLUTION_TIMING_UNREADABLE");

  // A record can be late AND lying. The watermelon must still win, because it is the
  // finding that says someone asserted something false.
  check("a watermelon that ALSO blew its SLA is still reported as the watermelon",
    evaluateResponse({ ...healthy, ...late, underlyingConcernStillPresent: true })
      .reasonCode === "WATERMELON_CLOSED_BUT_UNRESOLVED");

  // The two new fixtures exist so the axis is demonstrated on the shipped corpus, not
  // only on records this proof invented for itself.
  check("the shipped fixtures demonstrate both new findings",
    evaluateResponseFixture("resolution-target-missed")?.reasonCode === "RESOLUTION_TARGET_MISSED" &&
    evaluateResponseFixture("backlog-aged")?.reasonCode === "BACKLOG_AGED_BEYOND_LIMIT");
}

// ── 3. THE CEILING — never restrict, never escalate ──────────────────────────
{
  const OWNERS: ResponseOwnerState[] = ["assigned", "unassigned", "unknown"];
  const ACKS: ResponseAcknowledgement[] =
    ["acknowledged_within_target", "acknowledged_late", "acknowledged_ungraded", "unacknowledged", "unknown"];
  const RESOLUTIONS: ResponseResolutionClaim[] = ["resolved", "closed_unresolved", "open", "unknown"];
  const PRESENT: (boolean | null)[] = [true, false, null];
  const TEAMS: (string | null)[] = ["endpoint-team", null];
  const INTEGRITIES = ["intact", "malformed"] as const;
  // The resolution-timing axis, expressed as the (elapsed, target) PAIRS that reach
  // each of the five ResponseTimeliness states — swept as INPUTS rather than as the
  // derived state, so the derivation is under test rather than assumed.
  const TIMINGS: Array<readonly [number | null, number | null, string]> = [
    [3600, 14400, "within_target"],
    [172800, 14400, "breached"],
    [3600, null, "ungraded"],
    [null, 14400, "unmeasured"],
    [-1, 14400, "unknown"],
  ];

  let total = 0, clean = 0, overCeiling = 0, watermelons = 0;
  const unjustified: string[] = [];
  for (const owner of OWNERS)
    for (const acknowledgement of ACKS)
      for (const resolution of RESOLUTIONS)
        for (const underlyingConcernStillPresent of PRESENT)
          for (const owningTeam of TEAMS)
            for (const reportIntegrity of INTEGRITIES)
              for (const [elapsedSinceRaisedSeconds, resolutionTargetSeconds, timing] of TIMINGS) {
              total += 1;
              const r = evaluateResponse({
                ...healthy, owner, acknowledgement, resolution,
                underlyingConcernStillPresent, owningTeam, reportIntegrity,
                elapsedSinceRaisedSeconds, resolutionTargetSeconds,
              });
              const a = r.recommendedAction as string;
              if (a === "restrict" || a === "escalate") overCeiling += 1;
              if (r.reasonCode === "WATERMELON_CLOSED_BUT_UNRESOLVED") watermelons += 1;
              if (a !== "none") continue;
              clean += 1;
              // A clean verdict requires the response to have positively worked:
              // owned by a named team, acknowledged in time, and either verified gone
              // or legitimately still open.
              // THIS ORACLE WAS THE BUG. It read:
              //
              //   ... || resolution === "open" || resolution === "closed_unresolved");
              //
              // — blessing `closed_unresolved` UNCONDITIONALLY, whatever the underlying
              // state. So a record closed with no fix claim while the concern was
              // CONFIRMED still present counted as a justified clean verdict, and the
              // check named "ZERO unjustified clean verdicts" passed on it. The
              // implementation asserted `resolved_verified` and the oracle agreed,
              // because the oracle shared the implementation's mistake. An assertion is
              // only as good as the belief behind it; a 576-state sweep tests breadth,
              // not whether the thing it is comparing against is right.
              //
              // Restated so it turns on the EVIDENCE rather than on the claim's label:
              // a clean verdict is justified only if the concern was positively checked
              // and found gone, or the work is legitimately still open.
              const justified =
                reportIntegrity === "intact" && owner === "assigned" && owningTeam !== null &&
                acknowledgement === "acknowledged_within_target" &&
                (underlyingConcernStillPresent === false || resolution === "open") &&
                // ...and the resolution clock must not be BREACHED or UNREADABLE. A
                // record past its committed target, or carrying a duration nobody can
                // read, has not "positively worked" however green the rest of it looks.
                (timing === "within_target" || timing === "ungraded" || timing === "unmeasured");
              if (!justified) {
                unjustified.push(`${owner}/${acknowledgement}/${resolution}/${underlyingConcernStillPresent}/${owningTeam}/${reportIntegrity}`);
              }
            }

  // 3,600 = 720 x 5. The resolution-timing axis contributes its five states, and the
  // 720 was itself 576 widened by `acknowledged_ungraded`. Both growths are the CONTRACT
  // growing: a new epistemic state exists that did not before, and a sweep that did not
  // see it would leave the widening untested.
  check(`state space enumerated (${total} states)`, total === 3600);
  check("NEVER restricts or escalates — a badly-closed ticket must not interrupt a worker's shift",
    overCeiling === 0);
  check(`ZERO unjustified clean verdicts` +
    (unjustified.length ? ` — leaked: ${unjustified.slice(0, 4).join(", ")}` : ""),
    unjustified.length === 0);
  // Non-vacuity in BOTH directions: the clean path must be reachable, and so must the
  // watermelon — a detector that never fires is indistinguishable from a broken one.
  //
  // BOTH FIGURES ARE DERIVED, not observed. I first pinned them at 12 and 12 by
  // guesswork and the proof rejected both, which is the point of pinning an exact
  // count rather than a floor: a number you cannot derive is a number you have not
  // checked.
  //
  // CLEAN = 5, WAS 7 — and the two that left were the defect, not a tightening.
  //
  // A clean verdict pushes no candidate at all, which forces owner=assigned (1),
  // owningTeam≠null (1 of 2), ack=within_target (1 of 4) and integrity=intact (1 of 2).
  // That leaves resolution × present:
  //   resolved            → only present=false clears (true is the watermelon,
  //                         null is RESOLUTION_UNVERIFIED)                      = 1
  //   closed_unresolved   → only present=false clears. WAS 3, on the reasoning
  //                         "no claim was made, so present is free" — which was
  //                         wrong: no claim was made about the FIX, but the verdict
  //                         still asserted `resolved_verified`, and that IS a claim.
  //                         present=true and present=null now grade
  //                         CLOSED_CONCERN_NOT_RESOLVED at monitor.              = 1
  //   open                → in_progress, present genuinely is free               = 3
  //                                                                        total = 5
  // CLEAN = 15 = 5 x 3. The five above, crossed with the three timing states that push
  // no candidate — within_target, ungraded, unmeasured. `breached` and `unknown` each
  // add a monitor, so neither can appear in a clean verdict.
  check(`...and the clean path is REACHABLE — exactly 15 states (got ${clean})`, clean === 15);
  // WATERMELON = 30, WAS 24. resolution=resolved AND present=true AND integrity=intact,
  // with owner (3) × ack (5) × owningTeam (2) all free — because a false closure
  // outranks every other finding on the record, which is exactly the behaviour worth
  // pinning: a watermelon is green on every other axis by construction, and must still
  // win. The +6 is the new `acknowledged_ungraded` crossed with owner × owningTeam
  // (3 × 2), i.e. the detector's REACH GREW with the state space rather than shrinking
  // — which is the direction that matters. A count that fell here would mean the new
  // state had started shadowing the finding.
  // 150 = 30 x 5: timing is FREE, because `alert` outranks every monitor the timing
  // axis can raise. That is the property worth pinning — a watermelon on a record that
  // also blew its resolution SLA must still be reported as the watermelon, not
  // downgraded to a missed target.
  check(`...and the WATERMELON path is reachable — exactly 150 states (got ${watermelons})`, watermelons === 150);
}

// ── 4. Timeliness, from caller-supplied durations only ───────────────────────
{
  check("inside the target is within_target; outside is late; the boundary is inclusive",
    deriveAcknowledgement(120, 300) === "acknowledged_within_target" &&
    deriveAcknowledgement(301, 300) === "acknowledged_late" &&
    deriveAcknowledgement(300, 300) === "acknowledged_within_target");
  check("no acknowledgement at all is unacknowledged, not 'fast'",
    deriveAcknowledgement(null, 300) === "unacknowledged");
  // THE NAME OF THIS CHECK WAS ALWAYS RIGHT; ITS ASSERTION WAS NOT.
  //
  // It read `=== "acknowledged_within_target"` — the value meaning "graded, and it
  // passed" — under a name promising the opposite. So an acknowledgement 27 hours late
  // with no target graded identically to one answered inside a five-minute window, and
  // the check that should have caught it was the thing pinning it in place.
  //
  // A test name is documentation; the assertion is the contract. When they disagree,
  // the assertion wins silently — which is how a proof ends up defending a defect.
  check("NO TARGET means timeliness is not graded — and the STATE says so, rather than claiming a pass",
    deriveAcknowledgement(99999, null) === "acknowledged_ungraded");
  check("...and a fast acknowledgement with no target is graded the SAME — the absence of policy is the finding, not the speed",
    deriveAcknowledgement(1, null) === "acknowledged_ungraded");
  check("...while a target that IS supplied still grades normally — the rule is not 'never grade'",
    deriveAcknowledgement(1, 300) === "acknowledged_within_target" &&
    deriveAcknowledgement(9999, 300) === "acknowledged_late");
  // A broken duration must not compare as prompt.
  check("a negative or fractional duration is unknown, NOT a fast acknowledgement",
    deriveAcknowledgement(-1, 300) === "unknown" && deriveAcknowledgement(1.5, 300) === "unknown");
  check("a broken TARGET is unknown too, rather than silently ignored",
    deriveAcknowledgement(120, -5) === "unknown");
}

// ── 5. Routing — deterministic, longest match, holes visible ─────────────────
{
  const policy = {
    routes: { "DEVICE_": "endpoint-team", "DEVICE_NOT_ENROLLED": "onboarding", "SEGMENT_": "network-team" },
    fallbackTeam: "soc",
  };
  check("longest match wins, so a specific code overrides its family prefix",
    routeConcern("DEVICE_NOT_ENROLLED", policy) === "onboarding" &&
    routeConcern("DEVICE_UNSUPERVISED", policy) === "endpoint-team");
  check("...and it is ORDER-INDEPENDENT — reversing the table changes nothing",
    routeConcern("DEVICE_NOT_ENROLLED", {
      routes: { "DEVICE_NOT_ENROLLED": "onboarding", "DEVICE_": "endpoint-team" }, fallbackTeam: "soc",
    }) === "onboarding");
  check("a different family routes elsewhere", routeConcern("SEGMENT_RESTRICTED", policy) === "network-team");
  check("an unmatched code falls back", routeConcern("SOMETHING_ELSE", policy) === "soc");
  check("with NO fallback an unmatched code returns null — the hole is visible, not silently queued",
    routeConcern("SOMETHING_ELSE", { routes: { "DEVICE_": "endpoint-team" } }) === null);
}

// ── 6. Fixtures, the gate, and no network I/O ────────────────────────────────
{
  const expect: Record<string, string> = {
    "verified-resolved": "none", watermelon: "alert", "resolved-unverified": "monitor",
    unowned: "step_up", "acknowledged-late": "monitor", "in-progress": "none", unreadable: "step_up",
  };
  check(`every fixture grades as its name claims (${Object.keys(expect).length} fixtures)`,
    Object.entries(expect).every(([n, a]) => evaluateResponseFixture(n)?.recommendedAction === a));
  check("an unknown fixture is null — including a PROTOTYPE key, which once granted elsewhere",
    evaluateResponseFixture("nope") === null && evaluateResponseFixture("constructor") === null &&
    evaluateResponseFixture("valueOf") === null);
  check("the fixture corpus covers every posture this dimension can report",
    new Set(Object.keys(RESPONSE_FIXTURES).map((n) => evaluateResponseFixture(n)!.posture)).size === 6);
  check("no fixture carries a wall-clock timestamp — ages are caller-supplied durations",
    Object.values(RESPONSE_FIXTURES).every(
      (f) => f.acknowledgedAfterSeconds === null || Number.isInteger(f.acknowledgedAfterSeconds)));

  const T = { readResponseRecord: async () => ({}) };
  const FULL = {
    SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true",
    RESPONSE_SYSTEM: "servicenow", RESPONSE_ACCESS_TOKEN: "t",
  };
  check("default env (dev tier) refuses live", resolveResponseConnector({}, T).mode === "fixture");
  check("ISOLATED: tier alone blocks live",
    resolveResponseConnector({ ...FULL, SIGNALGRID_TIER: "dev" }, T).mode === "fixture");
  check("ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
    resolveResponseConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T).mode === "fixture");
  check("ISOLATED: an unrecognised system alone blocks live",
    resolveResponseConnector({ ...FULL, RESPONSE_SYSTEM: "nope" }, T).mode === "fixture");
  check("ISOLATED: a missing credential alone blocks live",
    resolveResponseConnector({ ...FULL, RESPONSE_ACCESS_TOKEN: "" }, T).mode === "fixture");
  check("no transport refuses even with every gate satisfied — this repo ships none",
    resolveResponseConnector(FULL).mode === "fixture");
  check("...and the live branch IS reachable when a transport is injected",
    resolveResponseConnector(FULL, T).mode === "live");

  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "../../lib/integrations/src/integrations/response-accountability");
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []);
  const files = walk(dir);
  const banned = [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    /\brequire\s*\(\s*['"](?:axios|got|undici|node-fetch|ioredis|redis)['"]/i,
    /\bimport\s*\(\s*['"](?:axios|got|undici|node-fetch|ioredis|redis)['"]/i,
    /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
    /\bhttps?\.(?:request|get)\s*\(/i,
    /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
  ];
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (banned.some((re) => re.test(line))) offenders.push(`${f.slice(dir.length + 1)}:${i + 1}`);
    });
  }
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  check(`no vendor-API call in any response-accountability source (${files.length} files, recursive)`,
    offenders.length === 0);
  check("...and the scan can actually fire — it detects a planted call",
    banned.some((re) => re.test('await fetch("https://x", { method: "POST" })')));
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
