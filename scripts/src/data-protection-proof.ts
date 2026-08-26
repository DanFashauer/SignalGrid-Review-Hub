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
  type DlpTransport,
} from "@workspace/integrations/data-protection";
import { checkLiveGateIsolated, checkCollectionRefusals } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

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

// Fail-safe (wedge #8, caught by the shift-1 sweep): UNREPORTED DLP enforcement
// must not read as protected. `=== false` alone let `null` fall through: a
// covered device with an observed-empty violation feed and unverifiable
// enforcement minted a full protected/none grant — "no violations" from a DLP
// layer we cannot confirm was enforcing. Unreported grades `monitor`;
// confirmed-unenforced stays the stronger step_up (a reported bad state).
const dlpUnverified = evaluateDlpPosture(normalizeDevice({ deviceId: "d-null", violations: [] }));
check("unreported DLP enforcement → monitor/POLICY_ENFORCEMENT_UNVERIFIED, never protected (wedge #8)",
  dlpUnverified.recommendedAction === "monitor" && dlpUnverified.reasonCode === "POLICY_ENFORCEMENT_UNVERIFIED" && dlpUnverified.posture === "unknown");

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. Wedge #8 above was exactly the kind fixtures
// never catch. Every combination of every axis is executed through the REAL
// normalizer + evaluator and the granting set is pinned by equality.
{
  const CONTAINED = [{ violationId: "c", channel: "usb", action: "blocked", severity: "medium", dataClass: "phi" }];
  const EGRESS_LOW = [{ violationId: "l", channel: "web", action: "allowed", severity: "low", dataClass: "confidential" }];
  const EGRESS_REGULATED = [{ violationId: "r", channel: "cloud_storage", action: "allowed", severity: "medium", dataClass: "phi" }];
  // Unmapped action — containment unproven, must count as egressed (fail-safe).
  const UNPROVEN = [{ violationId: "u", channel: "email", action: "something-weird", severity: "low", dataClass: "confidential" }];
  const domains = {
    covered: [true, false],
    dlpPolicyEnforced: [true, false, undefined],
    violations: [null, [], CONTAINED, EGRESS_LOW, EGRESS_REGULATED, UNPROVEN],
  } as const;

  type Enum = { dev: ReturnType<typeof normalizeDevice>; covered: boolean };
  const build = (c: Record<string, unknown>): Enum => ({
    dev: normalizeDevice({
      deviceId: "dev.enum",
      dlpPolicyEnforced: c.dlpPolicyEnforced as boolean | undefined,
      violations: c.violations === null ? undefined : (c.violations as DataProtectionRaw["violations"]),
    }),
    covered: c.covered as boolean,
  });

  const swept = enumerateGrantSafety<Enum, ReturnType<typeof evaluateDlpPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateDlpPosture(s.dev, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    // The ONLY protected state: covered, enforcement POSITIVELY confirmed, and
    // the violation feed observed and empty.
    positivelyClean: (c) =>
      c.covered === true && c.dlpPolicyEnforced === true && c.violations === domains.violations[1],
    confirmedWhenNone: (v) => v.reasonCode === "NO_VIOLATIONS" && v.posture === "protected",
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 2 * 3 * 6);
  check("ENUMERATION: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: exactly ONE granting state (non-vacuous)", swept.noneCount === 1);

  // NEGATIVE CONTROL — the enumeration can fail: declare DLP enforcement
  // irrelevant to protection and the harness must object, because the evaluator
  // (correctly) refuses to grant unenforced or unverified-enforcement devices.
  const wrongPredicate = enumerateGrantSafety<Enum, ReturnType<typeof evaluateDlpPosture>>({
    domains,
    build,
    evaluate: (s) => evaluateDlpPosture(s.dev, { covered: s.covered }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) => c.covered === true && c.violations === domains.violations[1],
  });
  check("NEGATIVE CONTROL: declaring DLP enforcement irrelevant is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");
}

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


// COLLECTION SHAPE and PAGE-CAP REFUSAL — both survived mutation until 2026-08-25.
// Shared helper, one statement of a rule nine families implement identically.
await checkCollectionRefusals({
  check,
  family: "data-protection",
  listWith: (t, pageLimit) => () =>
    new DataProtectionConnector({ accessToken: "t", baseUrl: BASE_URL, pageLimit }, t as unknown as DlpTransport).listDevices(),
  codeOf: (e) => (e instanceof DlpConnectorError ? e.code : undefined),
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
