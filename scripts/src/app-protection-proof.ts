// App-protection / MAM decision proof — fully OFFLINE and deterministic.
//
// A sensitive app running with NO applied mobile-application-management protection
// policy is not a healthy session, and until this dimension the fabric could not say
// so: the connector emulator scripted `MISSING_MAM_POLICY_SENSITIVE_APP → restrict`
// as an expectation no dimension could produce. This proof pins each axis
// separately: a missing policy on a sensitive app (restrict — corporate data with no
// containment), a missing policy on a standard/unassessed app (step_up), a flagged
// registration on a sensitive app (restrict) and on a standard one (step_up), a
// stale registration (step_up), an app affirmatively out of MAM scope (none — the
// asserted positive), and every unknown raising.
//
// The load-bearing negatives are two. First, this dimension can only RAISE: every
// reachable verdict is fused alongside a device already stepping up and none lowers
// the composed outcome — there is no "a policy is applied, so relax" rung. Second,
// SELECTIVE WIPE is a non-feature: MAM's headline capability is a remote wipe, and
// this connector has no write path at all, asserted by the read-only guard.
import {
  makeDefaultAppProtectionTransport,
  AppProtectionConnector,
  AppProtectionConnectorError,
  createMockAppProtectionTransport,
  deriveApplicability,
  deriveAppSensitivity,
  deriveComplianceState,
  deriveRegistrationFreshness,
  evaluateAppProtection,
  guardReadOnly,
  normalizeAppProtectionReport,
  resolveAppProtectionConnector,
  type AppProtectionReportRaw,
  type NormalizedAppProtection,
} from "@workspace/integrations/app-protection";
import { ACTION_RANK, SIGNAL_KINDS, composeDeviceRisk, fromAppProtection } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";
import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("App-protection / MAM decision proof");

/** Reference instant supplied by the CALLER — the proof's fixed "now". */
const REF = "2026-07-31T22:30:00Z";
const FRESH = "2026-07-31T22:25:00Z"; // read 5 minutes ago
const STALE = "2026-07-31T21:00:00Z"; // read 90 minutes ago
const MAX_AGE = 900; // the caller will act on a registration read up to 15 minutes old

/** The app under evaluation. The report's own `app_ref` must echo it — a report for a
 *  DIFFERENT app is a substitution, not evidence about this one (see the app_ref-mismatch
 *  isolation below). Every fixture and the caller-supplied ref use this same value. */
const APP = "com.hospital.epic";

/** A fully-clean registration: a policy applied, an empty flagged set, read five
 *  minutes ago. Each targeted check below changes exactly ONE field of it. */
const clean = (over: AppProtectionReportRaw = {}): AppProtectionReportRaw => ({
  app_ref: APP,
  policy_state: "applied",
  applied_policies: ["ap-ios-clinical-v4"],
  flagged_reasons: [],
  platform: "ios",
  registration_observed_at: FRESH,
  source_system: "intune",
  ...over,
});

const ev = (
  r: AppProtectionReportRaw,
  appSensitivity: string | undefined = "standard",
  mamApplicability: string | undefined = "applicable",
  referenceTime: string | undefined = REF,
  maxRegistrationAgeSeconds: number | undefined = MAX_AGE,
) =>
  evaluateAppProtection(
    normalizeAppProtectionReport(APP, r, { appSensitivity, mamApplicability, referenceTime, maxRegistrationAgeSeconds }),
  );

// ── the grant ───────────────────────────────────────────────────────────────────
const grant = ev(clean());
check("an applied, clean, current policy → the grant",
  grant.recommendedAction === "none" && grant.reasonCode === "APP_PROTECTED" && grant.appProtected === true);
check("...with no critical findings and no unknowns",
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);

// ── the management plane's own state: is a policy applied? ───────────────────────
// THE HEADLINE, and the emulator reconciliation: a sensitive app with no applied
// policy is exactly what the connector emulator scripts as
// MISSING_MAM_POLICY_SENSITIVE_APP → restrict. Until this dimension nothing in lib/
// produced that; now the real evaluator does, with the same reason string.
const missingSensitive = ev(clean({ policy_state: "not_applied", applied_policies: [] }), "sensitive");
check("a SENSITIVE app with NO applied MAM policy → restrict (MISSING_MAM_POLICY_SENSITIVE_APP): corporate data with no containment — the state the connector emulator scripts, now produced by the real dimension",
  missingSensitive.recommendedAction === "restrict" &&
  missingSensitive.reasonCode === "MISSING_MAM_POLICY_SENSITIVE_APP" &&
  missingSensitive.criticalFindings.includes("mam_policy_not_applied") &&
  missingSensitive.appProtected === false);
const missingStandard = ev(clean({ policy_state: "not_applied", applied_policies: [] }), "standard");
check("a STANDARD app with no applied policy → step_up (MISSING_MAM_POLICY): common before assignment propagates — visible and answerable, not blocked",
  missingStandard.recommendedAction === "step_up" && missingStandard.reasonCode === "MISSING_MAM_POLICY");
const missingUnassessed = ev(clean({ policy_state: "not_applied", applied_policies: [] }), undefined);
check("a missing policy where sensitivity is UNASSESSED → step_up, never restrict — sensitivity only escalates on an explicit 'sensitive'",
  missingUnassessed.recommendedAction === "step_up" && missingUnassessed.reasonCode === "MISSING_MAM_POLICY");
const policyUnknown = ev(clean({ policy_state: undefined }), "sensitive");
check("an ABSENT policy_state → step_up (POLICY_STATE_UNKNOWN), never an assumed 'applied' — silence is not an affirmative, and unknown does not escalate to restrict",
  policyUnknown.recommendedAction === "step_up" && policyUnknown.reasonCode === "POLICY_STATE_UNKNOWN" &&
  policyUnknown.unknownSignals.includes("policy_state"));

// ── the registration's compliance: any flagged reasons? ─────────────────────────
const flaggedSensitive = ev(clean({ flagged_reasons: ["jailbroken"] }), "sensitive");
check("a FLAGGED registration on a SENSITIVE app → restrict (MAM_FLAGGED_SENSITIVE_APP): jailbroken/rooted under a sensitive app is the same severity as no policy",
  flaggedSensitive.recommendedAction === "restrict" && flaggedSensitive.reasonCode === "MAM_FLAGGED_SENSITIVE_APP" &&
  flaggedSensitive.criticalFindings.includes("mam_registration_flagged"));
const flaggedStandard = ev(clean({ flagged_reasons: ["outOfContact"] }), "standard");
check("a FLAGGED registration on a STANDARD app → step_up (APP_PROTECTION_FLAGGED)",
  flaggedStandard.recommendedAction === "step_up" && flaggedStandard.reasonCode === "APP_PROTECTION_FLAGGED");
const complianceUnknown = ev(clean({ flagged_reasons: undefined }), "standard");
check("an ABSENT flagged-reasons field → step_up (COMPLIANCE_UNKNOWN): the plane never posed it, so we cannot call the registration clean",
  complianceUnknown.recommendedAction === "step_up" && complianceUnknown.reasonCode === "COMPLIANCE_UNKNOWN" &&
  complianceUnknown.unknownSignals.includes("compliance_state"));
check("deriveComplianceState maps its cases directly: empty array → clean, non-empty → flagged, absent → unknown, non-array → unknown",
  deriveComplianceState([]) === "clean" && deriveComplianceState(["rooted"]) === "flagged" &&
  deriveComplianceState(undefined) === "unknown" && deriveComplianceState("yes") === "unknown");

// ── the asserted positive: MAM out of scope ─────────────────────────────────────
const notApplicable = ev(clean({ policy_state: "not_applied", applied_policies: [] }), "sensitive", "not_applicable");
check("an app the caller marks NOT_APPLICABLE → none (APP_PROTECTION_NOT_APPLICABLE): out of MAM scope, its missing policy is expected — an asserted positive, distinct from unknown",
  notApplicable.recommendedAction === "none" && notApplicable.reasonCode === "APP_PROTECTION_NOT_APPLICABLE" &&
  notApplicable.appProtected === true);
const applicabilityUnknown = ev(clean({ policy_state: "not_applied", applied_policies: [] }), "sensitive", "huh?");
check("a POSED-but-unreadable applicability → the missing policy still restricts, and applicability is NOT silently excused",
  applicabilityUnknown.recommendedAction === "restrict" &&
  applicabilityUnknown.unknownSignals.includes("mam_applicability"));
check("deriveApplicability maps its cases: applicable/not_applicable literal, absent → unassessed, unreadable → unknown",
  deriveApplicability("applicable") === "applicable" && deriveApplicability("not_applicable") === "not_applicable" &&
  deriveApplicability(undefined) === "unassessed" && deriveApplicability("maybe") === "unknown");
check("deriveAppSensitivity: sensitive/standard literal, absent OR unreadable → unassessed (sensitivity may only escalate on an explicit 'sensitive', never on garbage)",
  deriveAppSensitivity("sensitive") === "sensitive" && deriveAppSensitivity("standard") === "standard" &&
  deriveAppSensitivity(undefined) === "unassessed" && deriveAppSensitivity("critical") === "unassessed");

// ── currency: is the registration evidence about NOW? ───────────────────────────
const stale = ev(clean({ registration_observed_at: STALE }));
check("a registration read 90 minutes ago against a 15-minute maximum → step_up (APP_PROTECTION_STALE)",
  stale.recommendedAction === "step_up" && stale.reasonCode === "APP_PROTECTION_STALE" &&
  stale.criticalFindings.includes("mam_registration_stale"));
check("no maximum age posed → 'unassessed' and still granting; a caller with no recency opinion forecloses nothing",
  normalizeAppProtectionReport(APP, clean(), { appSensitivity: "standard", mamApplicability: "applicable", referenceTime: REF }).registrationFreshness === "unassessed" &&
  ev(clean(), "standard", "applicable", REF, undefined).recommendedAction === "none");
const noObserved = ev(clean({ registration_observed_at: undefined }));
check("a maximum age POSED and no read instant reported → step_up (APP_PROTECTION_TIME_UNKNOWN)",
  noObserved.recommendedAction === "step_up" && noObserved.reasonCode === "APP_PROTECTION_TIME_UNKNOWN" &&
  noObserved.unknownSignals.includes("registration_freshness"));
check("deriveRegistrationFreshness maps its cases: fresh within max, stale beyond, unassessed with no max, unknown on a future-dated read",
  deriveRegistrationFreshness(FRESH, MAX_AGE, REF) === "fresh" &&
  deriveRegistrationFreshness(STALE, MAX_AGE, REF) === "stale" &&
  deriveRegistrationFreshness(FRESH, undefined, REF) === "unassessed" &&
  deriveRegistrationFreshness("2026-07-31T23:00:00Z", MAX_AGE, REF) === "unknown");

// ── malformed and uncovered ─────────────────────────────────────────────────────
const malformed = ev(clean({ flagged_reasons: 5 as unknown as string[] }), "sensitive");
check("a flagged-reasons field asserted as a NON-ARRAY → step_up (REPORT_MALFORMED), and it raises even for a sensitive app — a report we could not parse is never trusted",
  malformed.recommendedAction === "step_up" && malformed.reasonCode === "REPORT_MALFORMED" &&
  malformed.unknownSignals.includes("report_integrity"));
const aliased = ev(clean({ selective_wipe: "pending" } as AppProtectionReportRaw));
check("an unrecognized key (here a would-be WIPE field) makes the report malformed → step_up: this connector understands only its read-only keys",
  aliased.recommendedAction === "step_up" && aliased.reasonCode === "REPORT_MALFORMED");
const uncovered = evaluateAppProtection(
  normalizeAppProtectionReport("a-x", {}, { appSensitivity: "sensitive", mamApplicability: "applicable", referenceTime: REF, maxRegistrationAgeSeconds: MAX_AGE }),
  { covered: false },
);
check("an app with NO registration at all → step_up (NOT_COVERED): an honest hole, not a pass",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── malformed-detection guards, each isolated (mutation-guard falsifiability) ─────
// The `malformed` OR-chain in the normalizer is defence-in-depth: each term is the
// SOLE detector for one wire shape, and the shapes overlap, so the raw enumeration
// above never forces any one term to be the deciding one. These fixtures trip exactly
// ONE term at a time, so a mutation that neutralizes it (`X || → false ||`) flips
// reportIntegrity from malformed to clean and is caught — which is the whole reason
// the guard exists. Read integrity straight off the normalizer; it depends only on the
// parse, not on the posed options.
const integrity = (r: AppProtectionReportRaw): string =>
  normalizeAppProtectionReport("mut", r, { source: "mut" }).reportIntegrity;

// readThrew: a report whose own-value read THROWS (a hostile getter) fails closed via
// the try/catch, even though every key it carries is recognized.
const throwingGetter: AppProtectionReportRaw = {};
Object.defineProperty(throwingGetter, "policy_state", {
  enumerable: true, configurable: true, get() { throw new Error("hostile getter"); },
});
check("malformed-isolation: a report whose field read THROWS → malformed (readThrew), keys all recognized — value reads fail closed",
  integrity(throwingGetter) === "malformed");

// !plain: a null report reaching the normalizer directly (the transport rejects it
// first, but the normalizer must fail closed on its own). No other term fires on null.
check("malformed-isolation: a null report → malformed (!plain) — the shape guard alone must catch it, nothing downstream does",
  normalizeAppProtectionReport("mut", null as unknown as AppProtectionReportRaw, { source: "mut" }).reportIntegrity === "malformed");

// instantShapeBad: a present-but-unparseable observed instant, everything else clean.
check("malformed-isolation: registration_observed_at present but not ISO-8601 Zulu → malformed (instantShapeBad) — an asserted-but-unreadable instant is not silence",
  integrity({ policy_state: "applied", flagged_reasons: [], applied_policies: ["p"], registration_observed_at: "last tuesday" }) === "malformed");

// arrayMalformed(applied_policies): applied_policies asserted as a non-array while
// flagged_reasons is a well-formed array — isolates it from the flagged_reasons term.
// policy_state is not_applied here so the applied-without-policies term below cannot
// also fire and mask a mutation of this one.
check("malformed-isolation: applied_policies asserted as a NON-ARRAY (flagged_reasons well-formed, policy not applied) → malformed — its array guard is load-bearing on its own",
  integrity({ policy_state: "not_applied", flagged_reasons: [], applied_policies: 7 as unknown as string[], registration_observed_at: FRESH }) === "malformed");

// arrayMalformed ELEMENT check (Codex P1): a present array whose element is not a
// non-empty string is unreadable, not a silently-empty set. [5] must not drop to clean.
check("malformed-isolation: flagged_reasons is an array with a NON-STRING element ([5]) → malformed, not clean — a junk flagged element cannot be dropped to an empty set that grants",
  integrity({ policy_state: "not_applied", flagged_reasons: [5] as unknown as string[], applied_policies: ["p"], registration_observed_at: FRESH }) === "malformed");

// appliedWithoutPolicies (Codex P1): policy_state=applied with no policy references is a
// contradiction. Everything else clean, so this term alone decides.
check("malformed-isolation: policy_state=applied with EMPTY applied_policies → malformed — an applied policy with no references is a contradiction, not a grant",
  integrity({ policy_state: "applied", flagged_reasons: [], applied_policies: [], registration_observed_at: FRESH }) === "malformed");

// appRefMismatch (Codex P1): a report echoing a DIFFERENT app than requested is a
// substitution. Requested APP, report says another app; everything else clean.
check("malformed-isolation: report app_ref echoes a DIFFERENT app than requested → malformed — a substituted response cannot be relabeled and granted",
  normalizeAppProtectionReport(APP, clean({ app_ref: "com.other.app" }), { source: "mut" }).reportIntegrity === "malformed");

// asserted-but-unreadable app_ref (Codex P1): a non-string (42) or blank (" ") app_ref
// is asserted yet unreadable — it is not proof the row is this app's, so it fails closed
// rather than being ignored while the record is relabeled with the requested app.
check("malformed-isolation: an asserted NON-STRING app_ref (42) → malformed — an unreadable asserted reference is not evidence the row is this app's",
  normalizeAppProtectionReport(APP, clean({ app_ref: 42 as unknown as string }), { source: "mut" }).reportIntegrity === "malformed");
check("malformed-isolation: an asserted BLANK app_ref (\" \") → malformed",
  normalizeAppProtectionReport(APP, clean({ app_ref: " " }), { source: "mut" }).reportIntegrity === "malformed");

// sparse-hole array (Codex P1): Array.prototype.some SKIPS holes, so a sparse
// flagged_reasons (new Array(1)) would pass element validation and then reduce to an
// empty "nothing" set and grant. Index iteration reads the hole as a junk element.
check("malformed-isolation: a SPARSE flagged_reasons (new Array(1), a hole) → malformed — a hole is a junk element, not a silently-empty set",
  integrity({ policy_state: "applied", flagged_reasons: new Array(1) as unknown as string[], applied_policies: ["p"], registration_observed_at: FRESH }) === "malformed");

// blank REQUESTED appRef (Codex P1): the requested binding must itself name an app. A
// blank/whitespace appRef with a source that OMITS its optional app_ref would otherwise
// normalize an applied+clean report and grant APP_PROTECTED for an UNIDENTIFIED app —
// appRefMismatch cannot catch it (nothing was asserted to mismatch). Fail closed.
const blankReq = (req: string) =>
  evaluateAppProtection(normalizeAppProtectionReport(req, clean({ app_ref: undefined }), { source: "mut" }));
check("a BLANK requested appRef (\"\") with a source that omits app_ref → malformed → step_up, never a grant for an unidentified app",
  normalizeAppProtectionReport("", clean({ app_ref: undefined }), { source: "mut" }).reportIntegrity === "malformed" &&
  blankReq("").recommendedAction === "step_up" && blankReq("").reasonCode === "REPORT_MALFORMED" && blankReq("").appProtected === false);
check("a WHITESPACE requested appRef (\"   \") is likewise blank → malformed → step_up (REPORT_MALFORMED)",
  blankReq("   ").recommendedAction === "step_up" && blankReq("   ").reasonCode === "REPORT_MALFORMED");

// hasUnrecognizedKey catch: a report whose KEY enumeration throws (a hostile proxy)
// fails closed via the catch — the only term that can catch an un-introspectable object.
const hostileKeys = new Proxy({} as AppProtectionReportRaw, { ownKeys() { throw new Error("hostile ownKeys"); } });
check("malformed-isolation: a report whose KEY enumeration throws → malformed (hasUnrecognizedKey catch) — an un-introspectable object cannot be certified clean",
  integrity(hostileKeys) === "malformed");

// impossible calendar date (Codex P1): a well-shaped but non-existent date (Feb 30)
// that Date.parse rolls over must not read as a valid instant and grant as fresh.
check("a registration_observed_at with the ISO shape but an IMPOSSIBLE date (2026-02-30) → malformed, never a valid fresh instant",
  integrity({ policy_state: "not_applied", flagged_reasons: [], applied_policies: ["p"], registration_observed_at: "2026-02-30T00:00:00Z" }) === "malformed");

// worst-concern-wins under malformity (Codex P1): a sensitive app positively reported
// not_applied but carrying an unrecognized key (malformed) must still RESTRICT — the
// malformed raise is a candidate, never a cap that downgrades a confirmed restrict.
const malformedRestrict = ev(clean({ policy_state: "not_applied", applied_policies: [], selective_wipe: "pending" } as AppProtectionReportRaw), "sensitive");
check("a MALFORMED report that also confirms a sensitive missing policy → restrict, not step_up — malformity never lowers a confirmed high-risk verdict",
  malformedRestrict.recommendedAction === "restrict" && malformedRestrict.reasonCode === "MISSING_MAM_POLICY_SENSITIVE_APP");

// not_applicable does NOT suppress a flagged registration (Codex P1): an out-of-scope
// declaration cannot hide a jailbroken/flagged registration — device-integrity evidence
// that also contradicts the out-of-scope claim. Flagged wins over the applicability grant.
const naFlaggedSensitive = ev(clean({ flagged_reasons: ["jailbroken"] }), "sensitive", "not_applicable");
check("a NOT_APPLICABLE sensitive app whose source is FLAGGED → restrict (MAM_FLAGGED_SENSITIVE_APP), not a not-applicable grant — applicability cannot suppress a flagged registration",
  naFlaggedSensitive.recommendedAction === "restrict" && naFlaggedSensitive.reasonCode === "MAM_FLAGGED_SENSITIVE_APP" && naFlaggedSensitive.appProtected === false);
const naFlaggedStandard = ev(clean({ flagged_reasons: ["jailbroken"] }), "standard", "not_applicable");
check("a NOT_APPLICABLE standard app whose source is FLAGGED → step_up (APP_PROTECTION_FLAGGED), never a grant",
  naFlaggedStandard.recommendedAction === "step_up" && naFlaggedStandard.reasonCode === "APP_PROTECTION_FLAGGED");
const naClean = ev(clean({ policy_state: "not_applied", applied_policies: [] }), "sensitive", "not_applicable");
check("a NOT_APPLICABLE app with a clean, un-flagged source still grants (APP_PROTECTION_NOT_APPLICABLE) — the asserted positive is intact",
  naClean.recommendedAction === "none" && naClean.reasonCode === "APP_PROTECTION_NOT_APPLICABLE" && naClean.appProtected === true);

// not_applicable with an UNKNOWN flagged state (Codex P1): the plane never posed
// flagged_reasons, so compliance is unknown — NOT proof the registration is un-flagged.
// Because a flagged registration overrides the out-of-scope declaration (above), an
// unreadable flagged state must raise for the same reason rather than granting.
const naUnknownCompliance = ev(clean({ flagged_reasons: undefined, policy_state: "not_applied", applied_policies: [] }), "standard", "not_applicable");
check("a NOT_APPLICABLE app whose flagged state is UNKNOWN (source omits flagged_reasons) → step_up (COMPLIANCE_UNKNOWN), never an out-of-scope grant",
  naUnknownCompliance.recommendedAction === "step_up" && naUnknownCompliance.reasonCode === "COMPLIANCE_UNKNOWN" &&
  naUnknownCompliance.appProtected === false && naUnknownCompliance.unknownSignals.includes("compliance_state"));

// flagged OUTRANKS malformity in the not_applicable branch (Codex P1): the branch
// short-circuits, so a weaker malformed raise must not cap a confirmed device-integrity
// restrict. A sensitive, out-of-scope, FLAGGED registration that ALSO carries a malformed
// field must still restrict, not downgrade to step_up REPORT_MALFORMED.
const naFlaggedMalformed = ev(clean({ flagged_reasons: ["jailbroken"], selective_wipe: "pending" } as AppProtectionReportRaw), "sensitive", "not_applicable");
check("a NOT_APPLICABLE sensitive app that is FLAGGED and ALSO malformed → restrict (MAM_FLAGGED_SENSITIVE_APP), never downgraded to REPORT_MALFORMED — flagged outranks malformity",
  naFlaggedMalformed.recommendedAction === "restrict" && naFlaggedMalformed.reasonCode === "MAM_FLAGGED_SENSITIVE_APP" && naFlaggedMalformed.appProtected === false);

// the out-of-scope grant requires a CURRENT compliance read when a max age is posed
// (Codex P1): a stale or timestamp-less clean read is not proof the registration is
// unflagged NOW. `unassessed` (no bound) and `fresh` grant; `stale`/`unknown` raise,
// mirroring the applicable path's freshness rungs.
const naStale = ev(clean({ registration_observed_at: STALE, policy_state: "not_applied", applied_policies: [] }), "standard", "not_applicable");
check("a NOT_APPLICABLE app whose clean read is STALE (posed max age exceeded) → step_up (APP_PROTECTION_STALE), never an out-of-scope grant",
  naStale.recommendedAction === "step_up" && naStale.reasonCode === "APP_PROTECTION_STALE" && naStale.appProtected === false);
const naTimeUnknown = ev(clean({ registration_observed_at: undefined, policy_state: "not_applied", applied_policies: [] }), "standard", "not_applicable");
check("a NOT_APPLICABLE app whose read carries NO timestamp while a max age is posed → step_up (APP_PROTECTION_TIME_UNKNOWN), never a grant",
  naTimeUnknown.recommendedAction === "step_up" && naTimeUnknown.reasonCode === "APP_PROTECTION_TIME_UNKNOWN" && naTimeUnknown.appProtected === false);

// ── exhaustive (normalized): grant only on the full conjunction ─────────────────
const normDomains = {
  policyState: ["applied", "not_applied", "unknown"],
  complianceState: ["clean", "flagged", "unknown"],
  appSensitivity: ["sensitive", "standard", "unassessed"],
  mamApplicability: ["applicable", "not_applicable", "unassessed", "unknown"],
  registrationFreshness: ["fresh", "stale", "unknown", "unassessed"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedAppProtection => ({
  sourceSystem: "app-protection", appRef: "enum", source: "enum",
  policyState: c.policyState as NormalizedAppProtection["policyState"],
  complianceState: c.complianceState as NormalizedAppProtection["complianceState"],
  appSensitivity: c.appSensitivity as NormalizedAppProtection["appSensitivity"],
  mamApplicability: c.mamApplicability as NormalizedAppProtection["mamApplicability"],
  registrationFreshness: c.registrationFreshness as NormalizedAppProtection["registrationFreshness"],
  reportIntegrity: c.reportIntegrity as NormalizedAppProtection["reportIntegrity"],
  managedAppRef: null, appliedPolicyRefs: [], flaggedReasons: [], platform: null,
  registrationObservedAt: null, mamSource: null,
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateAppProtection(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.appProtected === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.complianceState === "clean" &&
    (c.registrationFreshness === "fresh" || c.registrationFreshness === "unassessed") &&
    // out-of-scope grants only on a POSITIVELY clean, CURRENT compliance read — a flagged
    // registration is device-integrity evidence the out-of-scope declaration cannot hide,
    // an UNKNOWN flagged state is not proof the registration is un-flagged, and a stale/
    // timestamp-less clean read is not proof it is unflagged now.
    (c.mamApplicability === "not_applicable" ||
      ((c.mamApplicability === "applicable" || c.mamApplicability === "unassessed") &&
        c.policyState === "applied")),
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, an app is protected ONLY on a clean, current report that is either out-of-scope or an applied+clean policy (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 864,
);
check("exhaustive (normalized): exactly 30 states grant — 18 out-of-scope (clean, current) + 12 applied+clean+current",
  normRes.noneCount === 30);

// ── exhaustive (raw wire): normalizer + evaluator on hostile input ──────────────
const rawDomains = {
  policy_state: ["applied", "not_applied", "absent", "enforced"],
  flagged: ["empty", "flagged", "absent", "malformed"],
  observed: ["fresh", "stale", "absent"],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedAppProtection => {
  const raw: AppProtectionReportRaw = {
    app_ref: "com.hospital.epic",
    applied_policies: ["ap-ios-clinical-v4"],
    platform: "ios",
    source_system: "intune",
  };
  if (c.policy_state !== "absent") raw.policy_state = c.policy_state;
  if (c.flagged === "empty") raw.flagged_reasons = [];
  else if (c.flagged === "flagged") raw.flagged_reasons = ["jailbroken"];
  else if (c.flagged === "malformed") raw.flagged_reasons = 5 as unknown as string[];
  if (c.observed === "fresh") raw.registration_observed_at = FRESH;
  else if (c.observed === "stale") raw.registration_observed_at = STALE;
  if (c.__alias === "present") raw.selective_wipe = "pending";
  return normalizeAppProtectionReport(APP, raw, {
    appSensitivity: "standard", mamApplicability: "applicable", referenceTime: REF, maxRegistrationAgeSeconds: MAX_AGE, source: "enum",
  });
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (r) => evaluateAppProtection(r),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.appProtected === true,
  positivelyClean: (c) =>
    c.__alias === "absent" && c.policy_state === "applied" && c.flagged === "empty" && c.observed === "fresh",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw records — a junk policy spelling, a non-array flagged set, an absent read instant and a would-be wipe key — an app is protected only on the fully-clean record (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 96,
);
check("exhaustive (raw wire): exactly ONE raw record grants", rawRes.noneCount === 1);

// ── THE ASYMMETRY, asserted structurally ────────────────────────────────────────
// Fuse EVERY reachable app-protection verdict alongside a device already stepping
// up, and assert the composed outcome never falls below that step_up. A family that
// could relax would show up here as an allow — over the whole state space, not the
// cases somebody thought to write down.
const DEGRADED = { kind: "device_posture" as const, posture: "degraded", action: "step_up" as const, reason: "OS_BEHIND" };
let relaxations = 0;
const emitted = new Set<string>();
for (const policyState of normDomains.policyState) {
  for (const complianceState of normDomains.complianceState) {
    for (const appSensitivity of normDomains.appSensitivity) {
      for (const mamApplicability of normDomains.mamApplicability) {
        for (const registrationFreshness of normDomains.registrationFreshness) {
          for (const reportIntegrity of normDomains.reportIntegrity) {
            const v = evaluateAppProtection(buildNorm({
              policyState, complianceState, appSensitivity, mamApplicability, registrationFreshness, reportIntegrity,
            }));
            emitted.add(v.recommendedAction);
            const composed = composeDeviceRisk([DEGRADED, fromAppProtection(v)]);
            if (ACTION_RANK[composed.strongestAction] < ACTION_RANK["step_up"]) relaxations += 1;
          }
        }
      }
    }
  }
}
check(
  `THE ASYMMETRY, over the whole state space: fused against an already-stepping-up device, not one of the ${normRes.combos} reachable app-protection verdicts lowers the composed outcome (relaxations=${relaxations}) — there is no "a policy is applied, so relax" rung`,
  relaxations === 0,
);
check(
  `...and the only actions this family can emit are ${[...emitted].sort().join("/")} — no rung exists that could buy down another dimension's concern`,
  emitted.size === 3 && emitted.has("none") && emitted.has("step_up") && emitted.has("restrict"),
);

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("app_protection is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("app_protection"));
const fusedMissing = fromAppProtection(missingSensitive);
check("fromAppProtection maps the missing-policy-on-a-sensitive-app verdict onto the unified ladder as restrict",
  fusedMissing.kind === "app_protection" && fusedMissing.action === "restrict" && fusedMissing.reason === "MISSING_MAM_POLICY_SENSITIVE_APP");
// THE HEADLINE. Every other device signal is clean — posture healthy, management
// plane healthy — and the app the worker is using has no MAM policy. Until this
// dimension nothing composed could see it.
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "device_management_health", posture: "healthy", action: "none", reason: "OK" },
  fusedMissing,
]);
check("THE HEADLINE: an otherwise-clean device running a sensitive app with no MAM policy no longer composes to an allow",
  fused.strongestAction === "restrict" && fused.drivers[0]?.kind === "app_protection");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "degraded", action: "step_up", reason: "OS_BEHIND" },
  fromAppProtection(grant),
]);
check("THE ASYMMETRY IN COMPOSITION: a protected app does NOT rescue a degraded device — the dimension contributes `none`, and the step_up stands",
  fusedClean.strongestAction === "step_up" && fusedClean.drivers[0]?.kind === "device_posture");

// ── connector round-trip, read-only guard, live gate ────────────────────────────
const mock = createMockAppProtectionTransport({
  records: { "com.hospital.epic": clean({ policy_state: "not_applied", applied_policies: [] }) },
});
const connector = new AppProtectionConnector({ accessToken: "t", baseUrl: "https://x.invalid", source: "intune" }, mock);
const roundTrip = await connector.fetchNormalized("com.hospital.epic", { appSensitivity: "sensitive", mamApplicability: "applicable", referenceTime: REF, maxRegistrationAgeSeconds: MAX_AGE });
check("the connector fetches and normalizes a registration through an injected transport (no network)",
  roundTrip.policyState === "not_applied" && evaluateAppProtection(roundTrip).reasonCode === "MISSING_MAM_POLICY_SENSITIVE_APP");
const unknownApp = await connector.fetchNormalized("com.unknown.app", { referenceTime: REF, maxRegistrationAgeSeconds: MAX_AGE });
check("an unknown app yields an all-unknown record the evaluator fails closed on (never a fabricated grant)",
  evaluateAppProtection(unknownApp).recommendedAction !== "none");
let guardThrew = false;
try {
  guardReadOnly("DELETE");
} catch (err) {
  guardThrew = err instanceof AppProtectionConnectorError && err.code === "read_only_violation";
}
check("the read-only guard refuses any non-GET method — SELECTIVE WIPE and every other write is structurally impossible",
  guardThrew);

// iterator-lie array (Codex P1): a genuine array whose Symbol.iterator is overridden
// to yield nothing, while index 0 holds "jailbroken". arrayMalformed validates BY INDEX
// (sees the flag), so `stringList` must extract by index too or the two disagree and a
// flagged registration reads `clean` and grants. Pinned to the index-extraction fix.
const iterLie: string[] = ["jailbroken"];
Object.defineProperty(iterLie, Symbol.iterator, { value: function* () {}, enumerable: false });
check("a flagged_reasons array whose Symbol.iterator lies (yields nothing) still reads its INDEXED contents → flagged, never a silently-empty clean grant",
  deriveComplianceState(iterLie) === "flagged");

// fixture transport own-property lookup (Codex P1): an inherited/prototype-polluted
// entry for the requested appRef must NOT be returned and rebound to an unknown app.
const inheritedRecords = Object.create({ "com.hospital.epic": clean() }) as Record<string, AppProtectionReportRaw>;
const inheritMock = createMockAppProtectionTransport({ records: inheritedRecords });
const inheritRaw = await inheritMock({ appRef: "com.hospital.epic", token: "t" });
check("the fixture transport returns ONLY own records — an INHERITED entry yields the empty unknown record, never a rebind to a fabricated grant",
  Object.keys(inheritRaw).length === 0);

// pre-dispatch appRef validation (Codex P1): an invalid reference is refused BEFORE the
// transport GET, so it can never widen the authenticated request to the collection URL
// ("" / ".") or the base origin ("..") or traverse ("a/b"). The transport must not fire.
for (const badRef of ["", "   ", ".", "..", "a/b", "../secret", "com.x/../../etc"]) {
  let dispatched = false;
  const spy = async (): Promise<AppProtectionReportRaw> => {
    dispatched = true;
    return {};
  };
  const guardedConnector = new AppProtectionConnector({ accessToken: "t", baseUrl: "https://x.invalid" }, spy);
  let code: string | undefined;
  try {
    await guardedConnector.fetchNormalized(badRef);
  } catch (err) {
    code = err instanceof AppProtectionConnectorError ? err.code : "other";
  }
  check(
    `an invalid appRef ${JSON.stringify(badRef)} is refused BEFORE dispatch (invalid_app_ref) and the transport is never called`,
    code === "invalid_app_ref" && dispatched === false,
  );
}

checkLiveGateIsolated({
  check,
  family: "app-protection",
  resolve: (env) => resolveAppProtectionConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    APP_PROTECTION_ACCESS_TOKEN: "t",
  },
});

await checkDefaultTransport({
  check,
  family: "app-protection",
  transport: makeDefaultAppProtectionTransport("https://vendor.invalid/app-protection") as (a: never) => Promise<unknown>,
  arg: { appRef: "appRef-1", token: "t" },
  codeOf: (err) => (err instanceof AppProtectionConnectorError ? err.code : undefined),
});

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},gateClauses=4,ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
