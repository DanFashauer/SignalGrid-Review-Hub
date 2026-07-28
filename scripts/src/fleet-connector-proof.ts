// Proof: the Fleet (open-source, osquery-based MDM) posture connector
// (@workspace/fleet-connector).
//
//   • maps Fleet host reports to the core's decision dimensions (managed,
//     compliance, baseline, freshness) + supervision-aware `enforceable`;
//   • fail-closed — a weak posture (unmanaged, unsupervised, encryption off, OS
//     below floor, screen lock off, stale/missing check-in) can only RAISE
//     assurance (auto → step-up), never lower it;
//   • deterministic — normalization is pure over an injected observation time;
//   • the summary is one-glance correct.
//
// Run: pnpm --filter @workspace/scripts run proof:fleet-connector

import {
  normalizeFleetReport,
  normalizeFleetReports,
  fleetSummary,
  DEMO_FLEET_REPORTS,
  FLEET_OBSERVED_AT,
  FleetClient,
  fleetOutcome,
  toHostReport,
  type FleetHostReport,
  type FleetRequest,
  type FleetResponse,
} from "@workspace/fleet-connector";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const signals = normalizeFleetReports(DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT);
const byRef = (ref: string) => signals.find((s) => s.hostRef === ref)!;

// ── healthy host: everything maps to the trusting values, no raise ────────────
const healthy = byRef("ipad-ward-01");
check("enrolled → managed", healthy.deviceManaged === true);
check("supervised → enforceable", healthy.enforceable === true);
check("encrypted+lock+floor → compliant", healthy.deviceCompliance === "compliant");
check("encrypted → baseline aligned", healthy.baselineCompliance === "aligned");
check("fresh check-in → freshness fresh", healthy.postureFreshness === "fresh");
check("healthy posture → assurance standard (no raise)", healthy.assurance === "standard");

// ── disk encryption off → non-compliant + drift + raise ───────────────────────
check("disk off → non_compliant", byRef("ipad-ward-02").deviceCompliance === "non_compliant");
check("disk off → baseline drifted", byRef("ipad-ward-02").baselineCompliance === "drifted");
check("disk off → raise step-up", byRef("ipad-ward-02").assurance === "raise_step_up");

// ── screen lock off → non-compliant + raise ───────────────────────────────────
check("screen lock off → non_compliant", byRef("ipad-ward-03").deviceCompliance === "non_compliant");
check("screen lock off → raise step-up", byRef("ipad-ward-03").assurance === "raise_step_up");

// ── OS below floor → non-compliant + raise ────────────────────────────────────
check("OS below floor → non_compliant", byRef("ipad-ward-04").deviceCompliance === "non_compliant");
check("OS below floor → raise step-up", byRef("ipad-ward-04").assurance === "raise_step_up");

// ── UNSUPERVISED (the enforcement axis) → not enforceable + raise ─────────────
// A clean-posture host that is NOT supervised can't be kiosked/allowlisted/made
// non-removable, so trust it less for a sensitive action even though disk/OS/lock
// are fine.
const byod = byRef("ipad-byod-01");
check("unsupervised → not enforceable", byod.enforceable === false);
check("unsupervised (otherwise clean) → raise step-up", byod.assurance === "raise_step_up");
check("unsupervised is still MDM-managed", byod.deviceManaged === true);

// ── freshness mapping + raise ─────────────────────────────────────────────────
check("stale check-in → freshness stale", byRef("ipad-ward-05").postureFreshness === "stale");
check("stale → raise step-up", byRef("ipad-ward-05").assurance === "raise_step_up");
check("never-seen → freshness missing", byRef("ipad-ward-06").postureFreshness === "missing");
check("unknown disk → compliance unknown", byRef("ipad-ward-06").deviceCompliance === "unknown");
check("never-seen → raise step-up", byRef("ipad-ward-06").assurance === "raise_step_up");

// ── unenrolled → not managed + not enforceable + raise ────────────────────────
check("unenrolled → not managed", byRef("iphone-personal-01").deviceManaged === false);
check("unenrolled → not enforceable", byRef("iphone-personal-01").enforceable === false);
check("unenrolled → raise step-up", byRef("iphone-personal-01").assurance === "raise_step_up");

// ── SAFETY: a weak posture NEVER yields assurance 'standard' ───────────────────
check("SAFETY: only the fully-healthy+supervised host is assurance standard",
  signals.filter((s) => s.assurance === "standard").length === 1);

// ── fail-closed on a future-dated report (don't trust it) ─────────────────────
const future: FleetHostReport = { hostRef: "ipad-future", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 26, osFloor: 26, lastSeenAt: "2099-01-01T00:00:00.000Z" };
const fs = normalizeFleetReport(future, FLEET_OBSERVED_AT);
check("future-dated check-in → freshness unknown (not fresh)", fs.postureFreshness === "unknown");
check("future-dated check-in → raise step-up (fail closed)", fs.assurance === "raise_step_up");

// ── NEGATIVE CONTROL: absence is not a pass ───────────────────────────────────
// A transport that cannot see screen lock (Fleet's host list, for one) leaves the
// field absent. Before the fix, such a host — encrypted, supervised, fresh —
// graded `compliant` on a check nobody made. A grant requires positive
// confirmation of EVERY input: absent screen lock ⇒ unknown + raise step-up.
const noLock: FleetHostReport = { hostRef: "ipad-nolock", mdmEnrolled: true, supervised: true, diskEncryption: "on", osMajor: 26, osFloor: 26, lastSeenAt: "2026-07-16T13:30:00.000Z" };
const nls = normalizeFleetReport(noLock, FLEET_OBSERVED_AT);
check("absent screen lock → compliance unknown (never compliant)", nls.deviceCompliance === "unknown");
check("absent screen lock → raise step-up", nls.assurance === "raise_step_up");

// A configured OS floor with NO observed OS version is the same fail-open shape as the
// absent screen lock: `belowFloor` is false only because the version is unseen, which
// must never read as compliant. Positive confirmation of the OS is required whenever a
// floor is enforced.
const noOs: FleetHostReport = { hostRef: "ipad-noos", mdmEnrolled: true, supervised: true, diskEncryption: "on", screenLock: "on", osFloor: 26, lastSeenAt: "2026-07-16T13:30:00.000Z" };
const nos = normalizeFleetReport(noOs, FLEET_OBSERVED_AT);
check("floor enforced but OS version unknown → compliance unknown (never compliant)", nos.deviceCompliance === "unknown");
check("floor enforced but OS version unknown → raise step-up", nos.assurance === "raise_step_up");

// ── determinism ───────────────────────────────────────────────────────────────
check("normalization is deterministic", JSON.stringify(normalizeFleetReports(DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT)) === JSON.stringify(signals));

// ── summary ───────────────────────────────────────────────────────────────────
const sum = fleetSummary(signals, DEMO_FLEET_REPORTS);
check("summary counts 8 hosts", sum.hosts === 8);
check("summary counts 7 managed", sum.managed === 7);
check("summary counts 6 enforceable (supervised)", sum.enforceable === 6);
check("summary counts 5 disk-encrypted", sum.diskEncrypted === 5);
check("summary counts 3 non-compliant", sum.nonCompliant === 3);
check("summary raiseStepUp = all but the one healthy+supervised host", sum.raiseStepUp === 7);

// ── enforcement client (decision -> Fleet), stubbed transport ─────────────────
const stub = async (req: FleetRequest): Promise<FleetResponse> => {
  if (req.path === "/api/v1/fleet/hosts") {
    return { status: 200, json: { hosts: [
      { id: 42, uuid: "UUID-42", hostname: "ipad-ward-01", mdm: { enrollment_status: "On (automatic)" }, disk_encryption_enabled: true, os_version: "iOS 26.1", seen_time: FLEET_OBSERVED_AT },
      { id: 7, uuid: "UUID-7", hostname: "iphone-personal", mdm: { enrollment_status: "Off" }, disk_encryption_enabled: false, os_version: "iOS 24.0", seen_time: FLEET_OBSERVED_AT },
    ] } };
  }
  return { status: 200, json: {} };
};
const client = new FleetClient({ baseUrl: "https://fleet.example", token: "t", transport: stub, normalTeamId: 1, restrictedTeamId: 9, osFloor: 26 });

const hosts = await client.listHostPosture();
check("client maps Fleet hosts → reports", hosts.length === 2 && hosts[0].hostRef === "UUID-42");
check("config osFloor is stamped onto every fetched report", hosts.every((h) => h.osFloor === 26));
check("fetched host leaves screenLock ABSENT (not an asserted pass)", hosts[0].screenLock === undefined);
check("On (automatic) → managed + supervised", hosts[0].mdmEnrolled === true && hosts[0].supervised === true);
check("disk_encryption_enabled true → diskEncryption on", hosts[0].diskEncryption === "on");
check("os_version 'iOS 26.1' → osMajor 26", hosts[0].osMajor === 26);
check("'Off' enrollment → not managed, not supervised", hosts[1].mdmEnrolled === false && hosts[1].supervised === false);

// Actuation is deliberately ABSENT from this public package (review finding): an
// exported write path — even exercised only with stubs here — hands any injected
// fetch transport everything needed for a production host transfer. What the public
// repo proves is the READ (above) and the DERIVATION (below); the transfer itself
// lives in the private core, fed by `fleetOutcome`.
check("public FleetClient exposes NO actuation method (read-only by construction)",
  (client as unknown as Record<string, unknown>)["applyDecision"] === undefined);

// ── THE LOOP: normalized posture DRIVES the decision that is actuated ──────────
// Adversarial-review finding (Codex): earlier this proof normalized posture, then
// actuated HAND-PICKED outcomes — so it would stay green even if the posture had no
// effect on enforcement. `fleetOutcome` closes that gap: the outcome fed to
// applyDecision is DERIVED from the normalized signal, and the actuation is asserted
// against the posture rather than a literal. Now an unmanaged/non-compliant host that
// stopped affecting the decision would fail here.
const outcomeByRef = (ref: string) => fleetOutcome(byRef(ref));
check("healthy+supervised posture derives allow", outcomeByRef("ipad-ward-01") === "allow");
// Affirmatively non-compliant / unmanaged posture must derive restrict and tighten.
for (const [ref, why] of [["ipad-ward-02", "disk off"], ["ipad-ward-03", "lock off"], ["ipad-ward-04", "OS below floor"], ["iphone-personal-01", "unenrolled"]] as const) {
  check(`${why} posture derives restrict`, outcomeByRef(ref) === "restrict");
}
// Weak-but-managed posture (unsupervised, stale, never-seen/unknown) derives step_up.
for (const [ref, why] of [["ipad-byod-01", "unsupervised"], ["ipad-ward-05", "stale"], ["ipad-ward-06", "never-seen/unknown"]] as const) {
  check(`${why} posture derives step_up`, outcomeByRef(ref) === "step_up");
}
// The derived decision tracks posture 1:1: exactly the one healthy+supervised host
// relaxes, matching the assurance-standard count — a broken normalizer can no longer pass.
check("exactly ONE host in the fleet derives allow (matches the assurance-standard count)",
  signals.filter((s) => fleetOutcome(s) === "allow").length === 1);
// NEGATIVE CONTROL: a non-compliant host must NEVER derive allow, or the loop would
// silently un-restrict a device the posture condemned.
check("SAFETY: no non-compliant host ever derives allow",
  signals.filter((s) => s.deviceCompliance === "non_compliant").every((s) => fleetOutcome(s) !== "allow"));
// NEGATIVE CONTROL (adversarial-review finding): fleetOutcome must require POSITIVE
// health on every field, never trust the derived `assurance` hint alone. An
// independently-constructed / deserialized signal can carry `assurance: "standard"`
// while another field is ambiguous — that must NOT reach allow.
const inconsistentUnknownCompliance = { hostRef: "x", deviceManaged: true, deviceCompliance: "unknown" as const, baselineCompliance: "aligned" as const, postureFreshness: "fresh" as const, enforceable: true, assurance: "standard" as const, rationale: "", sourceReference: "" };
check("SAFETY: standard-assurance hint with UNKNOWN compliance does NOT derive allow", fleetOutcome(inconsistentUnknownCompliance) !== "allow");
const inconsistentStale = { ...inconsistentUnknownCompliance, deviceCompliance: "compliant" as const, postureFreshness: "stale" as const };
check("SAFETY: standard-assurance hint with a STALE check-in does NOT derive allow", fleetOutcome(inconsistentStale) !== "allow");
const inconsistentUnenforceable = { ...inconsistentUnknownCompliance, deviceCompliance: "compliant" as const, enforceable: false };
check("SAFETY: standard-assurance hint on an UNENFORCEABLE host does NOT derive allow", fleetOutcome(inconsistentUnenforceable) !== "allow");
const fullyHealthy = { ...inconsistentUnknownCompliance, deviceCompliance: "compliant" as const };
check("a positively-confirmed-healthy signal still derives allow (allow path stays reachable)", fleetOutcome(fullyHealthy) === "allow");


const total = passed + failures.length;
console.log(`Fleet-connector proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Fleet host posture normalizes to decision dimensions, fail-closed (weak/unsupervised posture only raises assurance).");
