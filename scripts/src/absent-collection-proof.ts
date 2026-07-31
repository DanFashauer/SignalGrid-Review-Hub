// Proof: an empty collection is not evidence of a good result.
//
// This is the law three separate LIVE lanes arrived at independently, each from a
// different vendor, which is why it is worth pinning as one rule rather than four
// fixes:
//
//   proof:live-edr      Wazuh reports no `realtimeProtection` field at all. Absent
//                       must normalize to "not protected", never to protected.
//   proof:live-fleet    Fleet returns '' for a policy a host has not answered, and
//                       an empty policy list for a host it knows nothing about.
//                       Neither may count as `pass`.
//   proof:live-location Traccar returns `geofenceIds: null` both for "outside every
//                       geofence" and for "no geofence linked" — the same value for
//                       an observation and for its absence.
//
// One sentence covers all three: NOTHING OBSERVED IS NOT THE SAME AS NOTHING WRONG.
// A device missing from a result is not a device without problems; a check that did
// not run is not a check that passed.
//
// The strong form of the rule is about WHERE the caution comes from. It is not
// enough for a conservative answer to be *available* — it must be DERIVED FROM THE
// DATA, not contingent on a caller remembering an out-of-band flag. A safety
// property that depends on being asked for politely is not a safety property.
//
// This proof asserts the rule at every place in the repo that grades a collection,
// and records the ONE site that resolves the ambiguity optimistically, so the
// inconsistency is stated rather than left to be rediscovered by a fourth vendor.
//
// Pure and offline: these are all pure functions.

import { evaluateVulnPosture } from "@workspace/integrations/vuln-scan";
import { evaluateThreatPosture, normalizeEndpoint } from "@workspace/integrations/edr-threat";
import { evaluateIdentityPasskeys } from "@workspace/integrations/passkey-assurance";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

// ── 1. passkey-assurance: an empty credential set ────────────────────────────
// Derives its caution from the data — `reports.length > 0 && …` — so no caller
// can forget to ask for it.
const noPasskeys = evaluateIdentityPasskeys([], {});
check(
  "passkey-assurance: an empty credential set is NOT_COVERED, never confirmed",
  noPasskeys.reasonCode === "NOT_COVERED" && noPasskeys.identityConfirmed === false,
  `${noPasskeys.reasonCode}/${String(noPasskeys.identityConfirmed)}`,
);
check(
  "…and it raises step_up rather than allowing",
  noPasskeys.recommendedAction === "step_up",
  noPasskeys.recommendedAction,
);

// ── 2. edr-threat: an endpoint with nothing observed ─────────────────────────
// No `reporting: false` is passed here on purpose: the conservative verdict must
// come from the endpoint's own fields, not from the caller's courtesy.
const bareEndpoint = normalizeEndpoint({ deviceId: "d1", source: "proof" });
const bareVerdict = evaluateThreatPosture(bareEndpoint, {});
check(
  "edr-threat: an endpoint with nothing observed is unprotected, not clean",
  bareVerdict.posture === "unprotected" && bareVerdict.reasonCode === "AGENT_ABSENT",
  `${bareVerdict.posture}/${bareVerdict.reasonCode}`,
);
check(
  "…and it alerts WITHOUT being told the source was not reporting",
  bareVerdict.recommendedAction === "alert",
  bareVerdict.recommendedAction,
);
check(
  "…and unobserved protection is never graded healthy",
  bareVerdict.protectionHealthy === false,
);

// ── 3. vuln-scan: THE ONE THAT RESOLVES THE AMBIGUITY OPTIMISTICALLY ─────────
// `[]` genuinely is ambiguous — a scanned device with zero findings is legitimately
// clean — which is exactly why `scanned` exists. The issue is which way the DEFAULT
// falls. Every sibling above derives caution from the data; this one grades an
// empty set as clean unless the caller remembers `scanned: false`.
//
// So the failure mode is a caller who fetches findings, gets `[]` from a truncated
// page / an errored request / a device with no scan record, and forwards it without
// the flag: the device is reported CLEAN with recommendedAction "none".
//
// This is pinned as the CURRENT behaviour, not endorsed. Changing it is an API
// change across every caller and is recorded in docs/BUILD_BACKLOG.md as an owner
// decision. Pinned so it cannot drift further and so the inconsistency stays
// visible — if it is ever fixed, this assertion fails and says so.
const emptyScan = evaluateVulnPosture([], {});
check(
  "vuln-scan: an empty finding set currently grades CLEAN by default (known, owner-gated)",
  emptyScan.posture === "clean" && emptyScan.reasonCode === "NO_FINDINGS",
  `${emptyScan.posture}/${emptyScan.reasonCode} — if this now fails, the default was fixed: ` +
    "update this assertion and docs/BUILD_BACKLOG.md",
);
check(
  "…and recommends no action at all, which is the part that matters",
  emptyScan.recommendedAction === "none",
  emptyScan.recommendedAction,
);
// The honest path exists and works — the gap is that it must be asked for.
const unscanned = evaluateVulnPosture([], { scanned: false });
check(
  "vuln-scan: told explicitly that no scan happened, it answers NOT_SCANNED",
  unscanned.posture === "unknown" && unscanned.reasonCode === "NOT_SCANNED",
  `${unscanned.posture}/${unscanned.reasonCode}`,
);
check(
  "…so the conservative answer is REACHABLE, just not the default",
  unscanned.recommendedAction === "monitor",
  unscanned.recommendedAction,
);

// ── 4. A real finding still drives the verdict (the rule must not be a wall) ──
// A guard that made everything unknown would satisfy every assertion above while
// destroying the connector. Prove the evaluator still grades real data.
const realFinding = evaluateVulnPosture(
  [
    {
      sourceSystem: "vuln-scan",
      deviceId: "d1",
      findingId: "CVE-2026-0001",
      severity: "critical",
      exploitAvailable: true,
      source: "proof",
    } as never,
  ],
  {},
);
check(
  "a real critical finding is still graded as such (the rule is not a wall)",
  realFinding.posture !== "clean" && realFinding.findingCount === 1,
  `${realFinding.posture}/${realFinding.reasonCode}`,
);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "Absent-collection law pinned: 3 of 4 grading paths derive caution from the data; vuln-scan's default is recorded.",
);
