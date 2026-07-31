// Bootstrap-credential decision proof — fully OFFLINE and deterministic.
//
// The dimension under test: is this session riding a TEMPORARY bootstrap
// credential (Entra Temporary Access Pass and its peers are the reference
// shape), and is that credential being used the ONLY way a bootstrap
// credential may be used — enrollment/recovery workflow, alive, one-time,
// enrollment-only scope, out-of-band-verified issuance? Every property is a
// place the auth plane silently rots into an unearned affirmative; each one is
// pinned here, plus the exhaustive sweeps proving the clean state is exactly
// the standing-credential conjunction and nothing else.
import {
  deriveLifetimeStanding,
  evaluateBootstrapCredential,
  guardReadOnly,
  normalizeBootstrapReport,
  resolveBootstrapCredentialConnector,
  BootstrapCredentialConnector,
  createMockBootstrapCredentialTransport,
  type BootstrapCredentialReportRaw,
  type NormalizedBootstrapCredential,
  type WorkflowFit,
} from "@workspace/integrations/bootstrap-credential";
import { SIGNAL_KINDS, composeDeviceRisk, fromBootstrapCredential } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Bootstrap-credential decision proof");

/** Reference instant supplied by the CALLER — the proof's fixed "now". */
const REF = "2026-07-31T14:00:00Z";

/** A fully-coherent BOOTSTRAP report: alive at REF, one-time, enrollment-only,
 *  help-desk-verified. Each targeted check changes exactly ONE field of it. */
const bootstrap = (over: BootstrapCredentialReportRaw = {}): BootstrapCredentialReportRaw => ({
  subject_ref: "idp-91c4",
  credential_class: "bootstrap",
  scope: "enrollment_only",
  one_time: "one_time",
  issued_at: "2026-07-31T13:00:00Z",
  expires_at: "2026-07-31T15:00:00Z",
  issuance_verification: "help_desk",
  source_system: "entra-tap",
  ...over,
});

const ev = (r: BootstrapCredentialReportRaw, workflowFit: WorkflowFit = "enrollment_recovery", referenceTime: string | undefined = REF) =>
  evaluateBootstrapCredential(normalizeBootstrapReport("s-1", r, { referenceTime }), { workflowFit });

// ── the clean state: a standing strong credential ───────────────────────────────
const standing = ev({ subject_ref: "idp-91c4", credential_class: "standing", source_system: "entra-tap" });
check("a STANDING strong credential is the clean state — none, confirmed, nothing found, nothing unknown",
  standing.recommendedAction === "none" && standing.posture === "standing_credential" &&
  standing.credentialContextConfirmed === true && standing.criticalFindings.length === 0 &&
  standing.unknownSignals.length === 0);

// ── THE HEADLINE: the scope rule ────────────────────────────────────────────────
const outOfScope = ev(bootstrap(), "operational");
check("THE HEADLINE: a bootstrap pass on an OPERATIONAL workflow → RESTRICT — 'the pass can access only authenticator enrollment or recovery', and a step-up would let the suspect credential answer for itself",
  outOfScope.recommendedAction === "restrict" && outOfScope.posture === "bootstrap_out_of_scope" &&
  outOfScope.reasonCode === "BOOTSTRAP_BEYOND_ENROLLMENT_SCOPE" &&
  outOfScope.criticalFindings.includes("bootstrap_on_operational_workflow"));
check("an UNPOSED workflow under a bootstrap pass fails closed to step_up — silence never widens enrollment-only",
  ev(bootstrap(), "unposed").recommendedAction === "step_up" &&
  ev(bootstrap(), "unposed").reasonCode === "BOOTSTRAP_WORKFLOW_UNPOSED");
const inScope = ev(bootstrap());
check("a bootstrap pass used EXACTLY as intended reads monitor, never none — used perfectly it is still a temporary elevated state, and it NEVER confirms",
  inScope.recommendedAction === "monitor" && inScope.posture === "bootstrap_in_scope" &&
  inScope.credentialContextConfirmed === false);

// ── lifetime: derived, never believed ───────────────────────────────────────────
check("an EXPIRED pass with the session still alive → restrict — revocation did not propagate",
  ev(bootstrap({ expires_at: "2026-07-31T13:30:00Z" })).recommendedAction === "restrict" &&
  ev(bootstrap({ expires_at: "2026-07-31T13:30:00Z" })).reasonCode === "BOOTSTRAP_EXPIRED_IN_USE");
check("out-of-scope AND expired: both restrict, and the scope rule leads (first-pushed wins among equals — pinned ordering)",
  ev(bootstrap({ expires_at: "2026-07-31T13:30:00Z" }), "operational").reasonCode === "BOOTSTRAP_BEYOND_ENROLLMENT_SCOPE");
check("NO expiry at all is `unbounded` — 'shortest practical' was not practiced; step_up, visibly, never a default pass",
  ev(bootstrap({ expires_at: undefined })).recommendedAction === "step_up" &&
  ev(bootstrap({ expires_at: undefined })).reasonCode === "BOOTSTRAP_UNBOUNDED_LIFETIME" &&
  ev(bootstrap({ expires_at: undefined })).criticalFindings.includes("no_expiry_on_bootstrap_pass"));
check("an expiry POSED but no reference instant → lifetime unknown, raises",
  evaluateBootstrapCredential(normalizeBootstrapReport("s-1", bootstrap(), {}), { workflowFit: "enrollment_recovery" })
    .reasonCode === "BOOTSTRAP_LIFETIME_UNKNOWN");
check("lifetime boundaries: alive THROUGH the expiry instant inclusive; expired the millisecond after; expires-before-issued is a wire contradiction (malformed), not merely unknown",
  deriveLifetimeStanding(null, Date.parse("2026-07-31T14:00:00Z"), Date.parse("2026-07-31T14:00:00Z")) === "within_lifetime" &&
  deriveLifetimeStanding(null, Date.parse("2026-07-31T14:00:00Z"), Date.parse("2026-07-31T14:00:00.001Z")) === "expired" &&
  ev(bootstrap({ issued_at: "2026-07-31T16:00:00Z" })).reasonCode === "REPORT_MALFORMED");

// ── issuance defects: the PASS is wrong, not just this session ──────────────────
check("a pass MINTED BROAD → alert — an issuance defect someone upstream must see; it outranks every step_up on the record",
  ev(bootstrap({ scope: "broad" })).recommendedAction === "alert" &&
  ev(bootstrap({ scope: "broad" })).reasonCode === "BOOTSTRAP_MINTED_BROAD");
check("LOCATION as the SOLE issuance factor → alert — location may corroborate an issuance, never carry it alone (the row-17 rule mechanical)",
  ev(bootstrap({ issuance_verification: "location_only" })).recommendedAction === "alert" &&
  ev(bootstrap({ issuance_verification: "location_only" })).reasonCode === "LOCATION_SOLE_ISSUANCE_FACTOR" &&
  ev(bootstrap({ issuance_verification: "location_only" })).criticalFindings.includes("location_sole_issuance_factor"));
check("a REUSABLE 'one-time' pass → step_up — weaker than the mechanism promises, visibly",
  ev(bootstrap({ one_time: "reusable" })).recommendedAction === "step_up" &&
  ev(bootstrap({ one_time: "reusable" })).reasonCode === "BOOTSTRAP_NOT_ONE_TIME");

// ── unknowns raise, everywhere ──────────────────────────────────────────────────
check("unknown credential class / scope / one-time / issuance each raise with their own reason",
  ev({ subject_ref: "s" }).reasonCode === "CREDENTIAL_CLASS_UNKNOWN" &&
  ev(bootstrap({ scope: undefined })).reasonCode === "SCOPE_UNKNOWN" &&
  ev(bootstrap({ one_time: undefined })).reasonCode === "ONE_TIME_UNKNOWN" &&
  ev(bootstrap({ issuance_verification: undefined })).reasonCode === "ISSUANCE_UNKNOWN");
check("EVERY out-of-band issuance method carries the coherent pass to monitor — manager, in-person, and PIV/CAC verified passes are not second-class to help_desk",
  ev(bootstrap({ issuance_verification: "manager" })).recommendedAction === "monitor" &&
  ev(bootstrap({ issuance_verification: "in_person" })).recommendedAction === "monitor" &&
  ev(bootstrap({ issuance_verification: "piv_cac" })).recommendedAction === "monitor");
check("a session the IdP has no record of is NOT_COVERED → step_up — an honest hole, not a pass",
  evaluateBootstrapCredential(normalizeBootstrapReport("s-1", {}, { referenceTime: REF }), { covered: false }).reasonCode === "NOT_COVERED");

// ── the wire is hostile ─────────────────────────────────────────────────────────
check("an unrecognized key, a junk enum spelling, a junk instant, a non-object report and a throwing proxy are all malformed → step_up",
  ev(bootstrap({ pass_hint: "leak" } as BootstrapCredentialReportRaw)).reasonCode === "REPORT_MALFORMED" &&
  ev(bootstrap({ credential_class: "temporary" })).reasonCode === "REPORT_MALFORMED" &&
  ev(bootstrap({ expires_at: "tomorrow" })).reasonCode === "REPORT_MALFORMED" &&
  ev("bootstrap" as unknown as BootstrapCredentialReportRaw).reasonCode === "REPORT_MALFORMED" &&
  ev(new Proxy({}, { ownKeys: () => { throw new Error("hostile"); } }) as BootstrapCredentialReportRaw).reasonCode === "REPORT_MALFORMED");
check("a junk SCOPE, ONE-TIME, or ISSUANCE spelling is malformed — never quietly coerced to the unknown rung",
  ev(bootstrap({ scope: "wide" })).reasonCode === "REPORT_MALFORMED" &&
  ev(bootstrap({ one_time: "multi" })).reasonCode === "REPORT_MALFORMED" &&
  ev(bootstrap({ issuance_verification: "vibes" })).reasonCode === "REPORT_MALFORMED");
check("a report whose property GETTER throws, and Object.prototype itself posing as a report, are both malformed",
  ev((() => { const r: Record<string, unknown> = {}; Object.defineProperty(r, "credential_class", { enumerable: true, get() { throw new Error("hostile getter"); } }); return r as BootstrapCredentialReportRaw; })()).reasonCode === "REPORT_MALFORMED" &&
  ev(Object.prototype as BootstrapCredentialReportRaw).reasonCode === "REPORT_MALFORMED");
check("enum spellings are case/whitespace-folded; an inherited key is the prototype's claim, not this report's (and is refused as unrecognized)",
  ev(bootstrap({ credential_class: " Bootstrap " })).posture === "bootstrap_in_scope" &&
  ev(Object.create({ pass_hint: "leak" }, Object.getOwnPropertyDescriptors(bootstrap())) as BootstrapCredentialReportRaw).reasonCode === "REPORT_MALFORMED");
const norm = normalizeBootstrapReport("s-1", bootstrap(), { referenceTime: REF });
check("evidence is carried verbatim or null — never a fabricated placeholder",
  norm.idpSubjectRef === "idp-91c4" && norm.expiresAt === "2026-07-31T15:00:00Z" &&
  norm.referenceTime === REF && norm.idpSource === "entra-tap" &&
  normalizeBootstrapReport("s-1", bootstrap({ expires_at: "tomorrow" }), { referenceTime: REF }).expiresAt === null);

// ── the gate: four clauses, all mandatory ───────────────────────────────────────
const armed = {
  SIGNALGRID_TIER: "beta",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  BOOTSTRAP_CREDENTIAL_ACCESS_TOKEN: "tok",
} as NodeJS.ProcessEnv;
check("fully armed env resolves live", resolveBootstrapCredentialConnector(armed).mode === "live");
check("dev tier never makes live calls, whatever else is set",
  resolveBootstrapCredentialConnector({ ...armed, SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("the live flag must be the exact lowercase string 'true'",
  resolveBootstrapCredentialConnector({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE" }).mode === "fixture");
check("a missing or blank credential resolves fixture",
  resolveBootstrapCredentialConnector({ ...armed, BOOTSTRAP_CREDENTIAL_ACCESS_TOKEN: "  " }).mode === "fixture");
check("an empty env resolves fixture with a stated reason",
  resolveBootstrapCredentialConnector({} as NodeJS.ProcessEnv).mode === "fixture");
check("the connector is read-only: a non-GET is refused at the guard",
  (() => { try { guardReadOnly("POST"); return false; } catch { return true; } })());

// ── the connector end-to-end over the fixture transport ─────────────────────────
const mockConn = new BootstrapCredentialConnector(
  { accessToken: "tok", baseUrl: "https://idp.local" },
  createMockBootstrapCredentialTransport({ reports: { "s-1": bootstrap() } }),
);
check("fetchNormalized normalizes the fixture report deterministically (an unknown subject yields the all-unknown empty report)",
  await mockConn.fetchNormalized("s-1", { referenceTime: REF }).then((r) => r.credentialClass === "bootstrap") &&
  await mockConn.fetchNormalized("s-9", { referenceTime: REF }).then((r) => r.credentialClass === "unknown"));

// ── exhaustive (normalized): the clean state is standing, and ONLY standing ─────
const normDomains = {
  credentialClass: ["standing", "bootstrap", "unknown"],
  workflowFit: ["enrollment_recovery", "operational", "unposed"],
  scope: ["enrollment_only", "broad", "unknown"],
  oneTime: ["one_time", "reusable", "unknown"],
  lifetime: ["within_lifetime", "expired", "unbounded", "unknown"],
  issuanceVerification: ["help_desk", "location_only", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>) => ({
  report: {
    sourceSystem: "bootstrap-credential", subjectRef: "enum", source: "enum",
    credentialClass: c.credentialClass as NormalizedBootstrapCredential["credentialClass"],
    scope: c.scope as NormalizedBootstrapCredential["scope"],
    oneTime: c.oneTime as NormalizedBootstrapCredential["oneTime"],
    lifetime: c.lifetime as NormalizedBootstrapCredential["lifetime"],
    issuanceVerification: c.issuanceVerification as NormalizedBootstrapCredential["issuanceVerification"],
    reportIntegrity: c.reportIntegrity as NormalizedBootstrapCredential["reportIntegrity"],
    idpSubjectRef: null, issuedAt: null, expiresAt: null, referenceTime: null, idpSource: null,
  } satisfies NormalizedBootstrapCredential,
  fit: c.workflowFit as WorkflowFit,
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (b) => evaluateBootstrapCredential(b.report, { workflowFit: b.fit }),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.credentialContextConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) => c.reportIntegrity === "clean" && c.credentialClass === "standing",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, credential context is confirmed ONLY for a cleanly-parsed STANDING credential — every bootstrap combination reads monitor or worse (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 1944,
);
check("exhaustive (normalized): the granting states are exactly the standing block — the bootstrap axes cannot manufacture a grant",
  normRes.noneCount === 324);

// ── exhaustive (raw wire): normalizer + evaluator on hostile input ──────────────
const rawDomains = {
  credential_class: ["standing", "bootstrap", "temporary", undefined],
  scope: ["enrollment_only", "broad", undefined],
  one_time: ["one_time", "reusable", undefined],
  expires_at: ["2026-07-31T15:00:00Z", "2026-07-31T13:30:00Z", "tomorrow", undefined],
  issuance_verification: ["help_desk", "location_only", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>) => {
  const { __alias, ...wire } = c;
  const raw: BootstrapCredentialReportRaw = { subject_ref: "idp-91c4", issued_at: "2026-07-31T13:00:00Z", source_system: "entra-tap" };
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.temporary_pass_note = "aside";
  return normalizeBootstrapReport("enum", raw, { referenceTime: REF, source: "enum" });
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: (r) => evaluateBootstrapCredential(r, { workflowFit: "enrollment_recovery" }),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.credentialContextConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.credential_class === "standing" &&
    c.expires_at !== "tomorrow",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — a junk class spelling, a junk instant, an expired pass, a broad mint, a location-sole issuance and an aliased key — the clean state is reachable only by a cleanly-parsed standing credential (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 864,
);

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("bootstrap_credential is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("bootstrap_credential"));
const fusedOutOfScope = fromBootstrapCredential(outOfScope);
check("fromBootstrapCredential maps the scope violation onto the unified ladder",
  fusedOutOfScope.kind === "bootstrap_credential" && fusedOutOfScope.action === "restrict");
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "identity", posture: "verified", action: "none", reason: "OK" },
  fusedOutOfScope,
]);
check("THE COMPOSED HEADLINE: a healthy device and a verified identity no longer compose to an allow when the session's own credential is a bootstrap pass beyond its scope",
  fused.strongestAction === "restrict" && fused.drivers[0]?.kind === "bootstrap_credential");
check("...and a standing credential contributes none — the dimension never lowers, only raises",
  composeDeviceRisk([
    { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
    fromBootstrapCredential(standing),
  ]).strongestAction === "none");

// Determinism.
check("evaluator is deterministic",
  JSON.stringify(ev(bootstrap(), "operational")) === JSON.stringify(ev(bootstrap(), "operational")));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},gateClauses=4,ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
