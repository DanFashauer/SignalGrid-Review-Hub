// Hardware-rooted device-attestation proof — fully OFFLINE and deterministic.
//
// Drives the read-only device-attestation connector against captured
// attestation-bridge reports (already verified to Apple's Enterprise Attestation
// Root CA) and runs the pure evaluator per device. The assurance model is the
// point: a fresh, root-verified attestation PROVING a healthy state is the only
// path to the top tier (attested_hardened/none); a proven bad state (SIP off →
// escalate, permissive boot → restrict) is the strongest negative; an expected-
// but-unverifiable/stale attestation steps up, NEVER grants; hardware provably not
// attestation-capable abstains; unknown is never attested-secure. No network.
//
// It also proves the fabric fuses this dimension: fromAttestation → an attestation
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeviceAttestationConnector,
  AttestationConnectorError,
  createMockAttestationTransport,
  evaluateAttestation,
  guardReadOnly,
  normalizeReport,
  resolveAttestationConnector,
  type AttestationReportRaw,
} from "@workspace/integrations/device-attestation";
import { composeDeviceRisk, fromAttestation } from "@workspace/posture-composition";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  hardwareRooted: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: AttestationReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/device-attestation/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://attestation-bridge.local/device-attestation";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Hardware-rooted device-attestation proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, AttestationReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockAttestationTransport({ reports, expectedToken: fixture.accessToken });
const connector = new DeviceAttestationConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchAttestation(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "device-attestation");
  const v = evaluateAttestation(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.hardwareRooted === spec.expected.hardwareRooted &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── assurance-model invariants ────────────────────────────────────────────────

// The ONLY path to the top tier is a fresh, root-verified attestation proving a
// healthy state — and it is the only verdict marked hardwareRooted with action none.
const hardened = evaluateAttestation(await connector.fetchAttestation(fixture.devices["attested-hardened"].deviceId));
check("a fresh root-verified healthy attestation → attested_hardened/none, hardwareRooted", hardened.posture === "attested_hardened" && hardened.recommendedAction === "none" && hardened.hardwareRooted === true);

// A cryptographically-PROVEN disabled SIP is the strongest negative — escalate,
// and it IS hardware-rooted (you can't argue with the Secure Enclave).
const sipOff = evaluateAttestation(await connector.fetchAttestation(fixture.devices["attested-sip-off"].deviceId));
check("attested SIP disabled → escalate AND hardwareRooted (proven, not self-reported)", sipOff.recommendedAction === "escalate" && sipOff.hardwareRooted === true && sipOff.criticalFindings.includes("attested_sip_disabled"));

// No attestation returned at all → gap → step_up (never the top tier).
const noCov = evaluateAttestation(normalizeReport("ghost", {} as AttestationReportRaw), { covered: false });
check("an uncovered device is 'unknown'/step_up, never attested-secure", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.hardwareRooted === false);
const uncoveredComposed = composeDeviceRisk([fromAttestation(noCov)]);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", uncoveredComposed.riskTier !== "ok" && uncoveredComposed.strongestAction === "step_up");

// An expected-but-unverifiable attestation (a chain that didn't validate) steps up
// — a stripped/replayed attestation is a tamper signal, never granted.
const unver = evaluateAttestation(await connector.fetchAttestation(fixture.devices["unverifiable"].deviceId));
check("an unverifiable attestation → step_up, never attested_hardened, not hardwareRooted", unver.posture === "unattested" && unver.recommendedAction === "step_up" && unver.hardwareRooted === false);

// Proven-not-capable hardware (Intel) ABSTAINS — attestation is an upgrade, not a
// universal requirement; the baseline posture is gated elsewhere.
const intel = evaluateAttestation(await connector.fetchAttestation(fixture.devices["not-attestable"].deviceId));
check("provably not attestation-capable → not_attestable/none (abstain, not penalized)", intel.posture === "not_attestable" && intel.recommendedAction === "none" && intel.hardwareRooted === false);
check("but a not_attestable device is NOT hardwareRooted (it grants no assurance)", intel.hardwareRooted === false);

// A verified chain whose attested facts can't be read is NOT the top tier — it
// raises the bar, yet is honestly still hardwareRooted (the chain is real).
const sipUnreadable = evaluateAttestation(await connector.fetchAttestation(fixture.devices["verified-sip-unreadable"].deviceId));
check("verified chain + unreadable attested SIP → step_up (not the top tier), still hardwareRooted", sipUnreadable.posture === "unverified" && sipUnreadable.recommendedAction === "step_up" && sipUnreadable.hardwareRooted === true);

// Unknown ≠ attested: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { attestable: true, chain: "totally-legit", freshness: "yesterday", sip: "sorta", secureBoot: "vibes" } as AttestationReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated verified/on)", norm.chain === "unknown" && norm.freshness === "unknown" && norm.attestedSip === "unknown" && norm.attestedSecureBoot === "unknown");

// A truthy non-boolean attestable/kext must be null, never true.
const boolNorm = normalizeReport("b", { attestable: "true", thirdPartyKextAllowed: 1 } as unknown as AttestationReportRaw);
check("a non-boolean attestable/kext flag is null (unknown), never a fabricated true", boolNorm.attestable === null && boolNorm.attestedKextAllowed === null);

// Worst-concern-wins: SIP off (escalate) outranks permissive boot (restrict) + kext (step_up).
const worst = evaluateAttestation(await connector.fetchAttestation(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: attested SIP off (escalate) outranks the restricts/step_ups", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 2);

// Fail closed on a SELF-CONTRADICTORY report. A bridge that returns
// attestable:false while ALSO presenting a fresh verified chain is malformed or
// tampered — it must NOT abstain to none. A conflicting chain proving SIP off must
// still escalate, and a conflicting "clean" chain must never reach the top tier.
const conflictBad = evaluateAttestation(await connector.fetchAttestation(fixture.devices["conflict-sip-off"].deviceId));
check("attestable:false + verified chain proving SIP off → escalate, NEVER not_attestable/none", conflictBad.posture === "attested_compromised" && conflictBad.recommendedAction === "escalate" && conflictBad.criticalFindings.includes("attested_sip_disabled"));
const conflictClean = evaluateAttestation(await connector.fetchAttestation(fixture.devices["conflict-clean"].deviceId));
check("attestable:false + verified 'healthy' chain → step_up (fail closed), NEVER attested_hardened/none", conflictClean.posture === "unverified" && conflictClean.reasonCode === "ATTESTATION_CONFLICT" && conflictClean.recommendedAction === "step_up");
check("a self-contradictory report never composes to the 'ok' tier", composeDeviceRisk([fromAttestation(conflictClean)]).riskTier !== "ok");
// A decoded freshness result IS attestation evidence — attestable:false alongside a
// fresh/stale freshness (even with chain/facts unknown) is a conflict, not an abstain.
const conflictFresh = evaluateAttestation(await connector.fetchAttestation(fixture.devices["conflict-freshness-only"].deviceId));
check("attestable:false + a decoded freshness → step_up conflict, NEVER not_attestable/none", conflictFresh.reasonCode === "ATTESTATION_CONFLICT" && conflictFresh.recommendedAction === "step_up" && conflictFresh.posture !== "not_attestable");
// The consistent Intel abstain still holds — only a self-consistent incapable
// report (no chain, no attested facts) abstains to none.
check("a self-CONSISTENT not-capable report still abstains (none) — the guard is surgical", intel.posture === "not_attestable" && intel.recommendedAction === "none");

// Determinism.
const d = await connector.fetchAttestation(fixture.devices["secureboot-permissive"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateAttestation(d)) === JSON.stringify(evaluateAttestation(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromAttestation(sipOff);
check("fromAttestation emits an attestation signal", signal.kind === "attestation");
const composed = composeDeviceRisk([signal]);
check("fabric fuses an attested-compromised device into an escalate verdict", composed.strongestAction === "escalate");
const attestedOk = fromAttestation(hardened);
check("an attested-hardened device contributes 'none' to the fabric", attestedOk.action === "none");
// Abstain contributes 'none' too — it neither penalizes nor grants.
check("a not_attestable device contributes 'none' to the fabric (abstain)", fromAttestation(intel).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof AttestationConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new DeviceAttestationConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["attested-hardened"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: AttestationConnectorError | null = null;
try { await bad.fetchAttestation(fixture.devices["attested-hardened"].deviceId); } catch (err) { authErr = err instanceof AttestationConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: AttestationConnectorError | null = null;
try { await connector.fetchAttestation("no-such-device"); } catch (err) { missingErr = err instanceof AttestationConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented attestation", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveAttestationConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveAttestationConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveAttestationConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveAttestationConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", DEVICE_ATTESTATION_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
