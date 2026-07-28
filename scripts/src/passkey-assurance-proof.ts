// Passkey-assurance decision proof — deterministic, offline, fixture-backed.
//
// Proves the doctrine in docs/PASSKEY_ASSURANCE.md: "a passkey is a passkey" is a
// misconception, and the line falls at ATTESTATION rather than at synced-vs-device-
// bound. The checks below pin the three claims that make this dimension worth
// having, each of which a type-only grading would get wrong:
//
//   1. An UNATTESTED device-bound passkey grades the same as a synced one. Grading
//      by credential type alone would grant to it.
//   2. A synced credential's custody is UNKNOWABLE, so it forecloses rather than
//      lowers — no amount of other health reaches the grant.
//   3. User verification decides whether the credential is MFA at all; discouraged
//      is an affirmative bad fact (restrict), not an unknown (step_up).
//
// Plus both grant-safety enumerations (normalized + hostile raw wire), connector
// surface, and fusion.

import {
  evaluatePasskey,
  evaluateIdentityPasskeys,
  normalizeReport,
  guardReadOnly,
  PasskeyAssuranceConnector,
  createMockPasskeyTransport,
  resolvePasskeyConnector,
  type NormalizedPasskey,
  type PasskeyReportRaw,
} from "@workspace/integrations/passkey-assurance";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Passkey-assurance decision proof");

const ev = (r: PasskeyReportRaw, id = "user-1") => evaluatePasskey(normalizeReport(id, r));

/** A fully healthy attested device-bound credential — the grant. */
const GRANT: PasskeyReportRaw = {
  credential_ref: "cred-1",
  registration: "registered",
  credential_type: "device_bound_authenticator",
  attestation: "verified",
  attestation_policy: "enforced",
  user_verification_policy: "required",
  backup: "registered",
};

// ── the grant ───────────────────────────────────────────────────────────────────
const grant = ev(GRANT);
check("attested device-bound + user-verified + backup → the grant",
  grant.recommendedAction === "none" && grant.reasonCode === "ATTESTED_DEVICE_BOUND" && grant.passkeyConfirmed === true);
check("...assurance is attested_phishing_resistant, custody single_device, no findings, no unknowns",
  grant.assurance === "attested_phishing_resistant" && grant.custody === "single_device" &&
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);
const keyGrant = ev({ ...GRANT, credential_type: "security_key" });
check("a FIDO2 security key is the other grant path", keyGrant.recommendedAction === "none" && keyGrant.custody === "single_device");

// ── CLAIM 1: attestation is the boundary, not the credential type ───────────────
const unattestedDeviceBound = ev({ ...GRANT, attestation: "not_provided" });
check("CLAIM 1 — an UNATTESTED device-bound passkey does NOT grant (no device provenance)",
  unattestedDeviceBound.recommendedAction === "step_up" && unattestedDeviceBound.reasonCode === "ATTESTATION_NOT_PROVIDED");
check("...it is graded unattested_phishing_resistant, not attested — the type alone earns nothing",
  unattestedDeviceBound.assurance === "unattested_phishing_resistant" &&
  unattestedDeviceBound.criticalFindings.includes("attestation_not_provided"));
const syncedUnattested = ev({ ...GRANT, credential_type: "synced", attestation: "not_provided", attestation_policy: "not_enforced" });
check("...and a synced credential lands on the SAME rung — the two are equivalent on provenance",
  syncedUnattested.recommendedAction === unattestedDeviceBound.recommendedAction &&
  syncedUnattested.assurance === unattestedDeviceBound.assurance);

// ── CLAIM 2: synced custody is unknowable → it forecloses ──────────────────────
const syncedOtherwisePerfect = ev({
  credential_ref: "cred-1", registration: "registered", credential_type: "synced", attestation: "not_provided",
  attestation_policy: "not_enforced", user_verification_policy: "required", backup: "registered",
});
check("CLAIM 2 — a synced credential healthy on every OTHER axis still cannot grant",
  syncedOtherwisePerfect.recommendedAction !== "none");
check("...because custody is unknowable by construction, tracked as an unknown signal",
  syncedOtherwisePerfect.custody === "unknowable_devices" &&
  syncedOtherwisePerfect.unknownSignals.includes("device_custody"));

// ── CLAIM 3: user verification decides whether it is MFA at all ────────────────
const noUv = ev({ ...GRANT, user_verification_policy: "discouraged" });
check("CLAIM 3 — user verification discouraged → RESTRICT (possession only; not MFA)",
  noUv.recommendedAction === "restrict" && noUv.reasonCode === "USER_VERIFICATION_DISCOURAGED");
check("...it is an AFFIRMATIVE bad fact (a critical finding), not an unknown",
  noUv.criticalFindings.includes("user_verification_discouraged") &&
  !noUv.unknownSignals.includes("user_verification") && noUv.assurance === "possession_only");
const uvUnknown = ev({ ...GRANT, user_verification_policy: "unknown" });
check("...whereas UNREADABLE user verification only raises to step_up — unknown ≠ known-bad",
  uvUnknown.recommendedAction === "step_up" && uvUnknown.criticalFindings.length === 0);

// ── each raising branch pinned INDIVIDUALLY ────────────────────────────────────
// Asserting only the action is not enough to constrain this evaluator. Under
// worst-concern-wins, deleting one branch usually leaves another candidate at the
// same rung, so the action is unchanged and the deletion goes unnoticed — the
// mutation guard reports exactly that as a survivor. Each check below isolates one
// branch (every other axis healthy) and pins the REASON CODE and the evidence it
// records, which is what actually makes the branch load-bearing.
check("branch — user verification unknown names itself and is tracked as an unknown signal",
  uvUnknown.reasonCode === "USER_VERIFICATION_UNKNOWN" && uvUnknown.unknownSignals.includes("user_verification"));
const regUnknown = ev({ ...GRANT, registration: undefined });
check("branch — registration unknown names itself",
  regUnknown.reasonCode === "REGISTRATION_UNKNOWN" && regUnknown.unknownSignals.includes("registration"));
const typeUnknown = ev({ ...GRANT, credential_type: undefined, attestation: "not_provided" });
check("branch — credential type unknown names itself and is tracked as an unknown signal",
  typeUnknown.unknownSignals.includes("credential_type") &&
  (typeUnknown.reasonCode === "CREDENTIAL_TYPE_UNKNOWN" || typeUnknown.reasonCode === "ATTESTATION_NOT_PROVIDED"));
const typeUnknownAlone = ev({ credential_ref: "cred-1", registration: "registered", attestation: "verified", attestation_policy: "not_enforced", user_verification_policy: "required", backup: "registered" });
check("branch — with ONLY the credential type unreadable, that is the reason returned",
  typeUnknownAlone.reasonCode === "CREDENTIAL_TYPE_UNKNOWN" && typeUnknownAlone.recommendedAction === "step_up");
const attUnknown = ev({ ...GRANT, attestation: undefined });
check("branch — attestation unknown names itself and is tracked as an unknown signal",
  attUnknown.reasonCode === "ATTESTATION_UNKNOWN" && attUnknown.unknownSignals.includes("attestation"));
const policyUnknown = ev({ ...GRANT, attestation_policy: undefined });
check("branch — attestation policy unknown names itself and is tracked as an unknown signal",
  policyUnknown.reasonCode === "ATTESTATION_POLICY_UNKNOWN" && policyUnknown.unknownSignals.includes("attestation_policy"));
const backupUnknown = ev({ ...GRANT, backup: undefined });
check("branch — backup unknown is a monitor note that names itself",
  backupUnknown.reasonCode === "BACKUP_UNKNOWN" && backupUnknown.recommendedAction === "monitor" &&
  backupUnknown.unknownSignals.includes("backup"));
// A report that parses every field but carries an extra key: malformed is then the
// ONLY thing wrong, so this isolates the report-integrity branch.
const malformedOnly = ev({ ...GRANT, vendor_label: "passwordless" } as PasskeyReportRaw);
check("branch — a report malformed ONLY by an extra key still fails closed, naming REPORT_MALFORMED",
  malformedOnly.reasonCode === "REPORT_MALFORMED" && malformedOnly.recommendedAction === "step_up" &&
  malformedOnly.unknownSignals.includes("report_integrity"));

// ── claim vs reality: an attestation policy that cannot be in force ────────────
const claimUnenforceable = ev({
  registration: "registered", credential_type: "synced", attestation: "not_provided",
  attestation_policy: "enforced", user_verification_policy: "required", backup: "registered",
});
check("attestation claimed ENFORCED while the credential is synced → alert (the claim is not being applied)",
  claimUnenforceable.recommendedAction === "alert" && claimUnenforceable.reasonCode === "ATTESTATION_CLAIM_UNENFORCEABLE" &&
  claimUnenforceable.criticalFindings.includes("attestation_claim_unenforceable"));
const typeUnknownEnforced = ev({ ...GRANT, credential_type: "unknown", attestation: "unknown", attestation_policy: "enforced" });
check("...but the contradiction is NOT asserted when the credential type is unreadable (no fabricated finding)",
  !typeUnknownEnforced.criticalFindings.includes("attestation_claim_unenforceable") &&
  typeUnknownEnforced.recommendedAction === "step_up");

// ── recovery is graded, at the lowest non-grant rung ───────────────────────────
const noBackup = ev({ ...GRANT, backup: "none" });
check("no backup credential → monitor + recoveryRisk (flagged, not distrusted)",
  noBackup.recommendedAction === "monitor" && noBackup.reasonCode === "BACKUP_MISSING" && noBackup.recoveryRisk === true);

// ── registration + coverage ────────────────────────────────────────────────────
const notReg = ev({ ...GRANT, registration: "none" });
check("no credential registered → step_up", notReg.recommendedAction === "step_up" && notReg.reasonCode === "NOT_REGISTERED");
const uncovered = evaluatePasskey(normalizeReport("u", GRANT), { covered: false });
check("no report for this identity → step_up (NOT_COVERED), never a silent pass",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED" && uncovered.passkeyConfirmed === false);

// ── normalizer integrity ───────────────────────────────────────────────────────
check("an unrecognized key makes the report malformed",
  normalizeReport("x", { ...GRANT, vendor_label: "passwordless" } as PasskeyReportRaw).reportIntegrity === "malformed");
check("an unparseable enum value makes the report malformed",
  normalizeReport("x", { ...GRANT, credential_type: 7 } as unknown as PasskeyReportRaw).reportIntegrity === "malformed");
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeReport("s", "boom" as unknown as PasskeyReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeReport("n", null as unknown as PasskeyReportRaw).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", Object.prototype as PasskeyReportRaw).reportIntegrity === "malformed");
check("case and whitespace are canonicalized, not rejected",
  normalizeReport("cw", { credential_type: " SECURITY_KEY " } as PasskeyReportRaw).credentialType === "security_key");
// Each malformed term pinned SEPARATELY: a report where exactly one field is
// unparseable and everything else is valid. Asserting only "some bad report is
// malformed" would let any one of these terms be deleted unnoticed, because a
// different term would still catch the fixture.
for (const field of ["registration", "credential_type", "attestation", "attestation_policy", "user_verification_policy", "backup"] as const) {
  const oneBad = normalizeReport("mf", { ...GRANT, [field]: "not-a-valid-value" } as PasskeyReportRaw);
  check(`per-field integrity — an unparseable "${field}" alone makes the report malformed`,
    oneBad.reportIntegrity === "malformed");
}
// The throwing-key path: a Proxy whose ownKeys throws must fail closed inside the
// prototype scan rather than propagating an untyped error out of the normalizer.
let scanThrew = false;
const hostileProxy = new Proxy({ ...GRANT }, {
  ownKeys() { throw new Error("ownKeys refused"); },
});
let proxyResult: string | undefined;
try {
  proxyResult = normalizeReport("px", hostileProxy as PasskeyReportRaw).reportIntegrity;
} catch { scanThrew = true; }
check("a report whose key enumeration THROWS is malformed, and the exception never escapes",
  scanThrew === false && proxyResult === "malformed");
// The read-throws path: an accessor that throws must also fail closed.
let accessorThrew = false;
let accessorResult: string | undefined;
const throwingAccessor = Object.defineProperty({ ...GRANT }, "attestation", {
  get() { throw new Error("accessor refused"); }, enumerable: true, configurable: true,
});
try {
  accessorResult = normalizeReport("ac", throwingAccessor as PasskeyReportRaw).reportIntegrity;
} catch { accessorThrew = true; }
check("a report whose accessor THROWS is malformed, and the exception never escapes",
  accessorThrew === false && accessorResult === "malformed");
// The wire-level self-contradiction: synced + verified attestation cannot coexist.
const contradiction = normalizeReport("c", { ...GRANT, credential_type: "synced", attestation: "verified" });
check("synced + attestation VERIFIED is malformed — a synced credential cannot carry device provenance",
  contradiction.reportIntegrity === "malformed");
check("...and it therefore cannot collect the attestation half of the grant",
  evaluatePasskey(contradiction).recommendedAction !== "none");

// ── exhaustive (normalized) ────────────────────────────────────────────────────
const normDomains = {
  registration: ["registered", "none", "unknown"],
  credentialType: ["security_key", "device_bound_authenticator", "synced", "none", "unknown"],
  attestation: ["verified", "not_provided", "unknown"],
  attestationPolicy: ["enforced", "not_enforced", "unknown"],
  userVerification: ["required", "discouraged", "unknown"],
  backup: ["registered", "none", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedPasskey => ({
  sourceSystem: "passkey-assurance", identityRef: "enum", credentialRef: "enum-cred", source: "enum",
  registration: c.registration as NormalizedPasskey["registration"],
  credentialType: c.credentialType as NormalizedPasskey["credentialType"],
  attestation: c.attestation as NormalizedPasskey["attestation"],
  attestationPolicy: c.attestationPolicy as NormalizedPasskey["attestationPolicy"],
  userVerification: c.userVerification as NormalizedPasskey["userVerification"],
  backup: c.backup as NormalizedPasskey["backup"],
  reportIntegrity: c.reportIntegrity as NormalizedPasskey["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluatePasskey,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) =>
    v.passkeyConfirmed === true && v.assurance === "attested_phishing_resistant" &&
    v.custody === "single_device" && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.registration === "registered" &&
    (c.credentialType === "security_key" || c.credentialType === "device_bound_authenticator") &&
    c.attestation === "verified" &&
    c.attestationPolicy !== "unknown" &&
    c.userVerification === "required" &&
    c.backup === "registered",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states the credential is confirmed ONLY when clean + registered + device-held + attested + user-verified + backed up (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 2430,
);
check("exhaustive (normalized): exactly 4 states grant (2 device-held types × 2 readable policy states)",
  normRes.noneCount === 4);
// The headline claim, proven over the whole space rather than one fixture: NO
// synced state anywhere in the enumeration reaches the grant.
const syncedGrants = (() => {
  let n = 0;
  for (const attestation of normDomains.attestation)
    for (const attestationPolicy of normDomains.attestationPolicy)
      for (const userVerification of normDomains.userVerification)
        for (const backup of normDomains.backup)
          for (const reportIntegrity of normDomains.reportIntegrity) {
            const v = evaluatePasskey(buildNorm({
              registration: "registered", credentialType: "synced",
              attestation, attestationPolicy, userVerification, backup, reportIntegrity,
            }));
            if (v.recommendedAction === "none") n += 1;
          }
  return n;
})();
check("exhaustive: ZERO synced states grant, across every combination of the other axes",
  syncedGrants === 0);

// ── exhaustive (raw wire): normalizer + evaluator on hostile input ─────────────
const rawDomains = {
  registration: ["registered", "none", undefined, "junk"],
  credential_type: ["security_key", "device_bound_authenticator", "synced", undefined, 7],
  attestation: ["verified", "not_provided", undefined],
  attestation_policy: ["enforced", "not_enforced", undefined],
  user_verification_policy: ["required", "discouraged", undefined],
  backup: ["registered", "none", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedPasskey => {
  const { __alias, ...wire } = c;
  const raw: PasskeyReportRaw = { credential_ref: "enum-cred" };
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.passwordless = true;
  return normalizeReport("enum", raw, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluatePasskey,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) =>
    v.passkeyConfirmed === true && v.assurance === "attested_phishing_resistant" &&
    v.custody === "single_device" && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  // NOTE: `positivelyClean` receives the enumerated COMBO, not the built/normalized
  // object — so this predicate is written against the WIRE keys and restates the
  // normalizer's own rules. Writing it against normalized field names would silently
  // evaluate `undefined === "..."` for every state, making the predicate uniformly
  // false and the enumeration vacuous rather than failing loudly.
  positivelyClean: (c) =>
    c.__alias === "absent" && // any extra key makes the report malformed
    c.registration === "registered" &&
    (c.credential_type === "security_key" || c.credential_type === "device_bound_authenticator") &&
    c.attestation === "verified" &&
    (c.attestation_policy === "enforced" || c.attestation_policy === "not_enforced") &&
    c.user_verification_policy === "required" &&
    c.backup === "registered",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} hostile reports the grant is reached ONLY by a fully-asserted clean shape (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains),
);
// Guard against a VACUOUS raw enumeration: if the predicate were mis-keyed (the
// defect this proof hit while being written), it would read false everywhere and
// the mismatch count would still be 0 while proving nothing. A non-zero grant count
// is what makes the raw sweep load-bearing.
check("exhaustive (raw wire): the sweep is not vacuous — some hostile-space state does reach the grant",
  rawRes.noneCount === 4);

// ── connector surface ──────────────────────────────────────────────────────────
let refused = false;
try { guardReadOnly("POST"); } catch { refused = true; }
check("connector refuses any non-GET method (read-only by construction)", refused);
const connector = new PasskeyAssuranceConnector(
  { accessToken: "t", baseUrl: "https://idp.local", source: "enum" },
  createMockPasskeyTransport({ reports: { "user-1": GRANT } }),
);
const fetched = await connector.fetchNormalized("user-1");
check("connector normalizes a fixture report", fetched.credentialType === "device_bound_authenticator" && fetched.reportIntegrity === "clean");
const missing = await connector.fetchNormalized("nobody");
check("an unknown identity yields an all-unknown report the evaluator fails closed on",
  missing.registration === "unknown" && evaluatePasskey(missing).recommendedAction !== "none");
const res = resolvePasskeyConnector({ SIGNALGRID_TIER: "dev" } as NodeJS.ProcessEnv);
check("dev tier never resolves a live connector", res.mode === "fixture");
const resProd = resolvePasskeyConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" } as NodeJS.ProcessEnv);
check("prod without a token stays fixture-mode", resProd.mode === "fixture");

// ── IDENTITY level: worst-wins across every registered credential ─────────────
// The fail-open this closes (review finding): the per-credential verdict records
// only THAT a backup exists, not what it is. An attested security key alongside a
// synced backup granted outright, even though the synced credential is a usable
// authentication path and an attacker uses the weakest one on offer.
const primary = normalizeReport("alice", { ...GRANT, credential_ref: "key-1" });
const syncedBackup = normalizeReport("alice", {
  credential_ref: "synced-1", registration: "registered", credential_type: "synced",
  attestation: "not_provided", attestation_policy: "not_enforced",
  user_verification_policy: "required", backup: "registered",
});
check("per-credential: the attested primary alone still grants (its own scope is honest)",
  evaluatePasskey(primary).recommendedAction === "none");
const identity = evaluateIdentityPasskeys([primary, syncedBackup]);
check("IDENTITY — an attested primary plus a SYNCED backup does NOT grant (worst-wins)",
  identity.recommendedAction === "step_up" && identity.identityConfirmed === false);
check("...and it names the weakest credential, so there is something to go fix",
  identity.weakestCredentialRef === "synced-1" && identity.reasonCode === "SYNCED_CUSTODY_UNKNOWABLE");
check("...while still reporting every credential's own verdict",
  identity.credentials.length === 2 && identity.credentials[0].credentialRef === "key-1");
const allGood = evaluateIdentityPasskeys([primary, normalizeReport("alice", { ...GRANT, credential_ref: "key-2" })]);
check("IDENTITY — two sound credentials DO grant (the aggregate is not vacuously strict)",
  allGood.recommendedAction === "none" && allGood.identityConfirmed === true);
const noCreds = evaluateIdentityPasskeys([]);
check("IDENTITY — an empty credential set is NOT a grant; absence of evidence is not confirmation",
  noCreds.recommendedAction === "step_up" && noCreds.identityConfirmed === false && noCreds.reasonCode === "NOT_COVERED");
// credentialRef plumbing
check("a report naming its credential carries that ref onto the verdict",
  evaluatePasskey(primary).credentialRef === "key-1");
check("a non-string credential_ref is malformed, never coerced into an identifier",
  normalizeReport("x", { ...GRANT, credential_ref: 7 } as unknown as PasskeyReportRaw).reportIntegrity === "malformed");

// ── the two binding guards ────────────────────────────────────────────────────
// A verdict that cannot name its subject cannot support the aggregator's claim that
// every usable credential was covered — so an unnamed credential must not grant,
// even when every other axis is perfect (review finding).
const unnamed = ev({ ...GRANT, credential_ref: undefined });
check("a credential with NO reference does not grant, however healthy it otherwise is",
  unnamed.recommendedAction === "step_up" && unnamed.reasonCode === "CREDENTIAL_REF_MISSING" &&
  unnamed.unknownSignals.includes("credential_ref"));
const blankRef = ev({ ...GRANT, credential_ref: "   " });
check("...and a whitespace-only reference is treated the same, not trimmed into validity",
  blankRef.recommendedAction === "step_up" && blankRef.reasonCode === "CREDENTIAL_REF_MISSING");
// An upstream grouping error must fail closed rather than confirm one identity over
// another identity's credentials.
const mixed = evaluateIdentityPasskeys([
  primary,
  normalizeReport("bob", { ...GRANT, credential_ref: "bob-key" }),
]);
check("IDENTITY — a set mixing two identities fails closed instead of confirming the first",
  mixed.recommendedAction === "step_up" && mixed.identityConfirmed === false &&
  mixed.reasonCode === "IDENTITY_SET_INCONSISTENT");
const unnamedIdentity = evaluateIdentityPasskeys([normalizeReport("", { ...GRANT, credential_ref: "k" })]);
check("IDENTITY — an unnamed identity cannot be confirmed either",
  unnamedIdentity.recommendedAction === "step_up" && unnamedIdentity.identityConfirmed === false);

// ── COMPLETENESS: the set must be evidently whole before it confirms ──────────
// Worst-wins is only sound over EVERY usable credential, and nothing previously
// established that the caller supplied them all (review finding).
const loneClaimingBackup = evaluateIdentityPasskeys([primary]);
check("IDENTITY — one report that itself claims a backup exists does NOT confirm (the set contradicts its own contents)",
  loneClaimingBackup.recommendedAction === "step_up" && loneClaimingBackup.identityConfirmed === false &&
  loneClaimingBackup.reasonCode === "CREDENTIAL_SET_INCOMPLETE");
const duplicated = evaluateIdentityPasskeys([primary, primary]);
check("IDENTITY — duplicate credential refs do NOT confirm; one credential twice is not two credentials",
  duplicated.recommendedAction === "step_up" && duplicated.reasonCode === "CREDENTIAL_SET_INCOMPLETE");
const countMismatch = evaluateIdentityPasskeys(
  [primary, normalizeReport("alice", { ...GRANT, credential_ref: "key-2" })],
  { expectedCredentialCount: 3 },
);
check("IDENTITY — an authoritative count that the set does not match fails closed",
  countMismatch.recommendedAction === "step_up" && countMismatch.reasonCode === "CREDENTIAL_SET_INCOMPLETE");
const countMatches = evaluateIdentityPasskeys(
  [primary, normalizeReport("alice", { ...GRANT, credential_ref: "key-2" })],
  { expectedCredentialCount: 2 },
);
check("IDENTITY — a set matching the authoritative count still confirms (completeness is a check, not a veto)",
  countMatches.recommendedAction === "none" && countMatches.identityConfirmed === true);

// End-to-end through the connector: an identity holding TWO credentials of
// different worth, fetched per-credential, aggregated. This is the shape the
// dimension exists for, and it exercises the transport's credentialRef path rather
// than only the pure evaluator.
const multiConnector = new PasskeyAssuranceConnector(
  { accessToken: "t", baseUrl: "https://idp.local", source: "enum" },
  createMockPasskeyTransport({
    credentialReports: {
      "carol/key-1": { ...GRANT, credential_ref: "key-1" },
      "carol/synced-2": {
        credential_ref: "synced-2", registration: "registered", credential_type: "synced",
        attestation: "not_provided", attestation_policy: "not_enforced",
        user_verification_policy: "required", backup: "registered",
      },
    },
  }),
);
const fetchedSet = await multiConnector.fetchNormalizedSet("carol", ["key-1", "synced-2"]);
check("connector fetches a NAMED SET, one report per credential, each keeping its own ref",
  fetchedSet.length === 2 && fetchedSet[0].credentialRef === "key-1" && fetchedSet[1].credentialRef === "synced-2");
const fetchedVerdict = evaluateIdentityPasskeys(fetchedSet, { expectedCredentialCount: 2 });
check("end-to-end — the fetched set does NOT confirm, because one credential is synced",
  fetchedVerdict.recommendedAction === "step_up" && fetchedVerdict.identityConfirmed === false &&
  fetchedVerdict.weakestCredentialRef === "synced-2");

// Determinism.
const d1 = normalizeReport("det", { ...GRANT, credential_type: "synced", attestation: "not_provided" });
check("evaluator is deterministic", JSON.stringify(evaluatePasskey(d1)) === JSON.stringify(evaluatePasskey(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},syncedGrantingCombos=${syncedGrants},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
