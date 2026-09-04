// Dual-control (two-person integrity) decision proof — fully OFFLINE and deterministic.
//
// This surface MAKES a decision the host enforces: whether a highest-blast-radius elevated
// action may be released, given two authorizers. The grant is `Granted`, and it carries
// the discipline the whole repo applies to a grant — POSITIVE CONFIRMATION OF EVERY INPUT.
// `SecondAuthorizerRequired` is the safe non-grant every unknown lands in; `Denied` is
// reserved for affirmative bad facts (self-authorization, a shared credential, a failed or
// mis-bound gesture, an impermissible authorizer, an expired co-presence window).
//
// The enumerations are the spine: they brute-force the entire normalized input space AND a
// hostile raw-wire space, and assert that `Granted` is emitted for EXACTLY the one fully
// confirmed state and for nothing else. A single unconfirmed input reaching a grant is a
// mismatch, and the proof fails.
import {
  evaluateDualControl,
  normalizeDualControlRequest,
  type AuthorizerAttestationRaw,
  type DualControlRequestRaw,
  type NormalizedAuthorizer,
  type NormalizedDualControl,
} from "@workspace/dual-control";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Dual-control (two-person integrity) decision proof");

const A = (over: Partial<AuthorizerAttestationRaw> = {}): AuthorizerAttestationRaw => ({
  identityRef: "op-alice", credentialRef: "cred-alice-yk5c", authenticatorClass: "security_key",
  userVerified: true, boundToAction: true, roleAuthorized: true, ...over,
});
const B = (over: Partial<AuthorizerAttestationRaw> = {}): AuthorizerAttestationRaw => ({
  identityRef: "op-bob", credentialRef: "cred-bob-titan", authenticatorClass: "security_key",
  userVerified: true, boundToAction: true, roleAuthorized: true, ...over,
});
const CONFIRMED: DualControlRequestRaw = {
  actionId: "break-glass-emr-admin-7f3", actionClass: "break_glass",
  initiator: A(), approver: B(), coPresence: "confirmed",
};
const ev = (r: DualControlRequestRaw, id = "req-1") => evaluateDualControl(normalizeDualControlRequest(id, r));

// ── the three outcomes ──────────────────────────────────────────────────────────

const granted = ev(CONFIRMED);
check("two distinct, verified, action-bound, co-present authorizers → Granted", granted.outcome === "Granted" && granted.reasonCode === "GRANTED_TWO_PERSON_CONFIRMED" && granted.twoPersonConfirmed === true);
check("...with no blocking findings and no unknowns", granted.blockingFindings.length === 0 && granted.unknownSignals.length === 0);
check("...and an explanation an audit reader can act on", granted.explanation.length > 40 && granted.explanation.includes("Released"));

// Every known action class grants when the rest is confirmed (the class picks WHEN dual
// control applies, not WHETHER a confirmed pair may proceed).
for (const cls of ["break_glass", "privileged_config", "bulk_data"] as const) {
  check(`a confirmed pair releases a '${cls}' action`, ev({ ...CONFIRMED, actionClass: cls }).outcome === "Granted");
}

// ── Denied: affirmative bad facts only ────────────────────────────────────────────

const selfAuth = ev({ ...CONFIRMED, approver: B({ identityRef: "op-alice" }) });
check("the SAME person as both authorizers → Denied (self-authorization)", selfAuth.outcome === "Denied" && selfAuth.reasonCode === "SELF_AUTHORIZATION");
check("...and self-authorization is the reason even though the gestures were otherwise valid", selfAuth.blockingFindings.includes("self_authorization"));

const sharedCred = ev({ ...CONFIRMED, approver: B({ credentialRef: "cred-alice-yk5c" }) });
check("one credential instance signing both halves → Denied (shared credential)", sharedCred.outcome === "Denied" && sharedCred.reasonCode === "SHARED_CREDENTIAL");

const uvFail = ev({ ...CONFIRMED, approver: B({ userVerified: false }) });
check("an authorizer whose verification explicitly failed → Denied", uvFail.outcome === "Denied" && uvFail.reasonCode === "VERIFICATION_FAILED");

const replay = ev({ ...CONFIRMED, initiator: A({ boundToAction: false }) });
check("a gesture bound to a DIFFERENT action (replay) → Denied (action-binding mismatch)", replay.outcome === "Denied" && replay.reasonCode === "ACTION_BINDING_MISMATCH");

const notPermitted = ev({ ...CONFIRMED, approver: B({ roleAuthorized: false }) });
check("an authorizer not in the permitted set → Denied (any two people is not dual control)", notPermitted.outcome === "Denied" && notPermitted.reasonCode === "AUTHORIZER_NOT_PERMITTED");

const expired = ev({ ...CONFIRMED, coPresence: "expired" });
check("two authorizations that were NOT concurrent (window expired) → Denied", expired.outcome === "Denied" && expired.reasonCode === "CO_PRESENCE_EXPIRED");

// Structural breaks (shared identity / credential) outrank a single failed gesture.
const both = ev({ ...CONFIRMED, approver: B({ identityRef: "op-alice", userVerified: false }) });
check("a shared identity outranks a failed gesture in the reason code", both.outcome === "Denied" && both.reasonCode === "SELF_AUTHORIZATION");

// ── SecondAuthorizerRequired: every unknown, never a deny, never a grant ──────────

const onlyOne = ev({ ...CONFIRMED, approver: {} });
check("a first authorizer alone (second absent) → SecondAuthorizerRequired, not Denied, not Granted", onlyOne.outcome === "SecondAuthorizerRequired" && onlyOne.twoPersonConfirmed === false);

for (const [field, label] of [["userVerified", "verification"], ["boundToAction", "action binding"], ["roleAuthorized", "authorizer role"]] as const) {
  const v = ev({ ...CONFIRMED, approver: B({ [field]: undefined }) });
  check(`an unreported '${label}' on one authorizer → SecondAuthorizerRequired, never Denied, never Granted`, v.outcome === "SecondAuthorizerRequired");
}

const unknownWindow = ev({ ...CONFIRMED, coPresence: undefined });
check("an unestablished co-presence window → SecondAuthorizerRequired (unknown, not expired)", unknownWindow.outcome === "SecondAuthorizerRequired" && unknownWindow.unknownSignals.includes("co_presence"));

const unknownClass = ev({ ...CONFIRMED, actionClass: undefined });
check("an unestablished action class cannot auto-release", unknownClass.outcome === "SecondAuthorizerRequired" && unknownClass.unknownSignals.includes("action_class"));

const noActionId = ev({ ...CONFIRMED, actionId: undefined });
check("a missing action id cannot auto-release (nothing concrete to bind to)", noActionId.outcome === "SecondAuthorizerRequired" && noActionId.unknownSignals.includes("action_id"));

// ── hostile request shapes (the caller is external) ───────────────────────────────

const inherited = normalizeDualControlRequest("inh", Object.create(CONFIRMED) as DualControlRequestRaw);
check("a request with ZERO own keys asserts nothing and cannot Grant", evaluateDualControl(inherited).outcome !== "Granted");

const aliased = normalizeDualControlRequest("al", { ...CONFIRMED, action_id: "x" } as DualControlRequestRaw);
check("an unrecognized top-level key marks the envelope malformed and cannot Grant", aliased.requestIntegrity === "malformed" && evaluateDualControl(aliased).outcome !== "Granted");

const aliasedAuthorizer = normalizeDualControlRequest("aa", { ...CONFIRMED, approver: B({ identity_ref: "op-bob" } as Partial<AuthorizerAttestationRaw>) } as DualControlRequestRaw);
check("an unrecognized key INSIDE an authorizer marks the request malformed", aliasedAuthorizer.requestIntegrity === "malformed");

const protoAliasAuthorizer = normalizeDualControlRequest("pa", { ...CONFIRMED, approver: Object.assign(Object.create({ identity_ref: "op-bob" }), B()) as AuthorizerAttestationRaw } as DualControlRequestRaw);
check("an unrecognized key INHERITED by an authorizer is caught too", protoAliasAuthorizer.requestIntegrity === "malformed");
// PER-FIELD integrity (mutation-guard finding): one junk field per request, every
// other field valid. Several junk fields at once let one integrity term hide
// behind another — deleting a term stayed green because the request was refused
// anyway, with nothing asserting it was marked MALFORMED.
for (const [field, junk] of [
  ["identityRef", 7], ["credentialRef", 7], ["authenticatorClass", "magic"],
  ["userVerified", "yes"], ["boundToAction", "yes"], ["roleAuthorized", "yes"],
] as const) {
  const req = { ...CONFIRMED, approver: B({ [field]: junk } as never) };
  check(`junk authorizer ${field} alone marks the request malformed`,
    normalizeDualControlRequest("pf", req).requestIntegrity === "malformed");
}
for (const [field, junk] of [["actionId", 7], ["actionClass", "whatever"], ["coPresence", "maybe"]] as const) {
  const req = { ...CONFIRMED, [field]: junk } as DualControlRequestRaw;
  check(`junk request ${field} alone marks the request malformed`,
    normalizeDualControlRequest("pfr", req).requestIntegrity === "malformed");
}
// A non-plain authorizer / request body must itself be malformed, not merely
// refused downstream (the `!plain` terms the sweep found unfalsifiable).
check("a non-object authorizer body is malformed",
  normalizeDualControlRequest("np", { ...CONFIRMED, approver: "nope" as never }).requestIntegrity === "malformed");
check("a non-object request body is malformed",
  normalizeDualControlRequest("npr", "nope" as never).requestIntegrity === "malformed");
// A NULL authorizer body is the one non-object shape `hasUnrecognizedKey` cannot catch:
// its bounded prototype walk never enters the loop for `null` (the `o !== null` guard is
// false on entry) and returns false, and every field read yields undefined (absent, not
// malformed). So the authorizer-level `!plain` term is the SOLE guard on a null authorizer
// — LOAD-BEARING, not inert. Confirmed by mutation: with that term forced to `false`,
// `approver:null`/`initiator:null` read `clean`, a fail-open. Both slots pinned.
check("a null approver body is malformed (only the authorizer !plain catches a null body)",
  normalizeDualControlRequest("an", { ...CONFIRMED, approver: null as never }).requestIntegrity === "malformed");
check("a null initiator body is malformed (only the authorizer !plain catches a null body)",
  normalizeDualControlRequest("in", { ...CONFIRMED, initiator: null as never }).requestIntegrity === "malformed");

const hidden = new Proxy({ ...CONFIRMED }, { ownKeys: () => [], getOwnPropertyDescriptor: () => undefined }) as DualControlRequestRaw;
check("a Proxy hiding its own descriptors reads as ABSENT and cannot Grant", evaluateDualControl(normalizeDualControlRequest("px", hidden)).outcome !== "Granted");

const throwing = new Proxy({ ...CONFIRMED }, { ownKeys: () => { throw new Error("hostile"); } }) as DualControlRequestRaw;
check("a Proxy that THROWS from ownKeys fails closed", evaluateDualControl(normalizeDualControlRequest("tk", throwing)).outcome !== "Granted");

const hostileAuthorizer = new Proxy(A(), { ownKeys: () => { throw new Error("hostile"); } }) as AuthorizerAttestationRaw;
check("a Proxy authorizer that THROWS from ownKeys fails closed", evaluateDualControl(normalizeDualControlRequest("ta", { ...CONFIRMED, initiator: hostileAuthorizer })).outcome !== "Granted");

// A THROWING ACCESSOR — an own property whose getter throws — is inside the same threat
// model as the proxies above: a field we cannot READ is a field we cannot confirm. It
// must fail closed to a malformed verdict, never escape as an uncaught exception.
const throwingReqField = { actionClass: "break_glass", coPresence: "confirmed", initiator: A(), approver: B() } as DualControlRequestRaw;
Object.defineProperty(throwingReqField, "actionId", { enumerable: true, get() { throw new Error("boom"); } });
let reqAccessorThrew = false;
let reqAccessorVerdict: ReturnType<typeof evaluateDualControl> | null = null;
try { reqAccessorVerdict = evaluateDualControl(normalizeDualControlRequest("tg", throwingReqField)); } catch { reqAccessorThrew = true; }
check("a throwing ACCESSOR on a top-level field fails closed to malformed, without an exception", reqAccessorThrew === false && reqAccessorVerdict !== null && reqAccessorVerdict.outcome !== "Granted");
check("...and the request is marked malformed", normalizeDualControlRequest("tg2", throwingReqField).requestIntegrity === "malformed");

const throwingAuthorizerField = { credentialRef: "cx", authenticatorClass: "security_key", userVerified: true, boundToAction: true, roleAuthorized: true } as AuthorizerAttestationRaw;
Object.defineProperty(throwingAuthorizerField, "identityRef", { enumerable: true, get() { throw new Error("boom"); } });
let authAccessorThrew = false;
let authAccessorVerdict: ReturnType<typeof evaluateDualControl> | null = null;
try { authAccessorVerdict = evaluateDualControl(normalizeDualControlRequest("tag", { ...CONFIRMED, approver: throwingAuthorizerField })); } catch { authAccessorThrew = true; }
check("a throwing ACCESSOR inside an authorizer fails closed to malformed, without an exception", authAccessorThrew === false && authAccessorVerdict !== null && authAccessorVerdict.outcome !== "Granted");
check("...and the request is marked malformed", normalizeDualControlRequest("tag2", { ...CONFIRMED, approver: throwingAuthorizerField }).requestIntegrity === "malformed");

check("a non-object request body is malformed, not a thrown TypeError", normalizeDualControlRequest("s", "boom" as unknown as DualControlRequestRaw).requestIntegrity === "malformed");
check("a null request body is malformed, not a thrown TypeError", normalizeDualControlRequest("n", null as unknown as DualControlRequestRaw).requestIntegrity === "malformed");
check("a non-object authorizer is malformed, not a thrown TypeError", normalizeDualControlRequest("na", { ...CONFIRMED, approver: "boom" } as DualControlRequestRaw).requestIntegrity === "malformed");

const stringBool = normalizeDualControlRequest("sb", { ...CONFIRMED, approver: B({ userVerified: "true" }) } as DualControlRequestRaw);
check("a string-quoted boolean is an assertion we could not read, not a confirmation", stringBool.approver.userVerified === null && stringBool.requestIntegrity === "malformed");

const emptyRef = normalizeDualControlRequest("er", { ...CONFIRMED, approver: B({ identityRef: "   " }) } as DualControlRequestRaw);
check("a whitespace-only identity reference is not a reference (null), and marks the request malformed", emptyRef.approver.identityRef === null && emptyRef.requestIntegrity === "malformed");

check("case and whitespace are canonicalized, not rejected", normalizeDualControlRequest("cw", { ...CONFIRMED, actionClass: " BREAK_GLASS " }).actionClass === "break_glass");

// Distinctness is DERIVED, never guessed: two present-and-equal refs → false (bad), one
// absent → null (unknown), two present-and-different → true.
check("distinctAuthorizers is false when both identities are present and equal", normalizeDualControlRequest("d1", { ...CONFIRMED, approver: B({ identityRef: "op-alice" }) }).distinctAuthorizers === false);
check("distinctAuthorizers is null when one identity is absent (never guessed distinct)", normalizeDualControlRequest("d2", { ...CONFIRMED, approver: B({ identityRef: undefined }) }).distinctAuthorizers === null);
check("distinctAuthorizers is true only when both are present and different", normalizeDualControlRequest("d3", CONFIRMED).distinctAuthorizers === true);

// ── exhaustive (normalized): Granted requires ALL twelve confirmations ─────────────
//
// Enumerate the full normalized decision space. actionId is fixed present (its null case
// is checked above); actionClass ranges over one known class + the unknown sentinel so the
// grant is exactly one state. Every other decision-bearing field ranges over all values it
// can hold, including the fail-safe sentinels the normalizer produces.
const normDomains = {
  actionClass: ["break_glass", "unknown"],
  distinctAuthorizers: [true, false, null],
  distinctCredentials: [true, false, null],
  coPresence: ["confirmed", "expired", "unknown"],
  iUserVerified: [true, false, null],
  iBoundToAction: [true, false, null],
  iRoleAuthorized: [true, false, null],
  aUserVerified: [true, false, null],
  aBoundToAction: [true, false, null],
  aRoleAuthorized: [true, false, null],
  requestIntegrity: ["clean", "malformed"],
};
const buildNorm = (c: Record<string, unknown>): NormalizedDualControl => ({
  sourceSystem: "dual-control",
  requestId: "enum",
  actionId: "fixed-action",
  actionClass: c.actionClass as NormalizedDualControl["actionClass"],
  initiator: {
    identityRef: "i", credentialRef: "ci", authenticatorClass: "security_key",
    userVerified: c.iUserVerified as boolean | null,
    boundToAction: c.iBoundToAction as boolean | null,
    roleAuthorized: c.iRoleAuthorized as boolean | null,
  } satisfies NormalizedAuthorizer,
  approver: {
    identityRef: "a", credentialRef: "ca", authenticatorClass: "security_key",
    userVerified: c.aUserVerified as boolean | null,
    boundToAction: c.aBoundToAction as boolean | null,
    roleAuthorized: c.aRoleAuthorized as boolean | null,
  } satisfies NormalizedAuthorizer,
  distinctAuthorizers: c.distinctAuthorizers as boolean | null,
  distinctCredentials: c.distinctCredentials as boolean | null,
  coPresence: c.coPresence as NormalizedDualControl["coPresence"],
  requestIntegrity: c.requestIntegrity as NormalizedDualControl["requestIntegrity"],
  source: "enum",
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: evaluateDualControl,
  actionOf: (v) => (v.outcome === "Granted" ? "none" : v.outcome),
  confirmedWhenNone: (v) => v.twoPersonConfirmed === true && v.blockingFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.requestIntegrity === "clean" && c.actionClass === "break_glass" &&
    c.distinctAuthorizers === true && c.distinctCredentials === true && c.coPresence === "confirmed" &&
    c.iUserVerified === true && c.iBoundToAction === true && c.iRoleAuthorized === true &&
    c.aUserVerified === true && c.aBoundToAction === true && c.aRoleAuthorized === true,
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, Granted requires ALL TWELVE inputs positively confirmed (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 78732,
);
check("exhaustive (normalized): exactly ONE state grants", normRes.noneCount === 1);

// Denied must never be reachable from an absence — only from an affirmative bad fact.
let deniedWithoutBlocker = 0;
for (const da of normDomains.distinctAuthorizers) for (const dc of normDomains.distinctCredentials) for (const cp of normDomains.coPresence) {
  const v = evaluateDualControl(buildNorm({
    actionClass: "unknown", distinctAuthorizers: da, distinctCredentials: dc, coPresence: cp,
    iUserVerified: null, iBoundToAction: null, iRoleAuthorized: null,
    aUserVerified: null, aBoundToAction: null, aRoleAuthorized: null, requestIntegrity: "malformed",
  }));
  if (v.outcome === "Denied" && v.blockingFindings.length === 0) deniedWithoutBlocker += 1;
}
check("Denied is NEVER reached without an affirmative blocking finding — an unknown never denies an authorizer", deniedWithoutBlocker === 0);

// ── exhaustive (raw wire): the normalizer + evaluator together, on hostile input ───
//
// Feed junk enums, JSON nulls, string-quoted booleans, numbers, and an aliased key through
// the real normalizer and into the decision. Distinctness is DERIVED from the two refs, so
// the grant requires the two identity/credential refs to actually differ on the wire.
const rawDomains = {
  actionClass: ["break_glass", "unknown", undefined, null, "green"],
  coPresence: ["confirmed", "expired", "unknown", undefined, "yes"],
  iUserVerified: [true, false, null, undefined, "true"],
  aUserVerified: [true, false, null, undefined, 1],
  aBoundToAction: [true, false, undefined],
  aRoleAuthorized: [true, false, undefined],
  sameIdentity: [true, false],
  sameCredential: [true, false],
  __alias: ["absent", "present"],
};
const buildRaw = (c: Record<string, unknown>): NormalizedDualControl => {
  const initiator = A({ userVerified: c.iUserVerified as unknown });
  const approver = B({
    userVerified: c.aUserVerified as unknown,
    boundToAction: c.aBoundToAction as unknown,
    roleAuthorized: c.aRoleAuthorized as unknown,
    identityRef: c.sameIdentity ? "op-alice" : "op-bob",
    credentialRef: c.sameCredential ? "cred-alice-yk5c" : "cred-bob-titan",
  });
  const req: DualControlRequestRaw = {
    actionId: "fixed-action",
    actionClass: c.actionClass as unknown,
    initiator, approver,
    coPresence: c.coPresence as unknown,
  };
  if (c.__alias === "present") (req as Record<string, unknown>).action_id = "x";
  return normalizeDualControlRequest("enum", req, "enum");
};
const rawRes = enumerateGrantSafety({
  domains: rawDomains,
  build: buildRaw,
  evaluate: evaluateDualControl,
  actionOf: (v) => (v.outcome === "Granted" ? "none" : v.outcome),
  confirmedWhenNone: (v) => v.twoPersonConfirmed === true,
  positivelyClean: (c) =>
    c.__alias !== "present" && c.actionClass === "break_glass" && c.coPresence === "confirmed" &&
    c.iUserVerified === true && c.aUserVerified === true &&
    c.aBoundToAction === true && c.aRoleAuthorized === true &&
    c.sameIdentity === false && c.sameCredential === false,
});
check(
  `exhaustive (raw wire): over all ${rawRes.combos} raw requests — junk enums, nulls, string/number booleans, shared refs, an aliased key — Granted requires the full confirmation (mismatches=${rawRes.mismatches}${rawRes.firstMismatch ? ", first=" + rawRes.firstMismatch : ""})`,
  rawRes.mismatches === 0 && rawRes.combos === productOf(rawDomains) && rawRes.combos === 45000,
);
check("exhaustive (raw wire): exactly ONE raw request grants", rawRes.noneCount === 1);

// Determinism.
const d1 = normalizeDualControlRequest("det", CONFIRMED);
check("evaluator is deterministic", JSON.stringify(evaluateDualControl(d1)) === JSON.stringify(evaluateDualControl(d1)));

const total = passed + failures.length;
console.log(`figures=normalizedCombos=${normRes.combos},rawCombos=${rawRes.combos},grantingCombos=${normRes.noneCount},authorizers=2,ladderRungs=3`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
