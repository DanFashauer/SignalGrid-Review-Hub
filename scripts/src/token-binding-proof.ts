// Token-binding / proof-of-possession proof — fully OFFLINE and deterministic.
//
// Drives the read-only token-binding connector against captured token-inspection
// reports and runs the pure evaluator per device. The model: on a shared, badge-
// checked-out device the session's ACCESS TOKEN must be sender-constrained — bound
// to a hardware key held on THIS device (DPoP RFC 9449, or mTLS RFC 8705) — not a
// replayable bearer token. A bound token whose key belongs to another device is the
// strongest negative (a stolen bound token → escalate); an unbound bearer token is
// contained (restrict); a software-key / unattested / non-audience-restricted /
// unverified token steps up; only a positively-confirmed sender-constrained token
// contributes 'none'. No network.
//
// It also proves the fabric fuses this dimension: fromTokenBinding → a token_binding
// ComposableSignal on the unified ladder, worst-concern-wins.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TokenBindingConnector,
  TokenBindingConnectorError,
  createMockTokenBindingTransport,
  evaluateTokenBinding,
  guardReadOnly,
  normalizeReport,
  resolveTokenBindingConnector,
  type NormalizedTokenBinding,
  type TokenBindingReportRaw,
} from "@workspace/integrations/token-binding";
import { composeDeviceRisk, fromTokenBinding } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  criticalFindingsCount: number;
  unknownSignalsCount: number;
  senderConstrained: boolean;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { deviceId: string; report: TokenBindingReportRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/token-binding/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://token-binding-bridge.local/token-binding";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Token-binding / proof-of-possession proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

const reports: Record<string, TokenBindingReportRaw> = {};
for (const n of names) reports[fixture.devices[n].deviceId] = fixture.devices[n].report;
const transport = createMockTokenBindingTransport({ reports, expectedToken: fixture.accessToken });
const connector = new TokenBindingConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, transport);

for (const name of names) {
  const spec = fixture.devices[name];
  const normalized = await connector.fetchTokenBinding(spec.deviceId);
  check(`${name}: normalized carries sourceSystem`, normalized.sourceSystem === "token-binding");
  const v = evaluateTokenBinding(normalized);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.criticalFindings.length === spec.expected.criticalFindingsCount &&
    v.unknownSignals.length === spec.expected.unknownSignalsCount &&
    v.senderConstrained === spec.expected.senderConstrained &&
    v.deviceId === spec.deviceId;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── proof-of-possession invariants ──────────────────────────────────────────────

// The ONLY path to 'none' is a positively-confirmed sender-constrained token — and
// only then is the verdict marked senderConstrained.
const clean = evaluateTokenBinding(await connector.fetchTokenBinding(fixture.devices["dpop-hardware-clean"].deviceId));
check("a DPoP + attested hardware + audience-bound + device-bound token → sender_constrained/none, senderConstrained", clean.posture === "sender_constrained" && clean.recommendedAction === "none" && clean.senderConstrained === true);
check("a sender-constrained token composes to the 'ok' tier", composeDeviceRisk([fromTokenBinding(clean)]).riskTier === "ok");

// A bound token whose PoP key belongs to ANOTHER device is the strongest negative.
const mismatch = evaluateTokenBinding(await connector.fetchTokenBinding(fixture.devices["device-mismatch"].deviceId));
check("a device-mismatched bound token → escalate + critical, NOT senderConstrained", mismatch.recommendedAction === "escalate" && mismatch.criticalFindings.includes("token_device_mismatch") && mismatch.senderConstrained === false);
check("a device-mismatched token composes to the 'blocked' tier, NEVER 'ok'", composeDeviceRisk([fromTokenBinding(mismatch)]).riskTier === "blocked");

// An unbound bearer token is replayable — contain it.
const bearer = evaluateTokenBinding(await connector.fetchTokenBinding(fixture.devices["bearer-token"].deviceId));
check("an unbound bearer token → restrict + critical, never granted", bearer.posture === "bearer_token" && bearer.recommendedAction === "restrict" && bearer.criticalFindings.includes("unbound_bearer_token"));

// No token-inspection result → gap → step_up (never sender-constrained).
const noCov = evaluateTokenBinding(normalizeReport("ghost", {} as TokenBindingReportRaw), { covered: false });
check("an uncovered device is 'unknown'/step_up, never senderConstrained", noCov.posture === "unknown" && noCov.reasonCode === "NOT_COVERED" && noCov.recommendedAction === "step_up" && noCov.senderConstrained === false);
check("an uncovered device composes to at_risk, NEVER the 'ok' tier", composeDeviceRisk([fromTokenBinding(noCov)]).riskTier !== "ok");

// The grant demands POSITIVE verification: a clean token whose bridge reachability
// was NOT reported (null) must NOT grant — fail closed.
const noReach = evaluateTokenBinding(await connector.fetchTokenBinding(fixture.devices["reachability-unreported"].deviceId));
check("a clean token with UNREPORTED bridge reachability → step_up, never sender_constrained", noReach.reasonCode === "BRIDGE_UNREACHABLE" && noReach.recommendedAction === "step_up" && noReach.senderConstrained === false);
check("only an explicit bridgeReachable:true can back a grant (null never composes to 'ok')", composeDeviceRisk([fromTokenBinding(noReach)]).riskTier !== "ok");

// A self-contradictory report — a `bearer` token WITH a claimed `hardware` key — is
// forced to keyProtection `none` by the normalizer and can never grant.
const contradiction = await connector.fetchTokenBinding(fixture.devices["bearer-with-hardware-claim"].deviceId);
check("a bearer token with a claimed hardware key normalizes keyProtection to 'none'", contradiction.keyProtection === "none");
check("a contradictory bearer/hardware token → restrict, NEVER sender_constrained/none", evaluateTokenBinding(contradiction).recommendedAction === "restrict");

// Exhaustive: brute-force the ENTIRE normalized input space (not fixture-bound), so
// the proof genuinely CONSTRAINS the allow path. Action "none" is emitted for EXACTLY
// a positively-confirmed sender-constrained token — DPoP or mTLS, an ATTESTED HARDWARE
// key, audience-restricted, bound to THIS device, with the bridge reachable — and for
// nothing else. Any unknown/missing value on a decisive field falls out of the grant.
const domains = {
  binding: ["dpop", "mtls", "bearer", "unknown"],
  keyProtection: ["hardware", "software", "none", "unknown"],
  keyAttested: [true, false, null],
  audienceRestricted: [true, false, null],
  boundToDevice: [true, false, null],
  bridgeReachable: [true, false, null],
};
const enumRes = enumerateGrantSafety({
  domains,
  build: (c) =>
    ({ sourceSystem: "token-binding", deviceId: "enum", source: "enum", ...c }) as NormalizedTokenBinding,
  evaluate: evaluateTokenBinding,
  actionOf: (v) => v.recommendedAction,
  confirmedWhenNone: (v) => v.posture === "sender_constrained" && v.senderConstrained === true,
  positivelyClean: (c) => {
    const { binding, keyProtection, keyAttested, audienceRestricted, boundToDevice, bridgeReachable } = c;
    return (
      (binding === "dpop" || binding === "mtls") &&
      keyProtection === "hardware" &&
      keyAttested === true &&
      audienceRestricted === true &&
      boundToDevice === true &&
      bridgeReachable === true
    );
  },
});
check(
  `exhaustive: over all ${enumRes.combos} input combinations, action 'none' is emitted for EXACTLY the positively-confirmed sender-constrained tokens (mismatches=${enumRes.mismatches}${enumRes.firstMismatch ? ", first=" + enumRes.firstMismatch : ""})`,
  enumRes.mismatches === 0 && enumRes.combos === productOf(domains) && enumRes.combos === 1296,
);
check("exhaustive: some clean states DO grant (the enumeration is not vacuous)", enumRes.noneCount > 0);

// Unknown ≠ bound: an unrecognized enum value normalizes to the safe unknown.
const norm = normalizeReport("n", { binding: "totally", keyProtection: "vault" } as TokenBindingReportRaw);
check("unrecognized enums normalize to 'unknown' (never a fabricated dpop/hardware)", norm.binding === "unknown" && norm.keyProtection === "unknown");
const boolNorm = normalizeReport("b", { keyAttested: "yes", boundToDevice: 1 } as unknown as TokenBindingReportRaw);
check("a non-boolean keyAttested / boundToDevice is null, never fabricated", boolNorm.keyAttested === null && boolNorm.boundToDevice === null);

// Worst-concern-wins: device-mismatch (escalate) outranks bearer (restrict).
const worst = evaluateTokenBinding(await connector.fetchTokenBinding(fixture.devices["worst-of-several"].deviceId));
check("worst-concern-wins: device mismatch (escalate) outranks the bearer restrict", worst.recommendedAction === "escalate" && worst.criticalFindings.length === 2);

// Determinism.
const d = await connector.fetchTokenBinding(fixture.devices["software-key"].deviceId);
check("evaluator is deterministic", JSON.stringify(evaluateTokenBinding(d)) === JSON.stringify(evaluateTokenBinding(d)));

// ── fabric fusion ──────────────────────────────────────────────────────────────

const signal = fromTokenBinding(mismatch);
check("fromTokenBinding emits a token_binding signal", signal.kind === "token_binding");
check("fabric fuses a device-mismatched token into an escalate verdict", composeDeviceRisk([signal]).strongestAction === "escalate");
check("a sender-constrained token contributes 'none' to the fabric", fromTokenBinding(clean).action === "none");

// ── connector guarantees ──────────────────────────────────────────────────────

let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof TokenBindingConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

const bad = new TokenBindingConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck(fixture.devices["dpop-hardware-clean"].deviceId);
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: TokenBindingConnectorError | null = null;
try { await bad.fetchTokenBinding(fixture.devices["dpop-hardware-clean"].deviceId); } catch (err) { authErr = err instanceof TokenBindingConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

let missingErr: TokenBindingConnectorError | null = null;
try { await connector.fetchTokenBinding("no-such-device"); } catch (err) { missingErr = err instanceof TokenBindingConnectorError ? err : null; }
check("an unknown device surfaces upstream_error, never an invented sender-constrained token", missingErr?.code === "upstream_error");

check("dev tier resolves to fixture mode", resolveTokenBindingConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveTokenBindingConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveTokenBindingConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveTokenBindingConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", TOKEN_BINDING_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
