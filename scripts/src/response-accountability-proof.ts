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
  acknowledgedAfterSeconds: 60, acknowledgementTargetSeconds: 300, reportIntegrity: "intact",
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

// ── 3. THE CEILING — never restrict, never escalate ──────────────────────────
{
  const OWNERS: ResponseOwnerState[] = ["assigned", "unassigned", "unknown"];
  const ACKS: ResponseAcknowledgement[] =
    ["acknowledged_within_target", "acknowledged_late", "unacknowledged", "unknown"];
  const RESOLUTIONS: ResponseResolutionClaim[] = ["resolved", "closed_unresolved", "open", "unknown"];
  const PRESENT: (boolean | null)[] = [true, false, null];
  const TEAMS: (string | null)[] = ["endpoint-team", null];
  const INTEGRITIES = ["intact", "malformed"] as const;

  let total = 0, clean = 0, overCeiling = 0, watermelons = 0;
  const unjustified: string[] = [];
  for (const owner of OWNERS)
    for (const acknowledgement of ACKS)
      for (const resolution of RESOLUTIONS)
        for (const underlyingConcernStillPresent of PRESENT)
          for (const owningTeam of TEAMS)
            for (const reportIntegrity of INTEGRITIES) {
              total += 1;
              const r = evaluateResponse({
                ...healthy, owner, acknowledgement, resolution,
                underlyingConcernStillPresent, owningTeam, reportIntegrity,
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
                (underlyingConcernStillPresent === false || resolution === "open");
              if (!justified) {
                unjustified.push(`${owner}/${acknowledgement}/${resolution}/${underlyingConcernStillPresent}/${owningTeam}/${reportIntegrity}`);
              }
            }

  check(`state space enumerated (${total} states)`, total === 576);
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
  check(`...and the clean path is REACHABLE — exactly 5 states (got ${clean})`, clean === 5);
  // WATERMELON = 24. resolution=resolved AND present=true AND integrity=intact, with
  // owner (3) × ack (4) × owningTeam (2) all free — because a false closure outranks
  // every other finding on the record, which is exactly the behaviour worth pinning:
  // a watermelon is green on every other axis by construction, and must still win.
  check(`...and the WATERMELON path is reachable — exactly 24 states (got ${watermelons})`, watermelons === 24);
}

// ── 4. Timeliness, from caller-supplied durations only ───────────────────────
{
  check("inside the target is within_target; outside is late; the boundary is inclusive",
    deriveAcknowledgement(120, 300) === "acknowledged_within_target" &&
    deriveAcknowledgement(301, 300) === "acknowledged_late" &&
    deriveAcknowledgement(300, 300) === "acknowledged_within_target");
  check("no acknowledgement at all is unacknowledged, not 'fast'",
    deriveAcknowledgement(null, 300) === "unacknowledged");
  check("NO TARGET means timeliness is not graded — no threshold is invented here",
    deriveAcknowledgement(99999, null) === "acknowledged_within_target");
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
