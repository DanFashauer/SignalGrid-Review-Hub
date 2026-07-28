// Platform-SSO decision proof — fully OFFLINE and deterministic.
//
// "Platform SSO can be passwordless. It can also satisfy MFA. Neither result is
// automatic." The METHOD the IdP extension implements decides the credential's
// worth, and this proof pins the doctrine: only a user-registered Secure Enclave
// key / smart card on a clean report is phishing-resistant; the Password method is
// password-grade (legitimate, policy-capable, monitor — never a grant); macOS 27
// web-based flows are pre-release and never grant. THE compatibility detail:
// Require Authentication is only compatible with the Password method — claimed on
// any other method it is config drift (alert), because the tenant believes a
// control is enforced that the OS is not enforcing. A policy genuinely in force
// carries lockout exposure (expired/unconfigured grace, missing break-glass).
import {
  PlatformSsoConnector,
  PlatformSsoConnectorError,
  createMockPlatformSsoTransport,
  evaluatePlatformSso,
  guardReadOnly,
  normalizeReport,
  type PlatformSsoReportRaw,
  type NormalizedPlatformSso,
} from "@workspace/integrations/platform-sso";
import { SIGNAL_KINDS, composeDeviceRisk, fromPlatformSso } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Platform-SSO decision proof");

const ev = (r: PlatformSsoReportRaw, id = "mac-1") => evaluatePlatformSso(normalizeReport(id, r));

// ── the method decides the credential's worth ───────────────────────────────────
const sek = ev({ registration: "user", method: "secure_enclave_key", login_policy: "not_required" });
check("user-registered Secure Enclave key, no policy claimed → the grant (phishing-resistant confirmed)",
  sek.recommendedAction === "none" && sek.reasonCode === "PHISHING_RESISTANT_CONFIRMED" && sek.ssoConfirmed === true);
check("...assurance is phishing_resistant with no findings and no unknowns",
  sek.assurance === "phishing_resistant" && sek.criticalFindings.length === 0 && sek.unknownSignals.length === 0);
const sc = ev({ registration: "user", method: "smart_card", login_policy: "not_required" });
check("smart card is the other hardware-backed grant path", sc.recommendedAction === "none" && sc.assurance === "phishing_resistant");
const pwd = ev({ registration: "user", method: "password_sync", login_policy: "not_required" });
check("Password method → monitor, assurance password_grade — legitimate, org-chosen, never phishing-resistant",
  pwd.recommendedAction === "monitor" && pwd.reasonCode === "PASSWORD_GRADE_METHOD" && pwd.assurance === "password_grade");
const web = ev({ registration: "user", method: "web_based", login_policy: "not_required" });
check("macOS 27 web-based method → step_up (pre-release; a preview never grants)",
  web.recommendedAction === "step_up" && web.reasonCode === "PREVIEW_METHOD_NEVER_GRANTS");

// ── registration must be positively established ─────────────────────────────────
const noReg = ev({ registration: "none", method: "secure_enclave_key", login_policy: "not_required" });
check("not registered → step_up regardless of the method on offer", noReg.recommendedAction === "step_up" && noReg.reasonCode === "NOT_REGISTERED");
const devOnly = ev({ registration: "device_only", method: "secure_enclave_key", login_policy: "not_required" });
check("device registered but USER not → step_up (the user credential is not established)",
  devOnly.recommendedAction === "step_up" && devOnly.reasonCode === "USER_NOT_REGISTERED");
check("...and assurance stays unknown — a device registration is not a user credential", devOnly.assurance === "unknown");

// ── THE compatibility detail: policy claimed on an incompatible method ──────────
const drift = ev({ registration: "user", method: "secure_enclave_key", login_policy: "required" });
check("Require Authentication claimed on the Secure Enclave method → alert (the policy CANNOT be in force — config drift)",
  drift.recommendedAction === "alert" && drift.reasonCode === "POLICY_INCOMPATIBLE_WITH_METHOD" && drift.criticalFindings.includes("policy_incompatible_with_method"));
check("...and it is NOT a lockout risk — an unenforceable policy cannot strand anyone", drift.lockoutRisk === false);
// The incompatibility is asserted only for a KNOWN non-Password method (review
// finding): with the method unreadable, claiming "the policy contradicts the
// method" fabricates a finding the report never made.
const driftUnknownMethod = ev({ registration: "user", login_policy: "required" });
check("Require Authentication with the method UNREADABLE → step_up METHOD_UNKNOWN, never the affirmative incompatibility alert",
  driftUnknownMethod.recommendedAction === "step_up" && driftUnknownMethod.reasonCode === "METHOD_UNKNOWN" && driftUnknownMethod.criticalFindings.length === 0);

// ── a policy genuinely in force carries lockout exposure ────────────────────────
const graceOk = ev({ registration: "user", method: "password_sync", login_policy: "required", offline_grace: "valid", break_glass: "exempt_configured" });
check("policy in force + valid grace + break-glass exempted → monitor only (the password-grade note), lockoutRisk false",
  graceOk.recommendedAction === "monitor" && graceOk.lockoutRisk === false);
const graceExpired = ev({ registration: "user", method: "password_sync", login_policy: "required", offline_grace: "expired", break_glass: "exempt_configured" });
check("policy in force + EXPIRED offline grace → alert + lockoutRisk (an offline Mac cannot use the local password)",
  graceExpired.recommendedAction === "alert" && graceExpired.reasonCode === "OFFLINE_GRACE_EXPIRED" && graceExpired.lockoutRisk === true && graceExpired.criticalFindings.includes("offline_grace_expired"));
const graceMissing = ev({ registration: "user", method: "password_sync", login_policy: "required", offline_grace: "not_configured", break_glass: "exempt_configured" });
check("policy in force + grace NEVER configured → alert + lockoutRisk", graceMissing.recommendedAction === "alert" && graceMissing.reasonCode === "OFFLINE_GRACE_NOT_CONFIGURED" && graceMissing.lockoutRisk === true);
const noBreakGlass = ev({ registration: "user", method: "password_sync", login_policy: "required", offline_grace: "valid", break_glass: "none" });
check("policy in force + NO break-glass exemption → alert + lockoutRisk (exempt one BEFORE enforcement; the grace window is not a recovery path)",
  noBreakGlass.recommendedAction === "alert" && noBreakGlass.reasonCode === "BREAK_GLASS_MISSING" && noBreakGlass.lockoutRisk === true);
const graceUnknown = ev({ registration: "user", method: "password_sync", login_policy: "required", break_glass: "exempt_configured" });
check("policy in force + grace state unreadable → step_up (cannot verify the recovery posture)",
  graceUnknown.recommendedAction === "step_up" && graceUnknown.unknownSignals.includes("offline_grace"));

// ── unknowns raise, never grant ─────────────────────────────────────────────────
const noPolicy = ev({ registration: "user", method: "secure_enclave_key" });
check("policy state unreadable → step_up (POLICY_UNKNOWN) even on a hardware-backed method",
  noPolicy.recommendedAction === "step_up" && noPolicy.reasonCode === "POLICY_UNKNOWN");
const noMethod = ev({ registration: "user", login_policy: "not_required" });
check("method unreadable → step_up, assurance unknown", noMethod.recommendedAction === "step_up" && noMethod.assurance === "unknown");
const regUnknown = ev({ method: "secure_enclave_key", login_policy: "not_required" });
check("registration state unreadable → step_up AS registration-unknown (its own reason, not the backstop's)",
  regUnknown.recommendedAction === "step_up" && regUnknown.reasonCode === "REGISTRATION_UNKNOWN" && regUnknown.unknownSignals.includes("registration"));
const bgUnknown = ev({ registration: "user", method: "password_sync", login_policy: "required", offline_grace: "valid" });
check("policy in force + break-glass state unreadable → step_up (cannot verify the recovery posture), never just the password-grade monitor",
  bgUnknown.recommendedAction === "step_up" && bgUnknown.reasonCode === "BREAK_GLASS_UNKNOWN" && bgUnknown.unknownSignals.includes("break_glass"));
const uncovered = evaluatePlatformSso(
  normalizeReport("m", { registration: "user", method: "secure_enclave_key", login_policy: "not_required" }),
  { covered: false });
check("no Platform SSO report returned (covered=false) → step_up, never a confirmation",
  uncovered.recommendedAction === "step_up" && uncovered.reasonCode === "NOT_COVERED");

// ── malformed / hostile report shapes ───────────────────────────────────────────
// Per-field integrity: each asserted-but-unparseable field must mark the report
// MALFORMED on its own (one junk field per report, everything else valid — a report
// with several junk fields would let one integrity term hide behind another, which
// is exactly the unfalsifiability the mutation guard exists to catch).
const junkEnum = ev({ registration: "user", method: "totally-passwordless", login_policy: "not_required" });
check("junk method alone → malformed, cannot grant, never phishing-resistant",
  normalizeReport("j1", { registration: "user", method: "totally-passwordless", login_policy: "not_required" }).reportIntegrity === "malformed" &&
  junkEnum.recommendedAction !== "none" && junkEnum.assurance !== "phishing_resistant");
check("junk registration alone → malformed",
  normalizeReport("j2", { registration: "sorta", method: "secure_enclave_key", login_policy: "not_required" }).reportIntegrity === "malformed");
check("junk login_policy alone → malformed",
  normalizeReport("j3", { registration: "user", method: "secure_enclave_key", login_policy: "maybe" }).reportIntegrity === "malformed");
check("junk offline_grace alone → malformed",
  normalizeReport("j4", { registration: "user", method: "password_sync", login_policy: "required", offline_grace: "soon", break_glass: "exempt_configured" }).reportIntegrity === "malformed");
check("junk break_glass alone → malformed",
  normalizeReport("j5", { registration: "user", method: "password_sync", login_policy: "required", offline_grace: "valid", break_glass: "who" }).reportIntegrity === "malformed");
const extraKey = normalizeReport("x", { registration: "user", method: "secure_enclave_key", login_policy: "not_required", passwordless: true } as PlatformSsoReportRaw);
// The refusal must come from the INTEGRITY branch itself (REPORT_MALFORMED), not
// merely from the grant backstop — a malformed report whose fields all parse valid
// is exactly the state only the integrity branch can name.
check("an unrecognized key (a vendor 'passwordless' flag we would never trust) refuses AS malformed (not via the backstop)",
  extraKey.reportIntegrity === "malformed" && evaluatePlatformSso(extraKey).reasonCode === "REPORT_MALFORMED" && evaluatePlatformSso(extraKey).recommendedAction !== "none");
check("...and a MALFORMED report asserting user+SEK never reads assurance phishing_resistant",
  evaluatePlatformSso(extraKey).assurance === "unknown");
// With method AND policy both unknown, the method reason still leads (pins the
// method branch as load-bearing — the backstop alone would surface POLICY_UNKNOWN).
const psBothUnknown = ev({ registration: "user" });
check("method unknown + policy unknown → the METHOD_UNKNOWN reason leads",
  psBothUnknown.recommendedAction === "step_up" && psBothUnknown.reasonCode === "METHOD_UNKNOWN");
const inherited = evaluatePlatformSso(normalizeReport("i", Object.create({ registration: "user", method: "secure_enclave_key", login_policy: "not_required" }) as PlatformSsoReportRaw));
check("a report with ZERO own keys asserts nothing and cannot grant", inherited.recommendedAction !== "none");
const hidden = new Proxy({ registration: "user", method: "secure_enclave_key", login_policy: "not_required" }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as PlatformSsoReportRaw;
check("a Proxy hiding its own descriptors reads as absent and cannot grant",
  evaluatePlatformSso(normalizeReport("px", hidden)).recommendedAction !== "none");
const throwingKeys = new Proxy({ registration: "user", method: "secure_enclave_key", login_policy: "not_required" }, { ownKeys: () => { throw new Error("hostile"); } }) as PlatformSsoReportRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluatePlatformSso(normalizeReport("tk", throwingKeys)).recommendedAction !== "none");
const throwingAccessor = { method: "secure_enclave_key", login_policy: "not_required" } as PlatformSsoReportRaw;
Object.defineProperty(throwingAccessor, "registration", { enumerable: true, get() { throw new Error("boom"); } });
let accessorThrew = false;
try {
  check("a throwing ACCESSOR fails closed to malformed without an exception",
    normalizeReport("ta", throwingAccessor).reportIntegrity === "malformed" && evaluatePlatformSso(normalizeReport("ta2", throwingAccessor)).recommendedAction !== "none");
} catch { accessorThrew = true; }
check("...and no exception escaped the normalizer", accessorThrew === false);
check("a non-object report body is malformed, not a thrown TypeError",
  normalizeReport("s", "boom" as unknown as PlatformSsoReportRaw).reportIntegrity === "malformed");
check("a null report body is malformed, not a thrown TypeError",
  normalizeReport("n", null as unknown as PlatformSsoReportRaw).reportIntegrity === "malformed");
check("Object.prototype itself as the report is malformed (polluted-prototype fields must never read as own assertions)",
  normalizeReport("op", Object.prototype as PlatformSsoReportRaw).reportIntegrity === "malformed");
check("case and whitespace are canonicalized, not rejected",
  normalizeReport("cw", { method: " SECURE_ENCLAVE_KEY " } as PlatformSsoReportRaw).method === "secure_enclave_key");

// ── exhaustive (normalized): the grant is clean + user + hardware-backed + no policy ──
const normDomains = {
  registration: ["user", "device_only", "none", "unknown"],
  method: ["secure_enclave_key", "smart_card", "password_sync", "web_based", "none", "unknown"],
  loginPolicy: ["required", "not_required", "unknown"],
  offlineGrace: ["valid", "expired", "not_configured", "unknown"],
  breakGlass: ["exempt_configured", "none", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedPlatformSso => ({
  sourceSystem: "platform-sso", deviceRef: "enum", source: "enum",
  registration: c.registration as NormalizedPlatformSso["registration"],
  method: c.method as NormalizedPlatformSso["method"],
  loginPolicy: c.loginPolicy as NormalizedPlatformSso["loginPolicy"],
  offlineGrace: c.offlineGrace as NormalizedPlatformSso["offlineGrace"],
  breakGlass: c.breakGlass as NormalizedPlatformSso["breakGlass"],
  reportIntegrity: c.reportIntegrity as NormalizedPlatformSso["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluatePlatformSso,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.ssoConfirmed === true && v.assurance === "phishing_resistant" && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.registration === "user" &&
    (c.method === "secure_enclave_key" || c.method === "smart_card") &&
    c.loginPolicy === "not_required",
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, SSO is confirmed ONLY when clean + user-registered + hardware-backed + no policy claimed (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 1728,
);
check("exhaustive (normalized): exactly 24 states grant (2 hardware methods × 4 grace × 3 break-glass — both moot without a policy, the pinned doctrine)",
  normRes.noneCount === 24);

// ── exhaustive (raw wire): the normalizer + evaluator on hostile input ───────────
const rawDomains = {
  registration: ["user", "device_only", "none", undefined, "junk"],
  method: ["secure_enclave_key", "password_sync", "web_based", undefined, 7],
  login_policy: ["required", "not_required", undefined],
  offline_grace: ["valid", "expired", undefined],
  break_glass: ["exempt_configured", "none", undefined],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedPlatformSso => {
  const { __alias, ...wire } = c;
  const raw: PlatformSsoReportRaw = {};
  for (const [k, v] of Object.entries(wire)) if (v !== undefined) raw[k] = v;
  if (__alias === "present") raw.passwordless = true;
  return normalizeReport("enum", raw, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluatePlatformSso,
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.ssoConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" &&
    c.registration === "user" &&
    c.method === "secure_enclave_key" &&
    c.login_policy === "not_required",
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw reports — junk enums, numbers, a vendor 'passwordless' alias key — SSO is confirmed only on fully-clean user+SEK+no-policy reports (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 1350,
);
check("exhaustive (raw wire): exactly 9 raw reports grant (3 grace × 3 break-glass states, all moot without a policy)",
  rawRes.noneCount === 9);

// ── connector surface (mutation-guard coverage: every guard falsifiable) ────────
let psReadOnly = false;
try { guardReadOnly("POST"); } catch (err) { psReadOnly = err instanceof PlatformSsoConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", psReadOnly);
const psConn = new PlatformSsoConnector(
  { accessToken: "t", baseUrl: "https://inventory.example" },
  createMockPlatformSsoTransport({ reports: { "mac-9": { registration: "user", method: "secure_enclave_key", login_policy: "not_required" } } }),
);
check("the connector round-trip normalizes a clean report end to end (grantable)",
  evaluatePlatformSso(await psConn.fetchNormalized("mac-9")).recommendedAction === "none");
check("an unknown device yields an all-unknown report that cannot grant",
  evaluatePlatformSso(await psConn.fetchNormalized("mac-unknown")).recommendedAction !== "none");
// The prototype walk must be BOUNDED, not trusted: >64 empty prototypes under an
// otherwise-clean report must read malformed — without the bound the walk ends
// quietly at Object.prototype and the report reads clean.
let psDeepProto: object = {};
for (let i = 0; i < 100; i += 1) psDeepProto = Object.create(psDeepProto);
const psDeepReport = Object.assign(Object.create(psDeepProto), { registration: "user", method: "secure_enclave_key", login_policy: "not_required" });
check("a report behind a 100-deep prototype chain is malformed (bounded walk)",
  normalizeReport("deep", psDeepReport as PlatformSsoReportRaw).reportIntegrity === "malformed");
// An inherited key with a RECOGNIZED name is still an assertion this report did not
// make itself — the prototype-chain scan, not the own-value read, is what notices it.
const psProtoAlias = Object.assign(Object.create({ method: "password_sync" }), { registration: "user", method: "secure_enclave_key", login_policy: "not_required" });
check("a recognized key inherited from the prototype marks the report malformed",
  normalizeReport("pa", psProtoAlias as PlatformSsoReportRaw).reportIntegrity === "malformed");

// ── fusion into the fabric (posture-composition + incident routing) ─────────────
check("platform_sso is a member of the runtime SIGNAL_KINDS array — the union is derived, so the playbook proof covers it automatically",
  (SIGNAL_KINDS as readonly string[]).includes("platform_sso"));
const fusedDrift = fromPlatformSso(ev({ registration: "user", method: "secure_enclave_key", login_policy: "required" }));
check("fromPlatformSso maps the policy-contradiction verdict onto the unified ladder as alert",
  fusedDrift.kind === "platform_sso" && fusedDrift.action === "alert" && fusedDrift.reason === "POLICY_INCOMPATIBLE_WITH_METHOD");
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fusedDrift,
]);
check("composition is worst-concern-wins: a claimed-but-unenforceable policy drags an otherwise-healthy Mac to alert, with platform_sso as the top driver",
  fused.strongestAction === "alert" && fused.drivers[0]?.kind === "platform_sso");
const fusedClean = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  fromPlatformSso(sek),
]);
check("...and a confirmed phishing-resistant credential contributes none — the dimension never lowers, only raises",
  fusedClean.strongestAction === "none");

// Determinism.
const d1 = normalizeReport("det", { registration: "user", method: "password_sync", login_policy: "required", offline_grace: "expired" });
check("evaluator is deterministic", JSON.stringify(evaluatePlatformSso(d1)) === JSON.stringify(evaluatePlatformSso(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},rawGrantingCombos=${rawRes.noneCount},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
