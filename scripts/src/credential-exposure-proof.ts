// Credential-exposure posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only credential-exposure connector against a deterministic mock
// (normalization of vendor location/kind/severity/validity/remediation
// vocabularies, pagination, read-only enforcement, auth failure, gating) and runs
// the pure evaluator per device — asserting each device's secret findings +
// scanner state resolve to the right posture and the action it warrants (a live
// high-value secret ⇒ escalate; an unconfirmed remediation ⇒ treated as still
// exposed; no coverage ⇒ unknown, never clean). No network, no real secrets.
//
// The domain: the developer / AI-agent laptop threat surface — secrets in shell
// history, .env, CLI caches, and AI-agent configs & logs (Cursor/Copilot/Claude
// Code). SignalGrid does not scan for or remediate them; it consumes the verdict
// and turns exposure into a runtime decision that contains the blast radius.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CredentialExposureConnector,
  CredentialConnectorError,
  createMockCredentialTransport,
  evaluateCredentialExposure,
  guardReadOnly,
  normalizeDevice,
  normalizeFinding,
  resolveCredentialExposureConnector,
  type CredentialExposureRaw,
} from "@workspace/integrations/credential-exposure";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  findingCount: number;
  exposedCount: number;
  highestSeverity: string;
  scannerEnrolled: boolean | null;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { record: CredentialExposureRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/credential-exposure/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.secrets.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Credential-exposure posture proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

// Feed every device record through the connector to exercise paging/normalize.
const records: CredentialExposureRaw[] = names.map((n) => fixture.devices[n].record);
const transport = createMockCredentialTransport({ devices: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new CredentialExposureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchDevices();
check(`pagination reassembles all ${records.length} devices`, normalized.length === records.length);
check("every normalized device carries sourceSystem", normalized.every((d) => d.sourceSystem === "credential-exposure"));

// Per-device posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.devices[name];
  const d = normalized.find((x) => x.deviceId === spec.record.deviceId)!;
  const v = evaluateCredentialExposure(d);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.findingCount === spec.expected.findingCount &&
    v.exposedCount === spec.expected.exposedCount &&
    v.highestSeverity === spec.expected.highestSeverity &&
    v.scannerEnrolled === spec.expected.scannerEnrolled;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// No coverage ≠ clean: a device with no scanner record is unknown (a blind spot).
const notCovered = evaluateCredentialExposure(normalizeDevice({ deviceId: "ghost" }), { covered: false });
check("an uncovered device is 'unknown', never 'clean'", notCovered.posture === "unknown" && notCovered.reasonCode === "NOT_COVERED");

// Fail-safe: a finding with unknown remediation AND unknown validity is treated as
// still exposed (never assumed cleaned up).
const unknownState = normalizeFinding({ findingId: "x", location: "agent_log", kind: "api_token", severity: "high", validity: "mystery", remediation: "in-triage" });
check("an unconfirmed remediation/validity normalizes to exposed (fail-safe)", unknownState.validity === "unknown" && unknownState.remediation === "unknown" && unknownState.exposed === true);

// Only a provable remediation OR revocation contains a secret; open/unknown leave
// it exposed.
check("a remediated finding is contained (not exposed)", normalizeFinding({ remediation: "remediated", validity: "active" }).exposed === false);
check("a revoked credential is contained even if remediation is open", normalizeFinding({ remediation: "open", validity: "revoked" }).exposed === false);
check("an open, still-active finding is exposed", normalizeFinding({ remediation: "open", validity: "active" }).exposed === true);
// Fail-safe (regression): "closed" is an ambiguous terminal state (dismissed /
// won't-fix / accepted-risk) — the secret may still be live, so it must NOT be
// treated as remediated. A live high-value key marked "closed" still escalates.
check("an ambiguous 'closed' status does NOT contain a secret (fail-safe)", normalizeFinding({ remediation: "closed", validity: "active" }).remediation === "unknown" && normalizeFinding({ remediation: "closed", validity: "active" }).exposed === true);
const closedKey = evaluateCredentialExposure(normalizeDevice({ deviceId: "c-closed", scannerEnrolled: true, findings: [{ findingId: "cl", location: "dotenv", kind: "cloud_key", severity: "critical", validity: "active", remediation: "closed" }] }));
check("a live cloud key marked 'closed' still escalates (not 'remediated')", closedKey.posture === "active_credential_exposed" && closedKey.recommendedAction === "escalate");

// The AI-agent angle: a live cloud key in an agent config is a high-value exposure
// and must escalate, not read as a calm low finding.
const agentKey = evaluateCredentialExposure(normalizeDevice({
  deviceId: "c-ak",
  scannerEnrolled: true,
  findings: [{ findingId: "ak", location: "agent_config", kind: "cloud_key", severity: "critical", validity: "active", remediation: "open" }],
}));
check("a live cloud key in an agent config escalates (high-value exposure)", agentKey.posture === "active_credential_exposed" && agentKey.recommendedAction === "escalate");

// High-value classification: cloud/private-key/db/oauth kinds OR critical/high
// severity are high-value; a low-severity generic secret is not.
check("cloud/private-key/db/oauth kinds are high-value", ["cloud_key", "private_key", "db_credential", "oauth_token"].every((k) => normalizeFinding({ kind: k, severity: "low" }).highValue === true));
check("a low-severity generic secret is not high-value", normalizeFinding({ kind: "generic_secret", severity: "low" }).highValue === false);
check("critical/high severity is high-value regardless of kind", normalizeFinding({ kind: "generic_secret", severity: "high" }).highValue === true);

// Order-proof: a remediated finding (monitor) co-present with a live high-value
// exposure (escalate) → the stronger escalate wins.
const mixed = evaluateCredentialExposure(normalizeDevice({
  deviceId: "c-mixed",
  scannerEnrolled: true,
  findings: [
    { findingId: "ok", location: "shell_history", kind: "api_token", severity: "high", validity: "active", remediation: "remediated" },
    { findingId: "bad", location: "dotenv", kind: "private_key", severity: "high", validity: "active", remediation: "open" },
  ],
}));
check("a live high-value exposure (escalate) outranks a co-present remediated finding (monitor)", mixed.recommendedAction === "escalate" && mixed.exposedCount === 1);

// Unmapped location/kind normalize to unknown (never silently mis-bucketed).
check("an unmapped location/kind normalizes to 'unknown'", normalizeFinding({ location: "some-new-place", kind: "brand-new-kind" }).location === "unknown" && normalizeFinding({ kind: "brand-new-kind" }).kind === "unknown");

// Determinism.
const ck = normalized.find((d) => d.deviceId === "c-agent-key")!;
check("evaluator is deterministic", JSON.stringify(evaluateCredentialExposure(ck)) === JSON.stringify(evaluateCredentialExposure(ck)));

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("DELETE"); } catch (err) { readOnly = err instanceof CredentialConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new CredentialExposureConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: CredentialConnectorError | null = null;
try { await bad.listDevices(); } catch (err) { authErr = err instanceof CredentialConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveCredentialExposureConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveCredentialExposureConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveCredentialExposureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveCredentialExposureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CREDENTIAL_EXPOSURE_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "credential-exposure",
  resolve: (env) => resolveCredentialExposureConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    CREDENTIAL_EXPOSURE_ACCESS_TOKEN: "t",
  },
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
