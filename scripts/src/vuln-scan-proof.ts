// Vulnerability-scanning proof — fully OFFLINE and deterministic.
//
// Drives the read-only vuln-scan connector against a deterministic mock
// (normalization incl. CVSS-band fallback, pagination, read-only enforcement,
// auth failure, gating) and runs the pure aggregating evaluator per device —
// asserting each device's findings resolve to the right risk posture and the
// action it warrants (critical/exploitable ⇒ restrict). No network, no scan data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VulnConnectorError,
  VulnScanConnector,
  createMockVulnTransport,
  evaluateVulnPosture,
  guardReadOnly,
  normalizeFinding,
  resolveVulnScanConnector,
  type VulnFindingRaw,
} from "@workspace/integrations/vuln-scan";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Expected {
  posture: string; highestSeverity: string; reasonCode: string; recommendedAction: string; exploitableCount: number; findingCount: number;
}
interface Fixture {
  accessToken: string;
  devices: Record<string, { findings: VulnFindingRaw[]; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/vuln-scan/findings.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.vulnscan.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Vulnerability-scanning proof");
const deviceNames = Object.keys(fixture.devices);
console.log(`devices=${deviceNames.length}`);

// Flatten all findings across devices to exercise the connector's paging/normalize.
const allFindings: VulnFindingRaw[] = deviceNames.flatMap((d) => fixture.devices[d].findings);
const transport = createMockVulnTransport({ findings: allFindings, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new VulnScanConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchFindings();
check(`pagination reassembles all ${allFindings.length} findings`, normalized.length === allFindings.length);
check("every normalized finding carries sourceSystem", normalized.every((f) => f.sourceSystem === "vuln-scan"));

// CVSS-band fallback: dev-medium has no severity label, only cvss 5.0 → medium.
check("severity falls back to the CVSS band when the label is missing", normalizeFinding({ deviceId: "x", cvssScore: 5.0 }).severity === "medium");
check("a 9.8 CVSS with no label normalizes to critical", normalizeFinding({ deviceId: "x", cvssScore: 9.8 }).severity === "critical");

// Per-device posture aggregation.
for (const name of deviceNames) {
  const spec = fixture.devices[name];
  const findings = normalized.filter((f) => f.deviceId === name);
  // `scanned: true` is stated, not assumed. Appearing in `fixture.devices` IS the
  // scan record — these are devices the scanner reported on. Filtering to a
  // per-device slice throws that away, and for `dev-clean` the slice is empty, so
  // the evaluator can no longer tell "scanned, nothing found" from "never scanned"
  // and now fails closed to NOT_SCANNED. Saying so here is the caller doing its
  // job: only the caller still knows a scan happened.
  const v = evaluateVulnPosture(findings, { scanned: true });
  const ok = v.posture === spec.expected.posture && v.highestSeverity === spec.expected.highestSeverity &&
    v.reasonCode === spec.expected.reasonCode && v.recommendedAction === spec.expected.recommendedAction &&
    v.exploitableCount === spec.expected.exploitableCount && v.findingCount === spec.expected.findingCount;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// The worst finding drives the verdict (critical dominates a co-present medium).
check(
  "the worst finding drives the posture (critical dominates medium)",
  evaluateVulnPosture(normalized.filter((f) => f.deviceId === "dev-critical")).posture === "critical_exposure",
);

// Unscanned ≠ clean: no scan record resolves to unknown, not clean.
const unscanned = evaluateVulnPosture([], { scanned: false });
check("an unscanned device is 'unknown', never 'clean'", unscanned.posture === "unknown" && unscanned.reasonCode === "NOT_SCANNED");
check("a scanned device with zero findings is 'clean'", evaluateVulnPosture([], { scanned: true }).posture === "clean");

// Determinism.
const dc = normalized.filter((f) => f.deviceId === "dev-critical");
check("evaluator is deterministic", JSON.stringify(evaluateVulnPosture(dc)) === JSON.stringify(evaluateVulnPosture(dc)));

// read-only enforcement
let readOnly = false;
try { guardReadOnly("PUT"); } catch (err) { readOnly = err instanceof VulnConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new VulnScanConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: VulnConnectorError | null = null;
try { await bad.listFindings(); } catch (err) { authErr = err instanceof VulnConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveVulnScanConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveVulnScanConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live + token resolves live", resolveVulnScanConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", VULN_SCAN_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "vuln-scan",
  resolve: (env) => resolveVulnScanConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    VULN_SCAN_ACCESS_TOKEN: "t",
  },
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
