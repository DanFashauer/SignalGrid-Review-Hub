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
// This proof asserts the rule at every place in the repo that grades a collection.
// It began by RECORDING the sites that resolved the ambiguity optimistically —
// pinning behaviour it did not endorse, so the inconsistency was stated rather than
// left to be rediscovered by a fourth vendor. Every one of those has since been
// fixed, and each fix announced itself by failing an assertion here first. The
// pins now hold the corrected behaviour in both directions: absence raises caution,
// and an observed-empty result is still allowed to be good news.
//
// Pure and offline: these are all pure functions.

import { evaluateVulnPosture } from "@workspace/integrations/vuln-scan";
import { evaluateThreatPosture, normalizeEndpoint } from "@workspace/integrations/edr-threat";
import { evaluateIdentityPasskeys } from "@workspace/integrations/passkey-assurance";
import * as identityRisk from "@workspace/integrations/identity-risk";
import * as peripheral from "@workspace/integrations/peripheral-control";
import * as credential from "@workspace/integrations/credential-exposure";
import { composeDeviceRisk, fromThreat } from "@workspace/posture-composition";
import { evaluateReachability, normalizeSession } from "@workspace/integrations/carrier";

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

// ── 3. vuln-scan: the last site that resolved the ambiguity optimistically ───
// `[]` genuinely is ambiguous — a scanned device with zero findings is legitimately
// clean — which is exactly why `scanned` exists. The question was which way the
// DEFAULT fell, and it fell optimistically: an empty set graded clean unless the
// caller remembered `scanned: false`, so `[]` from an errored request or a device
// with no scan record was reported CLEAN with action `none`.
//
// FIXED BY DERIVING IT: `options.scanned ?? findings.length > 0`. A non-empty set is
// its own evidence that a scan ran, so real findings need no flag at all; the empty
// set — the only genuinely ambiguous case — now fails closed to NOT_SCANNED, and a
// caller that knows a scan happened says so. That is the strong form of this file's
// own rule: caution derived from the data, not contingent on remembering an
// out-of-band argument.
//
// No legitimate caller broke, which is itself evidence the default was wrong: every
// one already passes real findings or states `scanned: true`. The single exception
// was proof:vuln-scan's per-device loop, where filtering to a slice discards the
// fixture's scan record — it now states it, which is the caller doing its job.
const emptyScan = evaluateVulnPosture([], {});
check(
  "vuln-scan: an empty finding set with no flag is NOT_SCANNED, not clean",
  emptyScan.posture === "unknown" && emptyScan.reasonCode === "NOT_SCANNED",
  `${emptyScan.posture}/${emptyScan.reasonCode}`,
);
check(
  "…and it raises monitor rather than recommending no action",
  emptyScan.recommendedAction === "monitor",
  emptyScan.recommendedAction,
);
// The flag is still honoured in the direction that needs it: a caller who KNOWS a
// scan ran and found nothing can say so, and gets a clean verdict.
const scannedClean = evaluateVulnPosture([], { scanned: true });
check(
  "…while a caller that asserts a scan DID run still gets clean/none",
  scannedClean.posture === "clean" && scannedClean.recommendedAction === "none",
  `${scannedClean.posture}/${scannedClean.recommendedAction}`,
);
// And the ambiguous case is the ONLY one that needs the flag — a non-empty set is
// its own evidence that a scan happened, so real findings need no ceremony.
const derived = evaluateVulnPosture(
  [{ sourceSystem: "vuln-scan", deviceId: "d1", findingId: "CVE-2026-0002", severity: "high", exploitAvailable: false, source: "proof" } as never],
  {},
);
check(
  "…and a non-empty set is self-evidence of a scan — graded without any flag",
  derived.posture !== "unknown" && derived.reasonCode !== "NOT_SCANNED",
  `${derived.posture}/${derived.reasonCode}`,
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

// ── 5. THE SYSTEMIC ONE, NOW FIXED: `X ?? []` used to erase "never looked" ───
// Five connectors normalized a MISSING collection into an EMPTY one
// (`(raw.threats ?? []).map(...)` and siblings). After that line a source that
// could not report and a source that reported nothing were byte-identical, and
// every evaluator read the empty set as good news with action "none":
//
//   edr-threat          protected      / NO_THREATS_HEALTHY / none   <- was
//   identity-risk       trusted        / NO_RISK            / none   <- was
//   peripheral-control  no_removable   / NO_REMOVABLE       / none   <- was
//   credential-exposure clean          / NO_FINDINGS        / none   <- was
//   vuln-scan           clean          / NO_FINDINGS        / none   <- was (section 3)
//
// This is not hypothetical. proof:live-edr MEASURED that Wazuh's alerts live in a
// separate indexer, so "reports protection health, cannot report detections" is
// the real shape of the one live EDR this repo has been pointed at. Wazuh escapes
// today only because it also cannot report realtimeProtection or signatureAgeHours,
// which independently force degraded_protection. A vendor that reports protection
// health but not detections lands on `protected` / action none.
//
// It also COMPOUNDS the capped-read defect that check-pagination-truncation.mjs
// guards: a truncated page returns fewer items, and fewer items read as cleaner.
// A read that never happened and a read that found nothing must not be the same
// value — that is the whole law, and here it is violated by a single `?? []`.
//
// FIXED. Each of those five now carries the distinction: the normalized collection
// is `null` when the source never reported it and `[]` when it reported none, and
// each evaluator contributes an "unobserved" candidate that raises `monitor`
// instead of leaving the `none` default to win. The table above is what these
// assertions USED to pin; they now pin the opposite, and the two states must stay
// distinguishable.
//
// The mechanism worked exactly as designed on the way through: the moment the fix
// landed, this proof failed with "the distinction was added — update
// docs/BUILD_BACKLOG.md". A pinning assertion is not a claim that the behaviour is
// right; it is a tripwire that makes changing it deliberate.
const healthyNoThreatFeed = normalizeEndpoint({
  deviceId: "d1",
  agentInstalled: true,
  agentRunning: true,
  realtimeProtection: true,
  signatureAgeHours: 1,
  source: "vendor-without-threat-feed",
  // threats: NOT SUPPLIED — the vendor has no detection endpoint here
});
const noFeedVerdict = evaluateThreatPosture(healthyNoThreatFeed, {});
const explicitZero = evaluateThreatPosture(
  normalizeEndpoint({
    deviceId: "d2",
    agentInstalled: true,
    agentRunning: true,
    realtimeProtection: true,
    signatureAgeHours: 1,
    threats: [],
    source: "vendor-with-threat-feed",
  }),
  {},
);
check(
  "edr-threat: an unreported threat feed is NOT graded protected",
  noFeedVerdict.posture !== "protected" && noFeedVerdict.reasonCode === "THREAT_FEED_UNOBSERVED",
  `${noFeedVerdict.posture}/${noFeedVerdict.reasonCode}`,
);
check(
  "…and it raises `monitor` — a blind spot to investigate, never action `none`",
  noFeedVerdict.recommendedAction === "monitor",
  noFeedVerdict.recommendedAction,
);
check(
  "…and it is DISTINGUISHABLE from a vendor that actually scanned and found nothing",
  JSON.stringify(noFeedVerdict) !== JSON.stringify(explicitZero),
);
check(
  "…while a vendor that DID scan and found nothing is still graded clean (not a wall)",
  explicitZero.posture === "protected" && explicitZero.recommendedAction === "none",
  `${explicitZero.posture}/${explicitZero.recommendedAction}`,
);

// The same law at the other four sites. Asserted on the ACTION rather than the
// posture name, because that is what a caller acts on and it is the part that was
// wrong: every one of these used to recommend doing nothing about a device nobody
// had looked at.
for (const [label, unreported, reportedNone] of [
  [
    "identity-risk",
    identityRisk.evaluateIdentityRisk(identityRisk.normalizePrincipal({ principalId: "p", source: "s" } as never), {}),
    // riskState "none" is REPORTED on the clean side deliberately, so this row
    // isolates the DETECTIONS collection — the axis this law is about. It used to
    // omit riskState and still expect `none`, which only passed because the
    // normalizer collapsed absent state into "unknown" and the evaluator graded
    // "unknown" as trusted — the exact fail-open fixed on 2026-08-20. An empty
    // detections list is a reading; an absent risk state never was one.
    identityRisk.evaluateIdentityRisk(identityRisk.normalizePrincipal({ principalId: "p", source: "s", riskState: "none", detections: [] } as never), {}),
  ],
  [
    "peripheral-control",
    peripheral.evaluatePeripheralPosture(peripheral.normalizeDevice({ deviceId: "d", source: "s" } as never), {}),
    peripheral.evaluatePeripheralPosture(peripheral.normalizeDevice({ deviceId: "d", source: "s", peripherals: [] } as never), {}),
  ],
  [
    "credential-exposure",
    credential.evaluateCredentialExposure(credential.normalizeDevice({ deviceId: "d", source: "s" } as never), {}),
    credential.evaluateCredentialExposure(credential.normalizeDevice({ deviceId: "d", source: "s", findings: [] } as never), {}),
  ],
] as [string, { recommendedAction?: string; reasonCode?: string }, { recommendedAction?: string }][]) {
  check(
    `${label}: an unreported collection raises monitor, not "no action"`,
    unreported.recommendedAction === "monitor",
    `action=${String(unreported.recommendedAction)} reason=${String(unreported.reasonCode)}`,
  );
  check(
    `${label}: …and an explicitly EMPTY collection is still clean, action none`,
    reportedNone.recommendedAction === "none",
    `action=${String(reportedNone.recommendedAction)}`,
  );
}

// ── 6. Does any of it REACH the fabric? ──────────────────────────────────────
// Everything above is per-dimension. A verdict that never changes what the fabric
// composes is a cosmetic fix, so this asserts the whole path end to end:
// normalize → evaluate → adapter → composeDeviceRisk.
const unobservedComposed = composeDeviceRisk([fromThreat(noFeedVerdict)]);
const scannedComposed = composeDeviceRisk([fromThreat(explicitZero)]);

check(
  "an unobserved feed changes the COMPOSED action, not just the dimension verdict",
  unobservedComposed.strongestAction === "monitor" && scannedComposed.strongestAction === "none",
  `${unobservedComposed.strongestAction} vs ${scannedComposed.strongestAction}`,
);
check(
  "…and the fabric can SAY WHY — the driver names the unobserved feed",
  unobservedComposed.drivers[0]?.reason === "THREAT_FEED_UNOBSERVED",
  String(unobservedComposed.drivers[0]?.reason),
);

// RECORDED, NOT ENDORSED — and deliberately not changed here. `TIER_BY_ACTION`
// maps BOTH `none` and `monitor` to the tier `ok`, so a consumer reading only
// `riskTier` still cannot tell "verified clean" from "we never looked". The finer
// distinction is present one level down, in `strongestAction` and `drivers`.
//
// Reclassifying `monitor` to `watch` would be the obvious fix and is NOT a local
// one: it would move EVERY monitor verdict in every dimension — controlled media,
// remediated threats, NOT_REPORTING — out of `ok`. That is a decision about what
// the tier vocabulary means, not a defect in this law, so it is pinned and stated
// rather than quietly altered.
check(
  "the coarse riskTier is `ok` for both — the distinction lives in action + drivers (recorded)",
  unobservedComposed.riskTier === "ok" && scannedComposed.riskTier === "ok",
  `${unobservedComposed.riskTier}/${scannedComposed.riskTier} — if this changed, TIER_BY_ACTION was ` +
    "revisited: update this assertion and say so in docs/BUILD_BACKLOG.md",
);

// ── carrier: the site the law was WRITTEN for, and was never enrolled at ──────
//
// Intake ledger row 55. This proof pinned the law at seven sites and `carrier` was
// not one of them, so the plainest violation in the repository sat outside the gate
// that exists to catch it. The normalizer read:
//
//     const wifiOnly = !session.iccid && session.smsCapable !== true && session.dataConnected !== true;
//
// — three absences combined into the positive assertion "this device has NO cellular
// backchannel at all", which the evaluator then short-circuited on ahead of every
// other check, reporting `locatable: false`. A coverage rule that is right for what
// it covers can still leave a hole; the response is to enrol the site, not to widen
// a rule until it fits.
//
// The deeper reason this one could never be fixed by adding a fourth condition: a
// carrier API cannot prove the absence of a radio. It reports SIMs on the account it
// was asked about, and silence there covers a partial read, a paginated tail, an
// eSIM on another operator's platform, and a PRIVATE 5G attachment it has never
// heard of. So the axis is POSED from the device-inventory plane, and the caution is
// still derived rather than requested: omitting it yields `unknown`, which forecloses.
{
  const SILENT = { deviceId: "d", sessionState: "", dataConnected: false, smsCapable: false, billingState: "active" };
  const OBSERVED = "2026-08-03T12:00:00Z";
  const NOW = Date.parse(OBSERVED);

  const unposed = normalizeSession(SILENT, OBSERVED);
  check(
    "carrier: a wholly silent carrier record does NOT assert an absent radio",
    unposed.cellularBackchannel === "unknown",
    `backchannel=${unposed.cellularBackchannel}`,
  );
  const unposedVerdict = evaluateReachability(unposed, NOW);
  check(
    "carrier: …it raises monitor and names the coverage gap, rather than alerting on a fact nobody observed",
    unposedVerdict.recommendedAction === "monitor" && unposedVerdict.reasonCode === "BACKCHANNEL_UNPOSED",
    `action=${unposedVerdict.recommendedAction} reason=${unposedVerdict.reasonCode}`,
  );
  const posedAbsent = evaluateReachability(normalizeSession(SILENT, OBSERVED, "absent"), NOW);
  check(
    "carrier: …and an explicitly POSED absent radio is still allowed to be the strong finding",
    posedAbsent.reasonCode === "NO_CELLULAR_BACKCHANNEL" && posedAbsent.recommendedAction === "alert",
    `action=${posedAbsent.recommendedAction} reason=${posedAbsent.reasonCode}`,
  );
  // The distinction has to be VISIBLE, not merely internal: a consumer reading the
  // posture must be able to tell "no radio" from "we could not tell".
  check(
    "carrier: the two answers are different postures, so no consumer can conflate them",
    unposedVerdict.posture !== posedAbsent.posture,
    `${unposedVerdict.posture} vs ${posedAbsent.posture}`,
  );
  // NON-VACUITY: a posed `present` must not make the silent record look reachable.
  const posedPresent = evaluateReachability(normalizeSession(SILENT, OBSERVED, "present"), NOW);
  check(
    "carrier: posing `present` does not launder an unreadable session into reachability",
    posedPresent.posture !== "reachable" && posedPresent.locatable === false,
    `posture=${posedPresent.posture} locatable=${posedPresent.locatable}`,
  );
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "Absent-collection law holds at every site that grades a collection. Nothing observed is not\n" +
    "the same as nothing wrong, and in every case the caution is DERIVED from the data rather\n" +
    "than left to a caller to request.",
);
