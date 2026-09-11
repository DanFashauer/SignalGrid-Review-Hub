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
  makeDefaultAttestationTransport,
  DeviceAttestationConnector,
  AttestationConnectorError,
  createMockAttestationTransport,
  evaluateAttestation,
  guardReadOnly,
  normalizeReport,
  resolveAttestationConnector,
  SUPERVISION_IDENTITY_FIXTURES,
  evaluateSupervisionIdentity,
  evaluateSupervisionIdentityFixture,
  normalizeSupervisionIdentity,
  SUPERVISION_DOMAIN,
  IDENTITY_BINDING_DOMAIN,
  SUPERVISION_ENROLLMENT_DOMAIN,
  MANAGEMENT_CHANNEL_DOMAIN,
  SUPERVISION_INTEGRITY_DOMAIN,
  type AttestationReportRaw,
  type ManagementChannel,
  type NormalizedSupervisionIdentity,
  type SupervisionEnrollment,
  type SupervisionIdentityBinding,
  type SupervisionIdentityReportRaw,
  type SupervisionIdentityVerdict,
  type SupervisionReportIntegrity,
  type SupervisionState,
} from "@workspace/integrations/device-attestation";
import { composeDeviceRisk, fromAttestation } from "@workspace/posture-composition";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

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
// A signed identity fact (serial / OS version) is decoded attestation output too —
// attestable:false alongside one is a conflict, not an abstain.
const conflictIdentity = evaluateAttestation(await connector.fetchAttestation(fixture.devices["conflict-identity-only"].deviceId));
check("attestable:false + an attested serial/OS → step_up conflict, NEVER not_attestable/none", conflictIdentity.reasonCode === "ATTESTATION_CONFLICT" && conflictIdentity.recommendedAction === "step_up" && conflictIdentity.posture !== "not_attestable");
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


// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. This family has TWO deliberate `none` outcomes —
// the top-tier grant (verified + fresh + every attested fact positively good) and
// the honest abstain (hardware declares itself incapable AND carries no
// attestation evidence). Every raw-value combination is executed through the REAL
// normalizer + evaluator — including out-of-vocabulary strings, which must read
// as unknown — and the granting set is pinned by equality.
{
  const domains = {
    covered: [true, false],
    attestable: [true, false, undefined],
    // "garbage" is an out-of-vocabulary vendor string; the normalizer must fold
    // it to unknown, so it doubles as the unknown member of each axis.
    chain: ["verified", "unverifiable", "garbage"],
    freshness: ["fresh", "stale", "garbage"],
    sip: ["on", "off", "garbage"],
    secureBoot: ["full", "reduced", "permissive", "garbage"],
    kext: [true, false, undefined],
    serial: ["C02SYNTH0001", undefined],
  } as const;

  type Enum = { rep: ReturnType<typeof normalizeReport>; covered: boolean };
  const build = (c: Record<string, unknown>): Enum => ({
    rep: normalizeReport("dev.enum", {
      attestable: c.attestable as boolean | undefined,
      chain: c.chain as string,
      freshness: c.freshness as string,
      sip: c.sip as string,
      secureBoot: c.secureBoot as string,
      thirdPartyKextAllowed: c.kext as boolean | undefined,
      serial: c.serial as string | undefined,
    }),
    covered: c.covered as boolean,
  });

  const swept = enumerateGrantSafety<Enum, ReturnType<typeof evaluateAttestation>>({
    domains,
    build,
    evaluate: (s) => evaluateAttestation(s.rep, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.covered === true &&
      // The honest abstain: provably incapable AND silent — no chain, no
      // freshness, no decoded control, no signed identity fact.
      ((c.attestable === false && c.chain === "garbage" && c.freshness === "garbage" &&
        c.sip === "garbage" && c.secureBoot === "garbage" && c.kext === undefined && c.serial === undefined) ||
      // The top tier: capability not denied, chain verified AND fresh, every
      // attested fact positively good (SIP on, full secure boot, kexts denied).
      (c.attestable !== false && c.chain === "verified" && c.freshness === "fresh" &&
        c.sip === "on" && c.secureBoot === "full" && c.kext === false)),
    // Each grant must be the EARNED reason for its arm — and hardwareRooted must
    // tell the truth about which arm it was.
    confirmedWhenNone: (v) =>
      (v.reasonCode === "FULLY_ATTESTED" && v.posture === "attested_hardened" && v.hardwareRooted === true) ||
      (v.reasonCode === "NOT_ATTESTABLE" && v.posture === "not_attestable" && v.hardwareRooted === false),
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 2 * 3 * 3 * 3 * 3 * 4 * 3 * 2);
  check("ENUMERATION: a grant is reachable ONLY by the top tier or the honest abstain — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: the granting set is 1 honest abstain + 4 top-tier states (non-vacuous)",
    swept.noneCount === 5);

  // NEGATIVE CONTROL — the enumeration can fail: declare EVERY `attestable:false`
  // report clean (ignoring what evidence it carries) and the harness must object,
  // because a report that denies capability while presenting a chain or attested
  // facts is contradictory and the evaluator (correctly) refuses to abstain.
  const wrongPredicate = enumerateGrantSafety<Enum, ReturnType<typeof evaluateAttestation>>({
    domains,
    build,
    evaluate: (s) => evaluateAttestation(s.rep, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.covered === true &&
      (c.attestable === false ||
      (c.attestable !== false && c.chain === "verified" && c.freshness === "fresh" &&
        c.sip === "on" && c.secureBoot === "full" && c.kext === false)),
  });
  check("NEGATIVE CONTROL: declaring every incapability claim clean is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");
}

// ── 7. THE APPLE SUPERVISION-IDENTITY LIFECYCLE ("device trust" as a precondition) ──
//
// A DISTINCT surface from the hardware attestation above (supervision-identity.ts):
// not what the Secure Enclave proves about the device, but whether the ORGANIZATION
// still holds the device's supervision identity — the runbooks' "device trust",
// without which no management command runs. It is the row this family had only
// partially modeled. Fail-closed is the whole game: every unknown tightens, and the
// one grant is pinned by equality over the whole lifecycle state space.
console.log("\n  ── the supervision-identity lifecycle ──\n");
{
  // 7a. NAMED OUTCOMES — every lifecycle state reaches its verdict, each by name.
  const F = (n: string): SupervisionIdentityVerdict => evaluateSupervisionIdentityFixture(n)!;
  const cases: Array<[string, string, string]> = [
    ["supervised-trusted", "none", "SUPERVISION_IDENTITY_PRESENT"],
    ["foreign-identity", "restrict", "SUPERVISION_FOREIGN_IDENTITY"],
    ["identity-lost", "restrict", "SUPERVISION_IDENTITY_LOST"],
    ["identity-binding-unknown", "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["enrollment-lost", "restrict", "SUPERVISION_ENROLLMENT_LOST"],
    ["never-enrolled", "restrict", "SUPERVISION_NEVER_ENROLLED"],
    ["enrollment-unknown", "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["unsupervised", "restrict", "SUPERVISION_UNSUPERVISED"],
    ["supervision-unknown", "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["channel-unresponsive", "step_up", "SUPERVISION_CHANNEL_UNRESPONSIVE"],
    ["channel-unknown", "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["report-malformed", "step_up", "SUPERVISION_REPORT_MALFORMED"],
    ["worst-of-several", "restrict", "SUPERVISION_FOREIGN_IDENTITY"],
  ];
  for (const [name, action, reason] of cases) {
    const v = F(name);
    check(
      `fixture \`${name}\` → ${action} / ${reason} (${v.recommendedAction} / ${v.reasonCode})`,
      v.recommendedAction === action && v.reasonCode === reason,
    );
  }
  check("every fixture's fixture-name count matches the cases named above (no fixture left un-asserted)",
    Object.keys(SUPERVISION_IDENTITY_FIXTURES).length === cases.length);
  const reached = new Set(cases.map(([n]) => F(n).recommendedAction));
  check(`NON-VACUITY: none, step_up and restrict are all reachable (${[...reached].sort().join(", ")})`,
    reached.has("none") && reached.has("step_up") && reached.has("restrict"));
  check("an unknown fixture name yields undefined — never a fabricated verdict",
    evaluateSupervisionIdentityFixture("no-such-fixture") === undefined);
  const worst = F("worst-of-several");
  check("worst-of-several records all three critical findings and names the foreign identity first (precedence)",
    worst.criticalFindings.length === 3 && worst.reasonCode === "SUPERVISION_FOREIGN_IDENTITY");
  check("only the grant is trustPreconditionMet; every other fixture is not",
    cases.every(([n, action]) => F(n).trustPreconditionMet === (action === "none")));

  // 7b. FAIL-CLOSED CONTROLS — corrupt the sole grant ONE axis at a time; every one
  // must fall away from the grant, for its own named reason.
  const base = SUPERVISION_IDENTITY_FIXTURES["supervised-trusted"];
  const baseline = evaluateSupervisionIdentity(base);
  check("CONTROL baseline: the untouched grant does grant, with the precondition met and no findings",
    baseline.recommendedAction === "none" && baseline.trustPreconditionMet === true &&
    baseline.criticalFindings.length === 0 && baseline.unknownSignals.length === 0);
  const flips: Array<[string, Partial<NormalizedSupervisionIdentity>, string, string]> = [
    ["identity binding → unknown", { identityBinding: "unknown" }, "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["identity binding → unbound (lost)", { identityBinding: "unbound" }, "restrict", "SUPERVISION_IDENTITY_LOST"],
    ["identity binding → another org", { identityBinding: "bound_to_other_org" }, "restrict", "SUPERVISION_FOREIGN_IDENTITY"],
    ["enrollment → lost", { enrollment: "enrollment_lost" }, "restrict", "SUPERVISION_ENROLLMENT_LOST"],
    ["enrollment → never enrolled", { enrollment: "never_enrolled" }, "restrict", "SUPERVISION_NEVER_ENROLLED"],
    ["enrollment → unknown", { enrollment: "unknown" }, "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["supervision → unsupervised", { supervision: "unsupervised" }, "restrict", "SUPERVISION_UNSUPERVISED"],
    ["supervision → unknown", { supervision: "unknown" }, "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["command channel → unresponsive", { commandChannel: "unresponsive" }, "step_up", "SUPERVISION_CHANNEL_UNRESPONSIVE"],
    ["command channel → unknown", { commandChannel: "unknown" }, "step_up", "SUPERVISION_STATE_UNKNOWN"],
    ["report → malformed", { reportIntegrity: "malformed" }, "step_up", "SUPERVISION_REPORT_MALFORMED"],
  ];
  for (const [label, patch, action, reason] of flips) {
    const v = evaluateSupervisionIdentity({ ...base, ...patch });
    check(
      `FAIL-CLOSED: ${label} flips the grant to ${action} / ${reason} (${v.recommendedAction} / ${v.reasonCode})`,
      v.recommendedAction === action && v.reasonCode === reason && v.trustPreconditionMet === false,
    );
  }

  // 7c. THE GRANT SET, PINNED BY EQUALITY over the whole lifecycle state space. Only an
  // equality pin excludes the states nobody named; the sweep is the backstop.
  const domains = {
    supervision: ["supervised", "unsupervised", "unknown"],
    identityBinding: ["bound_to_org", "bound_to_other_org", "unbound", "unknown"],
    enrollment: ["enrolled", "enrollment_lost", "never_enrolled", "unknown"],
    commandChannel: ["responsive", "unresponsive", "unknown"],
    reportIntegrity: ["clean", "malformed"],
  } as const;
  const build = (c: Record<string, unknown>): NormalizedSupervisionIdentity => ({
    sourceSystem: "device-attestation",
    deviceId: "enum",
    supervision: c.supervision as SupervisionState,
    identityBinding: c.identityBinding as SupervisionIdentityBinding,
    enrollment: c.enrollment as SupervisionEnrollment,
    commandChannel: c.commandChannel as ManagementChannel,
    reportIntegrity: c.reportIntegrity as SupervisionReportIntegrity,
  });
  const isTheGrant = (c: Record<string, unknown>): boolean =>
    c.supervision === "supervised" &&
    c.identityBinding === "bound_to_org" &&
    c.enrollment === "enrolled" &&
    c.commandChannel === "responsive" &&
    c.reportIntegrity === "clean";
  const swept = enumerateGrantSafety<NormalizedSupervisionIdentity, SupervisionIdentityVerdict>({
    domains,
    build,
    evaluate: evaluateSupervisionIdentity,
    actionOf: (v) => v.recommendedAction,
    positivelyClean: isTheGrant,
    confirmedWhenNone: (v) =>
      v.trustPreconditionMet === true && v.reasonCode === "SUPERVISION_IDENTITY_PRESENT" &&
      v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  });
  check(`ENUMERATION: all ${swept.combos} lifecycle states swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 3 * 4 * 4 * 3 * 2);
  check("ENUMERATION: the trust precondition is met by EXACTLY the one positively-confirmed state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: exactly one state grants (non-vacuous)", swept.noneCount === 1);
  // NEGATIVE CONTROL — the enumeration can fail: declare every bound-to-org state clean
  // (ignoring enrollment, supervision, the channel and the parse) and it must object.
  const wrong = enumerateGrantSafety<NormalizedSupervisionIdentity, SupervisionIdentityVerdict>({
    domains,
    build,
    evaluate: evaluateSupervisionIdentity,
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) => c.identityBinding === "bound_to_org",
  });
  check("NEGATIVE CONTROL: declaring every bound-to-org state clean is CAUGHT (mismatches > 0)",
    wrong.mismatches > 0 && typeof wrong.firstMismatch === "string");
  // The surface only ever HOLDS (step_up) or CONTAINS (restrict) — it never merely
  // monitors, alerts or escalates: a device this org cannot command is not a nuance.
  let offLadder = 0;
  for (const supervision of domains.supervision)
    for (const identityBinding of domains.identityBinding)
      for (const enrollment of domains.enrollment)
        for (const commandChannel of domains.commandChannel)
          for (const reportIntegrity of domains.reportIntegrity) {
            const a = evaluateSupervisionIdentity(build({ supervision, identityBinding, enrollment, commandChannel, reportIntegrity })).recommendedAction;
            if (a !== "none" && a !== "step_up" && a !== "restrict") offLadder += 1;
          }
  check("no lifecycle state resolves to monitor/alert/escalate — every non-grant is a hold or a containment", offLadder === 0);

  // 7d. THE NORMALIZER on hostile wire input — the asymmetry that makes it safe.
  const wireOk = normalizeSupervisionIdentity("w-1", { supervised: true, identity_binding: "bound_to_org", enrollment: "enrolled", command_channel: "responsive" });
  check("a boolean `supervised: true` normalizes to supervised, and the report is clean",
    wireOk.supervision === "supervised" && wireOk.reportIntegrity === "clean");
  check("a fully-confirmed wire report evaluates to the grant (the normalizer can reach it)",
    evaluateSupervisionIdentity(wireOk).trustPreconditionMet === true);
  const wireUnsup = normalizeSupervisionIdentity("w-2", { supervised: false, identity_binding: "bound_to_org", enrollment: "enrolled", command_channel: "responsive" });
  check("`supervised: false` is an AFFIRMATIVE fact — unsupervised → restrict",
    wireUnsup.supervision === "unsupervised" && evaluateSupervisionIdentity(wireUnsup).recommendedAction === "restrict");
  const wireVocab = normalizeSupervisionIdentity("w-3", { supervised: "totally", identity_binding: "org-ish", enrollment: "yes", command_channel: "fine" });
  check("out-of-vocabulary strings normalize to unknown on every axis (never a fabricated confirmed state) and the report stays clean",
    wireVocab.supervision === "unknown" && wireVocab.identityBinding === "unknown" && wireVocab.enrollment === "unknown" &&
    wireVocab.commandChannel === "unknown" && wireVocab.reportIntegrity === "clean");
  const wireMalformed = normalizeSupervisionIdentity("w-4", { supervised: 1, identity_binding: { bound: true }, enrollment: "enrolled", command_channel: "responsive" });
  check("a present-but-non-string slot marks the report MALFORMED (an assertion we could not read) — step_up for that reason",
    wireMalformed.reportIntegrity === "malformed" && evaluateSupervisionIdentity(wireMalformed).reasonCode === "SUPERVISION_REPORT_MALFORMED");
  const wireSilent = normalizeSupervisionIdentity("w-5", undefined);
  check("an absent report (silence) is all-unknown and CLEAN — silence is not malformed — and still steps up",
    wireSilent.supervision === "unknown" && wireSilent.identityBinding === "unknown" && wireSilent.reportIntegrity === "clean" &&
    evaluateSupervisionIdentity(wireSilent).recommendedAction === "step_up");
  // Own-property reads (review finding): a report that INHERITS the recognized fields —
  // Object.create({...}), or a polluted prototype — asserted nothing itself, yet the first
  // cut read the inherited values as evidence and reached the grant. Every shape below must
  // be malformed, all-unknown, and never satisfy the trust precondition.
  const grantRaw = { supervised: true, identity_binding: "bound_to_org", enrollment: "enrolled", command_channel: "responsive" };
  const wireInherited = normalizeSupervisionIdentity("w-6", Object.create(grantRaw) as SupervisionIdentityReportRaw);
  check("a report that only INHERITS the confirmed fields is malformed, all-unknown, and never grants (the prototype's claim is not this report's)",
    wireInherited.reportIntegrity === "malformed" && wireInherited.supervision === "unknown" && wireInherited.identityBinding === "unknown" &&
    wireInherited.enrollment === "unknown" && wireInherited.commandChannel === "unknown" &&
    evaluateSupervisionIdentity(wireInherited).trustPreconditionMet === false);
  const wireAlias = normalizeSupervisionIdentity("w-7", Object.assign(Object.create({ identity_binding: "bound_to_other_org" }), grantRaw) as SupervisionIdentityReportRaw);
  check("a recognized key inherited BEHIND a clean own set still marks the report malformed (the chain scan, not the own read, notices it)",
    wireAlias.reportIntegrity === "malformed" && evaluateSupervisionIdentity(wireAlias).trustPreconditionMet === false);
  check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
    normalizeSupervisionIdentity("w-8", Object.prototype as SupervisionIdentityReportRaw).reportIntegrity === "malformed");
  check("an array or a string where the report should be is malformed, never a thrown TypeError",
    normalizeSupervisionIdentity("w-9", [] as unknown as SupervisionIdentityReportRaw).reportIntegrity === "malformed" &&
    normalizeSupervisionIdentity("w-10", "supervised" as unknown as SupervisionIdentityReportRaw).reportIntegrity === "malformed");
  const wireExtra = normalizeSupervisionIdentity("w-11", { ...grantRaw, supervised_state: "yes" } as SupervisionIdentityReportRaw);
  check("an unrecognized OWN key is an assertion in a spelling we ignore — malformed, and the clean-looking rest does not grant",
    wireExtra.reportIntegrity === "malformed" && evaluateSupervisionIdentity(wireExtra).trustPreconditionMet === false);
  check("a symbol-keyed report is malformed",
    normalizeSupervisionIdentity("w-12", { ...grantRaw, [Symbol("x")]: 1 } as SupervisionIdentityReportRaw).reportIntegrity === "malformed");
  let siDeepProto: object = {};
  for (let i = 0; i < 100; i += 1) siDeepProto = Object.create(siDeepProto);
  check("a report behind a 100-deep prototype chain is malformed (the walk is bounded, not trusted)",
    normalizeSupervisionIdentity("w-13", Object.assign(Object.create(siDeepProto), grantRaw) as SupervisionIdentityReportRaw).reportIntegrity === "malformed");
  const siThrowing = new Proxy(grantRaw, { ownKeys: () => { throw new Error("hostile"); } }) as SupervisionIdentityReportRaw;
  check("a Proxy whose key enumeration throws is malformed, never an exception out of the normalizer",
    normalizeSupervisionIdentity("w-14", siThrowing).reportIntegrity === "malformed");
  check("a plain own-property report still reaches the grant after the own-read change (the fix did not foreclose the honest path)",
    evaluateSupervisionIdentity(normalizeSupervisionIdentity("w-15", { ...grantRaw })).trustPreconditionMet === true);
  // A recognized OWN key whose read throws — an accessor, or a Proxy `get` trap — passes the
  // key scan; the read itself must be caught and the report marked malformed (review finding).
  const siGetter = Object.defineProperty({ identity_binding: "bound_to_org", enrollment: "enrolled", command_channel: "responsive" },
    "supervised", { get() { throw new Error("hostile getter"); }, enumerable: true });
  const siGetterOut = normalizeSupervisionIdentity("w-16", siGetter as SupervisionIdentityReportRaw);
  check("an own accessor whose getter throws is malformed and all-unknown, never an exception out of the normalizer",
    siGetterOut.reportIntegrity === "malformed" && siGetterOut.supervision === "unknown" && siGetterOut.identityBinding === "unknown");
  const siGetTrap = new Proxy(grantRaw, { get: () => { throw new Error("hostile get"); } }) as SupervisionIdentityReportRaw;
  check("a Proxy whose `get` trap throws is malformed, never an exception (the key scan alone does not see it)",
    normalizeSupervisionIdentity("w-17", siGetTrap).reportIntegrity === "malformed");
  // The grant is a POSITIVE predicate: a NORMALIZED value outside the declared union — a
  // JavaScript caller, a cast — matches no branch and must be HELD, not granted (review
  // finding: the exhaustive sweep walks only union members, so it could not see this).
  // (report integrity is the one axis an existing branch already catches — anything not
  // "clean" is malformed — so its expected reason is that branch's, not the predicate's.)
  const oodAxes: Array<[string, Partial<NormalizedSupervisionIdentity>, SupervisionIdentityVerdict["reasonCode"], string]> = [
    ["supervision", { supervision: "garbage" as SupervisionState }, "SUPERVISION_STATE_UNKNOWN", "state_out_of_domain"],
    ["identity binding", { identityBinding: "garbage" as SupervisionIdentityBinding }, "SUPERVISION_STATE_UNKNOWN", "state_out_of_domain"],
    ["enrollment", { enrollment: "garbage" as SupervisionEnrollment }, "SUPERVISION_STATE_UNKNOWN", "state_out_of_domain"],
    ["command channel", { commandChannel: "garbage" as ManagementChannel }, "SUPERVISION_STATE_UNKNOWN", "state_out_of_domain"],
    ["report integrity", { reportIntegrity: "garbage" as SupervisionReportIntegrity }, "SUPERVISION_REPORT_MALFORMED", "report_integrity"],
  ];
  for (const [label, patch, reason, signal] of oodAxes) {
    const v = evaluateSupervisionIdentity({ ...base, ...patch });
    check(`an out-of-domain runtime value on ${label} is held (step_up / ${reason}), never the grant`,
      v.recommendedAction === "step_up" && v.reasonCode === reason && v.trustPreconditionMet === false &&
      v.unknownSignals.includes(signal));
  }
  check("the positive predicate does not disturb a real concern's reason (unresponsive channel keeps its own reason, not the out-of-domain one)",
    evaluateSupervisionIdentity({ ...base, commandChannel: "unresponsive" }).reasonCode === "SUPERVISION_CHANNEL_UNRESPONSIVE");
  // Two axes (review finding on the first cut of the sibling guard): a fired concern beside
  // an out-of-domain axis. The hold must fire whatever else fired; an earlier hold keeps its
  // reason on the tie, a containment stays a containment, and the grant is never reachable.
  const heldPlusGarbage = evaluateSupervisionIdentity({ ...base, commandChannel: "unresponsive", enrollment: "garbage" as SupervisionEnrollment });
  check("an unresponsive channel beside an out-of-domain axis is held under the channel's own reason, and the out-of-domain signal is still recorded",
    heldPlusGarbage.recommendedAction === "step_up" && heldPlusGarbage.reasonCode === "SUPERVISION_CHANNEL_UNRESPONSIVE" &&
    heldPlusGarbage.trustPreconditionMet === false && heldPlusGarbage.unknownSignals.includes("state_out_of_domain"));
  const containedPlusGarbage = evaluateSupervisionIdentity({ ...base, identityBinding: "bound_to_other_org", supervision: "garbage" as SupervisionState });
  check("a foreign identity beside an out-of-domain axis stays a containment with its own reason (the hold never weakens a restrict)",
    containedPlusGarbage.recommendedAction === "restrict" && containedPlusGarbage.reasonCode === "SUPERVISION_FOREIGN_IDENTITY" &&
    containedPlusGarbage.trustPreconditionMet === false && containedPlusGarbage.unknownSignals.includes("state_out_of_domain"));
  // The per-axis `unknown` branches must stay LIVE now that the positive predicate also
  // holds those states under the same reason: each names ITS axis in unknownSignals, and
  // the backstop's "state_out_of_domain" must not appear — otherwise a deleted branch is
  // invisible to the proof (four such mutants survived the sweep before this check).
  const unknownAxisSignals: Array<[string, string]> = [
    ["identity-binding-unknown", "identity_binding"],
    ["enrollment-unknown", "enrollment"],
    ["supervision-unknown", "supervision"],
    ["channel-unknown", "command_channel"],
  ];
  for (const [fixture, signal] of unknownAxisSignals) {
    const v = F(fixture);
    check(`the '${fixture}' hold names its own axis ('${signal}') and is NOT the out-of-domain backstop`,
      v.unknownSignals.includes(signal) && !v.unknownSignals.includes("state_out_of_domain"));
  }
  // The domain lists are the guard's allowlist. `readonly` is compile-time only: a JavaScript
  // caller that pushed "garbage" onto an exported list would make it in-domain and reopen
  // the grant (review finding). They are frozen at runtime, and a mutation attempt must
  // leave the hold in place.
  const siDomains = [SUPERVISION_DOMAIN, IDENTITY_BINDING_DOMAIN, SUPERVISION_ENROLLMENT_DOMAIN, MANAGEMENT_CHANNEL_DOMAIN, SUPERVISION_INTEGRITY_DOMAIN];
  check("every exported supervision domain list is frozen at runtime", siDomains.every((d) => Object.isFrozen(d)));
  let siPushThrew = false;
  try { (SUPERVISION_ENROLLMENT_DOMAIN as unknown as string[]).push("garbage"); } catch { siPushThrew = true; }
  check("pushing onto a domain list throws (strict mode) and does not widen it — the out-of-domain hold survives the attempt",
    siPushThrew && SUPERVISION_ENROLLMENT_DOMAIN.length === 4 &&
    evaluateSupervisionIdentity({ ...base, enrollment: "garbage" as SupervisionEnrollment }).trustPreconditionMet === false);
  check("supervision-identity evaluator is deterministic",
    JSON.stringify(evaluateSupervisionIdentity(base)) === JSON.stringify(evaluateSupervisionIdentity(base)));
}

// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "device-attestation",
  resolve: (env) => resolveAttestationConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    DEVICE_ATTESTATION_ACCESS_TOKEN: "t",
  },
});


// The DEFAULT transport, which injecting one everywhere meant nothing ever executed.
// Its two guards survived every sweep: without `!res.ok` a vendor's 500 body is parsed
// as a report, and without the body-shape check an array or a bare `null` becomes one.
await checkDefaultTransport({
  check,
  family: "device-attestation",
  transport: makeDefaultAttestationTransport("https://vendor.invalid/device-attestation") as (a: never) => Promise<unknown>,
  arg: { deviceId: "d-1", token: "t" },
  codeOf: (err) => (err instanceof AttestationConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
