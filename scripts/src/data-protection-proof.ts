// Data-protection / DLP posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only DLP connector against a deterministic mock (normalization
// of vendor channel/action/class vocabularies, pagination, read-only enforcement,
// auth failure, gating) and runs the pure evaluator per device — asserting each
// device's violations + policy state resolve to the right posture and the action
// it warrants (regulated data that left ⇒ escalate; an unclassifiable DLP outcome
// ⇒ treated as egress; no coverage ⇒ unknown, never protected). No network, no
// real data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DataProtectionConnector,
  DlpConnectorError,
  createMockDlpTransport,
  evaluateDlpPosture,
  guardReadOnly,
  normalizeDevice,
  normalizeViolation,
  resolveDataProtectionConnector,
  type DataProtectionRaw,
} from "@workspace/integrations/data-protection";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  violationCount: number;
  egressCount: number;
  highestSeverity: string;
  dlpPolicyEnforced: boolean | null;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { record: DataProtectionRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/data-protection/devices.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.dlp.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Data-protection / DLP posture proof");
const names = Object.keys(fixture.devices);
console.log(`devices=${names.length}`);

// Feed every device record through the connector to exercise paging/normalize.
const records: DataProtectionRaw[] = names.map((n) => fixture.devices[n].record);
const transport = createMockDlpTransport({ devices: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new DataProtectionConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchDevices();
check(`pagination reassembles all ${records.length} devices`, normalized.length === records.length);
check("every normalized device carries sourceSystem", normalized.every((d) => d.sourceSystem === "data-protection"));

// Per-device posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.devices[name];
  const d = normalized.find((x) => x.deviceId === spec.record.deviceId)!;
  const v = evaluateDlpPosture(d);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.violationCount === spec.expected.violationCount &&
    v.egressCount === spec.expected.egressCount &&
    v.highestSeverity === spec.expected.highestSeverity &&
    v.dlpPolicyEnforced === spec.expected.dlpPolicyEnforced;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// No coverage ≠ protected: a device with no DLP record is unknown (a blind spot).
const notCovered = evaluateDlpPosture(normalizeDevice({ deviceId: "ghost" }), { covered: false });
check("an uncovered device is 'unknown', never 'protected'", notCovered.posture === "unknown" && notCovered.reasonCode === "NOT_COVERED");

// Fail-safe: an UNKNOWN/unmapped DLP action is treated as egress (never assumed
// contained).
const unknownAction = normalizeViolation({ violationId: "x", action: "some-brand-new-verdict", severity: "high", dataClass: "pii" });
check("an unmapped DLP action normalizes to 'unknown' and counts as egress", unknownAction.action === "unknown" && unknownAction.egressed === true);
const unknownActionDevice = evaluateDlpPosture(normalizeDevice({
  deviceId: "d-ua",
  dlpPolicyEnforced: true,
  violations: [{ violationId: "x", action: "some-brand-new-verdict", severity: "high", dataClass: "pii" }],
}));
check("an unclassifiable action on regulated data → confirmed_exfiltration (fail-safe)", unknownActionDevice.posture === "confirmed_exfiltration" && unknownActionDevice.recommendedAction === "escalate");

// Only a provable BLOCK contains data; audit/warn/monitor/notify are allow-and-log
// (the data still leaves), and allowed/overridden obviously egress.
check("only a provable block contains data (blocked/quarantined not egress)", normalizeViolation({ action: "blocked" }).egressed === false && normalizeViolation({ action: "quarantined" }).egressed === false);
check("audit/warn/monitor/notify allow-and-log modes are egress (data still leaves)", ["audited", "monitored", "warned", "notified"].every((a) => normalizeViolation({ action: a }).egressed === true));
check("allowed and overridden actions are egress", normalizeViolation({ action: "allowed" }).egressed === true && normalizeViolation({ action: "user-override" }).egressed === true);

// Fail-safe (regression): warn/monitor-mode DLP lets the data proceed, so a
// critical PHI item leaving under "monitored"/"warned" must escalate, not read as
// calmly "monitored". This was a real fail-open before only-block-contains.
const warnModePhi = evaluateDlpPosture(normalizeDevice({ deviceId: "d-warn", dlpPolicyEnforced: true, violations: [{ violationId: "w", channel: "email", action: "monitored", severity: "critical", dataClass: "phi" }] }));
check("a warn/monitor-mode egress of critical PHI escalates (not 'monitored')", warnModePhi.posture === "confirmed_exfiltration" && warnModePhi.recommendedAction === "escalate");

// PHI/PII/PCI are flagged regulated; internal/unclassified are not.
check("PHI/PII/PCI classes are flagged regulated", ["phi", "pii", "pci"].every((c) => normalizeViolation({ dataClass: c }).regulated === true));
check("internal/unclassified are not regulated", normalizeViolation({ dataClass: "internal" }).regulated === false);

// Order-proof: a contained violation (monitor) co-present with a regulated egress
// (escalate) → the stronger escalate wins.
const mixed = evaluateDlpPosture(normalizeDevice({
  deviceId: "d-mixed",
  dlpPolicyEnforced: true,
  violations: [
    { violationId: "ok", channel: "cloud", action: "blocked", severity: "high", dataClass: "pii" },
    { violationId: "bad", channel: "email", action: "allowed", severity: "critical", dataClass: "phi" },
  ],
}));
check("a regulated egress (escalate) outranks a co-present contained violation (monitor)", mixed.recommendedAction === "escalate" && mixed.egressCount === 1);

// A high-severity egress (even unclassified) still escalates (severity path).
const highUnclassified = evaluateDlpPosture(normalizeDevice({ deviceId: "d-hu", dlpPolicyEnforced: true, violations: [{ channel: "web", action: "allowed", severity: "high", dataClass: "confidential" }] }));
check("a high-severity egress escalates even when data class is not regulated", highUnclassified.posture === "confirmed_exfiltration");

// Determinism.
const de = normalized.find((d) => d.deviceId === "d-exfil-phi")!;
check("evaluator is deterministic", JSON.stringify(evaluateDlpPosture(de)) === JSON.stringify(evaluateDlpPosture(de)));

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("DELETE"); } catch (err) { readOnly = err instanceof DlpConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new DataProtectionConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: DlpConnectorError | null = null;
try { await bad.listDevices(); } catch (err) { authErr = err instanceof DlpConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveDataProtectionConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveDataProtectionConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveDataProtectionConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveDataProtectionConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", DLP_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "data-protection",
  resolve: (env) => resolveDataProtectionConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    DLP_ACCESS_TOKEN: "t",
  },
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
