// Verdict-attestation proof — fully OFFLINE and deterministic.
//
// Every connector in this fabric is built on one rule: a grant requires positive
// confirmation of every input. Eight adversarial reviews went into making `allow`
// unreachable from anything unknown, missing, malformed or self-contradictory at the
// FIELD layer. None of it helps if the verdict itself is forged afterwards.
//
// docs/PRODUCT_CORE_THREAT_MODEL.md records why that stopped being hypothetical: attacks
// on healthcare service providers rose sharply through H1 2026 precisely because one
// compromised hub reaches many hospitals, and a decision fabric reading signals across a
// fleet is that archetype. An attacker who cannot write to a hospital's MDM — and cannot,
// because every connector is read-only and enforced so in code — but who CAN flip a
// verdict to `allow` has turned the product into a machine for manufacturing false
// confirmations at fleet scale.
//
// The decision this proof exists to pin down: AN UNVERIFIABLE VERDICT IS NOT DENIED AND
// IT IS NOT ALLOWED — IT IS DEGRADED. A control whose failure mode is a status field the
// caller may ignore is a control that stops working the first time someone ships a caller
// that ignores it. So `openVerdict` never returns a usable grant it could not verify.
import {
  DEGRADED_REASON,
  UNCANONICAL,
  canonicalize,
  openVerdict,
  sealVerdict,
  verifyVerdict,
  type AttestationKey,
  type AttestedVerdict,
} from "@workspace/verdict-attestation";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Verdict-attestation proof");

// Fixed clock and nonce: the whole package takes time as an argument so nothing here
// depends on the wall clock.
const NOW = 1_800_000_000_000;
const KEY: AttestationKey = { keyId: "sg-fabric-2026-07", alg: "hs256", secret: "fixture-sealing-secret" };
const OTHER_KEY: AttestationKey = { keyId: "sg-fabric-2026-06", alg: "hs256", secret: "a-different-secret" };
const RING = [KEY, OTHER_KEY];
const TENANT = "tenant-stmarys";

interface Verdict { recommendedAction: string; reasonCode: string; deviceId: string }
const ALLOW: Verdict = { recommendedAction: "none", reasonCode: "MANAGEMENT_HEALTHY", deviceId: "ipad-ward-01" };
const RESTRICT: Verdict = { recommendedAction: "restrict", reasonCode: "ENROLLMENT_RETIRED", deviceId: "ipad-ward-02" };

const LADDER = ["none", "monitor", "patch", "locate", "step_up", "alert", "restrict", "escalate"];
const rank = (a: string): number => LADDER.indexOf(a);

const seal = (v: Verdict, opts: Partial<{ tenantId: string; issuedAt: number; nonce: string }> = {}): AttestedVerdict<Verdict> =>
  sealVerdict(v, KEY, { tenantId: opts.tenantId ?? TENANT, issuedAt: opts.issuedAt ?? NOW, nonce: opts.nonce ?? "nonce-1" });

const opts = (over: Partial<Parameters<typeof verifyVerdict>[2]> = {}) => ({
  expectedTenantId: TENANT, now: NOW, ...over,
});

// ── the happy path, asserted first so nothing below passes vacuously ───────────
const sealed = seal(ALLOW);
check("a sealed verdict verifies", verifyVerdict(sealed, RING, opts()).verified === true);
check("sealing does not alter the verdict it covers", JSON.stringify(sealed.verdict) === JSON.stringify(ALLOW));
check("the attestation names the key that sealed it, not the algorithm", sealed.attestation.keyId === KEY.keyId && sealed.attestation.alg === "hs256");
const opened = openVerdict<Verdict>(sealed, RING, opts(), rank);
check("a verified allow is returned intact and NOT degraded", opened.degraded === false && opened.verdict.recommendedAction === "none" && opened.verdict.reasonCode === "MANAGEMENT_HEALTHY");

// ── the point of the package: an unverifiable verdict is not usable ────────────
//
// Not an error a caller may log and ignore. The verdict comes back with its action
// raised, so a caller that never reads `status` still cannot act on a forgery.
const forged: AttestedVerdict<Verdict> = { ...seal(RESTRICT), verdict: ALLOW };
const forgedOpen = openVerdict<Verdict>(forged, RING, opts(), rank);
check("a FORGED allow (verdict swapped under a valid seal) fails verification", forgedOpen.status.verified === false);
check("...and is DEGRADED to step_up, so a caller ignoring `status` still cannot act on it", forgedOpen.verdict.recommendedAction === "step_up");
check("...and carries VERDICT_UNVERIFIED so an operator sees why", forgedOpen.verdict.reasonCode === DEGRADED_REASON);
check("...and the degrade is flagged for the audit record", forgedOpen.degraded === true);
// One-directional. Verification failure means we could not confirm the verdict, which is
// never a reason to trust the device MORE than the unverified claim about it did.
const forgedRestrict: AttestedVerdict<Verdict> = { ...seal(ALLOW), verdict: RESTRICT };
const restrictOpen = openVerdict<Verdict>(forgedRestrict, RING, opts(), rank);
check("a failed verification never LOWERS an action — a restrict stays restrict", restrictOpen.verdict.recommendedAction === "restrict" && restrictOpen.degraded === true);
// The caller may be holding the original for an audit record. Rewriting it underneath
// them would corrupt exactly the evidence this is meant to protect.
check("the original verdict object is copied, never mutated in place", forged.verdict.recommendedAction === "none" && ALLOW.recommendedAction === "none");
// Nothing usable at all must still come back as a shell, not as something a caller could
// dereference into a grant.
const nullVerdict = openVerdict<Verdict>({ verdict: null, attestation: sealed.attestation }, RING, opts(), rank);
check("an envelope with no usable verdict yields a degraded shell, never a grant", nullVerdict.verdict.recommendedAction === "step_up" && nullVerdict.verdict.reasonCode === DEGRADED_REASON);

// ── tampering, one field at a time ────────────────────────────────────────────
const tamperedField = { ...sealed, verdict: { ...ALLOW, deviceId: "ipad-ward-99" } };
check("changing ANY field of the sealed verdict breaks the digest", (verifyVerdict(tamperedField, RING, opts()) as { failure: string }).failure === "digest_mismatch");
const tamperedTime = { ...sealed, attestation: { ...sealed.attestation, issuedAt: NOW - 1 } };
check("issuedAt is INSIDE the seal — moving it breaks the digest, it is not just metadata", (verifyVerdict(tamperedTime, RING, opts()) as { failure: string }).failure === "digest_mismatch");
const tamperedNonce = { ...sealed, attestation: { ...sealed.attestation, nonce: "nonce-2" } };
check("the nonce is inside the seal too", (verifyVerdict(tamperedNonce, RING, opts()) as { failure: string }).failure === "digest_mismatch");
const truncated = { ...sealed, attestation: { ...sealed.attestation, digest: sealed.attestation.digest.slice(0, -1) } };
check("a truncated digest is refused (length is compared before the constant-time check)", (verifyVerdict(truncated, RING, opts()) as { failure: string }).failure === "digest_mismatch");
const flipped = { ...sealed, attestation: { ...sealed.attestation, digest: sealed.attestation.digest.slice(0, -1) + (sealed.attestation.digest.endsWith("a") ? "b" : "a") } };
check("a digest differing in ONE character is refused", (verifyVerdict(flipped, RING, opts()) as { failure: string }).failure === "digest_mismatch");

// ── cross-tenant replay ───────────────────────────────────────────────────────
//
// The hub threat in one test: a genuine, correctly-sealed `allow` for one hospital,
// replayed against another. tenantId is bound INTO the payload, so this is not a
// question of policy — the signature itself does not transfer.
const forTenantB = seal(ALLOW, { tenantId: "tenant-riverside" });
check("a verdict sealed for ANOTHER tenant is refused even though its seal is genuine", (verifyVerdict(forTenantB, RING, opts()) as { failure: string }).failure === "tenant_mismatch");
check("...and opening it degrades rather than returning the other tenant's allow", openVerdict<Verdict>(forTenantB, RING, opts(), rank).verdict.recommendedAction === "step_up");
// And the reverse: the consumer's expectation is what it is checked against, so a
// relabelled attestation cannot smuggle it through — the digest covers tenantId.
const relabelled = { ...forTenantB, attestation: { ...forTenantB.attestation, tenantId: TENANT } };
check("relabelling the tenant on the envelope breaks the digest — it cannot be smuggled", (verifyVerdict(relabelled, RING, opts()) as { failure: string }).failure === "digest_mismatch");

// ── algorithm and key confusion ───────────────────────────────────────────────
//
// The classic way signed-token schemes break: the verifier picks its algorithm from a
// field the attacker controls. Here `alg` is checked for MEMBERSHIP only; the verifier
// comes from the keyring entry.
const bogusAlg = { ...sealed, attestation: { ...sealed.attestation, alg: "none" } };
check("an unsupported alg is refused before anything else is attempted", (verifyVerdict(bogusAlg, RING, opts()) as { failure: string }).failure === "unsupported_alg");
const unknownKey = { ...sealed, attestation: { ...sealed.attestation, keyId: "sg-fabric-2099-01" } };
check("an unknown keyId is a refusal, not a fallback to trying every key in the ring", (verifyVerdict(unknownKey, RING, opts()) as { failure: string }).failure === "unknown_key");
// Sealed with KEY, presented as if sealed with OTHER_KEY. A verifier that tried each
// key in turn would leak which keys exist; one that trusted keyId blindly would fail
// the digest — either way this must be a clean refusal.
const wrongKeyId = { ...sealed, attestation: { ...sealed.attestation, keyId: OTHER_KEY.keyId } };
check("a verdict presented under the wrong key in the ring fails the digest, it does not roam the ring", (verifyVerdict(wrongKeyId, RING, opts()) as { failure: string }).failure === "digest_mismatch");
check("an EMPTY keyring verifies nothing (no implicit trust when no key is configured)", verifyVerdict(sealed, [], opts()).verified === false);

// ── freshness and replay ──────────────────────────────────────────────────────
check("a verdict older than the max age is expired, however genuine its seal", (verifyVerdict(sealed, RING, opts({ now: NOW + 6 * 60_000 })) as { failure: string }).failure === "expired");
check("a verdict just inside the window still verifies", verifyVerdict(sealed, RING, opts({ now: NOW + 4 * 60_000 })).verified === true);
check("a verdict issued in the FUTURE beyond tolerated skew is refused, not treated as fresh", (verifyVerdict(sealed, RING, opts({ now: NOW - 5 * 60_000 })) as { failure: string }).failure === "issued_in_future");
check("small clock skew is tolerated rather than treated as forgery", verifyVerdict(sealed, RING, opts({ now: NOW - 30_000 })).verified === true);
check("a replayed nonce is refused when the caller supplies a seen-set", (verifyVerdict(sealed, RING, opts({ seenNonce: (n: string) => n === "nonce-1" })) as { failure: string }).failure === "nonce_replayed");
check("...and an unseen nonce passes, so the hook is not vacuous", verifyVerdict(sealed, RING, opts({ seenNonce: () => false })).verified === true);

// ── malformed envelopes fail closed, never throw ──────────────────────────────
const malformed: [string, unknown][] = [
  ["null", null],
  ["a primitive", "ERR: upstream timeout"],
  ["an array", []],
  ["an object with no attestation", { verdict: ALLOW }],
  ["an object with no verdict", { attestation: sealed.attestation }],
  ["an attestation that is null", { verdict: ALLOW, attestation: null }],
  ["an attestation that is an array", { verdict: ALLOW, attestation: [] }],
  ["an attestation missing its digest", { verdict: ALLOW, attestation: { ...sealed.attestation, digest: undefined } }],
  ["a non-numeric issuedAt", { verdict: ALLOW, attestation: { ...sealed.attestation, issuedAt: "now" } }],
  ["a NaN issuedAt", { verdict: ALLOW, attestation: { ...sealed.attestation, issuedAt: NaN } }],
  ["an Infinity issuedAt", { verdict: ALLOW, attestation: { ...sealed.attestation, issuedAt: Infinity } }],
  ["an attestation carrying an unrecognized key", { verdict: ALLOW, attestation: { ...sealed.attestation, priority: "high" } }],
];
for (const [label, env] of malformed) {
  let threw = false;
  let verified: boolean | null = null;
  try { verified = verifyVerdict(env, RING, opts()).verified; } catch { threw = true; }
  check(`${label} is refused without throwing`, threw === false && verified === false);
}
// The same hardened-envelope discipline the connectors apply to bridge reports: an
// attestation carrying a field we do not understand is one we cannot claim to have
// verified, and an inherited or symbol key is an assertion in a spelling we ignore.
const inheritedAtt = { verdict: ALLOW, attestation: Object.create({ ...sealed.attestation }) };
check("an attestation with ZERO own keys asserts nothing and is refused", verifyVerdict(inheritedAtt, RING, opts()).verified === false);
const protoKeyAtt = { verdict: ALLOW, attestation: Object.assign(Object.create({ priority: "high" }), sealed.attestation) };
check("an unrecognized key INHERITED from the prototype is still an unrecognized envelope", verifyVerdict(protoKeyAtt, RING, opts()).verified === false);
const symbolAtt = { verdict: ALLOW, attestation: Object.assign({}, sealed.attestation) };
(symbolAtt.attestation as unknown as Record<symbol, unknown>)[Symbol.for("digest")] = "x";
check("a SYMBOL-keyed attestation field is an unrecognized envelope", verifyVerdict(symbolAtt, RING, opts()).verified === false);
const protoAtt = { verdict: ALLOW, attestation: Object.prototype };
check("an attestation that IS Object.prototype is refused", verifyVerdict(protoAtt, RING, opts()).verified === false);
const throwingVerdict = { attestation: sealed.attestation };
Object.defineProperty(throwingVerdict, "verdict", { get() { throw new Error("hostile"); }, enumerable: true, configurable: true });
let accessorThrew = false;
try { verifyVerdict(throwingVerdict, RING, opts()); } catch { accessorThrew = true; }
check("a throwing accessor on the envelope does not escape the verifier", accessorThrew === false);

// ── canonicalization: the bytes a seal covers ─────────────────────────────────
//
// If two different verdicts can canonicalize the same, one can be swapped for the other
// under a valid signature. If one verdict can canonicalize two ways, honest traffic is
// rejected. JSON.stringify guarantees neither — its key order follows insertion order.
check("key ORDER does not change the canonical bytes", canonicalize({ a: 1, b: 2 }) === canonicalize({ b: 2, a: 1 }));
check("a verdict built in a different field order still verifies", verifyVerdict({ ...sealed, verdict: { deviceId: ALLOW.deviceId, reasonCode: ALLOW.reasonCode, recommendedAction: ALLOW.recommendedAction } }, RING, opts()).verified === true);
check("nested key order is canonical too", canonicalize({ x: { p: 1, q: 2 } }) === canonicalize({ x: { q: 2, p: 1 } }));
// JSON.stringify maps NaN and Infinity to null, which would make three different
// verdicts seal identically. Refusing them is the only safe reading.
check("NaN is UNCANONICAL, not silently null (three verdicts must not seal alike)", canonicalize(NaN) === UNCANONICAL);
check("Infinity is UNCANONICAL", canonicalize(Infinity) === UNCANONICAL);
check("-0 and 0 canonicalize alike, deliberately rather than incidentally", canonicalize(-0) === canonicalize(0));
check("a bigint is UNCANONICAL rather than throwing", canonicalize(10n) === UNCANONICAL);
check("undefined inside an ARRAY is UNCANONICAL — a hole must not alter sealed bytes", canonicalize([1, undefined, 2]) === UNCANONICAL);
check("undefined on an object KEY is dropped, matching JSON", canonicalize({ a: 1, b: undefined }) === canonicalize({ a: 1 }));
// Own-only, so a polluted prototype cannot change what a signature covers.
(Object.prototype as Record<string, unknown>).injected = "evil";
const pollutedBytes = canonicalize({ a: 1 });
delete (Object.prototype as Record<string, unknown>).injected;
check("a polluted Object.prototype cannot change the canonical bytes", pollutedBytes === canonicalize({ a: 1 }));
const cyclic: Record<string, unknown> = { a: 1 };
cyclic.self = cyclic;
let cyclicThrew = false;
let cyclicResult: unknown = null;
try { cyclicResult = canonicalize(cyclic); } catch { cyclicThrew = true; }
check("a cyclic value is UNCANONICAL, not a stack overflow", cyclicThrew === false && cyclicResult === UNCANONICAL);
const throwingKeys = new Proxy({ a: 1 }, { ownKeys: () => { throw new Error("hostile"); } });
check("a Proxy that throws from ownKeys is UNCANONICAL, not an escaping error", canonicalize(throwingKeys) === UNCANONICAL);
// Sealing is producer-side: failing loudly there is right, because a verdict that cannot
// be canonicalized cannot be protected and shipping it unsealed would be worse.
let sealThrew = false;
try { sealVerdict({ bad: NaN }, KEY, { tenantId: TENANT, issuedAt: NOW }); } catch { sealThrew = true; }
check("sealing an uncanonicalizable verdict FAILS LOUDLY rather than shipping it unprotected", sealThrew === true);

// ── exhaustive: over every combination of tamper, key, alg, clock and replay ───
//
// Quantifies rather than sampling: `verified: true` must occur for EXACTLY the pristine
// combination and nothing else. The clean predicate is stated independently of the
// implementation, so a guard that silently stopped firing still fails here.
const domains = {
  tamper: ["none", "verdict", "tenantId", "issuedAt", "nonce", "digest"],
  keyId: ["correct", "other"],
  alg: ["correct", "bogus"],
  clock: ["fresh", "expired", "future"],
  expectedTenant: ["match", "mismatch"],
  replay: ["unseen", "seen"],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) => c,
  evaluate: (c: Record<string, unknown>) => {
    const base = seal(ALLOW);
    let verdict: unknown = base.verdict;
    const att: Record<string, unknown> = { ...base.attestation };
    if (c.tamper === "verdict") verdict = { ...ALLOW, deviceId: "tampered" };
    if (c.tamper === "tenantId") att.tenantId = "tenant-other";
    if (c.tamper === "issuedAt") att.issuedAt = NOW - 1;
    if (c.tamper === "nonce") att.nonce = "nonce-tampered";
    if (c.tamper === "digest") att.digest = "0".repeat(64);
    if (c.keyId === "other") att.keyId = OTHER_KEY.keyId;
    if (c.alg === "bogus") att.alg = "none";
    const now = c.clock === "fresh" ? NOW : c.clock === "expired" ? NOW + 6 * 60_000 : NOW - 5 * 60_000;
    return verifyVerdict({ verdict, attestation: att }, RING, {
      expectedTenantId: c.expectedTenant === "match" ? TENANT : "tenant-elsewhere",
      now,
      seenNonce: c.replay === "seen" ? () => true : () => false,
    });
  },
  // "none" stands for VERIFIED in this pass — the harness's grant is our accept.
  actionOf: (s: { verified: boolean }) => (s.verified ? "none" : "refused"),
  positivelyClean: (c) =>
    c.tamper === "none" &&
    c.keyId === "correct" &&
    c.alg === "correct" &&
    c.clock === "fresh" &&
    c.expectedTenant === "match" &&
    c.replay === "unseen",
});
check(
  `exhaustive: over all ${enumRes.combos} envelope states, verification succeeds for EXACTLY the untampered, correctly-keyed, in-window, right-tenant, unreplayed one (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 288,
);
check("exhaustive: exactly ONE state verifies — acceptance is unique", enumRes.noneCount === 1);

// The same space, asserted through `openVerdict`: no combination but the pristine one
// may yield a usable `none`. This is the invariant that actually protects the fabric,
// because it holds even for a caller that never inspects `status`.
let usableGrants = 0;
const walk = (keys: string[], i: number, acc: Record<string, string>): void => {
  if (i === keys.length) {
    const base = seal(ALLOW);
    let verdict: unknown = base.verdict;
    const att: Record<string, unknown> = { ...base.attestation };
    if (acc.tamper === "verdict") verdict = { ...ALLOW, deviceId: "tampered" };
    if (acc.tamper === "tenantId") att.tenantId = "tenant-other";
    if (acc.tamper === "issuedAt") att.issuedAt = NOW - 1;
    if (acc.tamper === "nonce") att.nonce = "nonce-tampered";
    if (acc.tamper === "digest") att.digest = "0".repeat(64);
    if (acc.keyId === "other") att.keyId = OTHER_KEY.keyId;
    if (acc.alg === "bogus") att.alg = "none";
    const now = acc.clock === "fresh" ? NOW : acc.clock === "expired" ? NOW + 6 * 60_000 : NOW - 5 * 60_000;
    const o = openVerdict<Verdict>({ verdict, attestation: att }, RING, {
      expectedTenantId: acc.expectedTenant === "match" ? TENANT : "tenant-elsewhere",
      now,
      seenNonce: acc.replay === "seen" ? () => true : () => false,
    }, rank);
    if (o.verdict.recommendedAction === "none") usableGrants += 1;
    return;
  }
  for (const v of domains[keys[i] as keyof typeof domains]) walk(keys, i + 1, { ...acc, [keys[i]]: v as string });
};
walk(Object.keys(domains), 0, {});
check(`exhaustive (openVerdict): across all 288 states, exactly ONE yields a usable 'none' — a caller that ignores \`status\` is still safe (usable grants=${usableGrants})`, usableGrants === 1);

// Determinism.
check("sealing is deterministic for a fixed nonce and clock", seal(ALLOW).attestation.digest === seal(ALLOW).attestation.digest);
check("two different verdicts never seal alike", seal(ALLOW).attestation.digest !== seal(RESTRICT).attestation.digest);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
