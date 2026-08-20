// Network / NAC posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only NAC connector against a deterministic mock (normalization,
// pagination, read-only enforcement, auth failure, gating), runs the pure network
// evaluator over an auth-state matrix, and confirms the verdict fuses into the
// unified posture composer via the new `network` adapter. No network, no real
// controller, no wall clock (time injected).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NetworkConnectorError,
  NetworkNacConnector,
  createMockNetworkTransport,
  evaluateNetwork,
  guardReadOnly,
  resolveNetworkNacConnector,
  type NetworkPostureRaw,
  type NormalizedNetworkSignal,
} from "@workspace/integrations/network-nac";
import { composeDeviceRisk, fromNetwork } from "@workspace/posture-composition";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Expected { authState: string; posture: string; reasonCode: string; recommendedAction: string; }
interface FixtureRow extends NetworkPostureRaw { expected: Expected; }
interface Fixture { accessToken: string; observedAt: string; sessions: FixtureRow[]; }

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/network-nac/sessions.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const OBSERVED_AT = fixture.observedAt;
const NOW_MS = Date.parse(OBSERVED_AT);
const BASE_URL = "https://api.nac.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Network / NAC posture proof");
console.log(`sessions=${fixture.sessions.length} observedAt=${OBSERVED_AT}`);

const rawSessions: NetworkPostureRaw[] = fixture.sessions.map(({ expected, ...raw }) => raw);
const transport = createMockNetworkTransport({ sessions: rawSessions, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new NetworkNacConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const listed = await connector.listSessions();
check(`pagination reassembles all ${fixture.sessions.length} sessions`, listed.length === fixture.sessions.length);

const signals = await connector.fetchNetworkPosture(OBSERVED_AT);
const byDevice = new Map<string, NormalizedNetworkSignal>(signals.map((s) => [s.deviceId, s]));

for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId);
  check(`normalize ${s.deviceId} → authState ${s.expected.authState}`, sig?.authState === s.expected.authState);
}
check(
  "switch port / AP is carried as a coarse access-location",
  byDevice.get("dev-trusted")?.accessLocation === "sw3/gi1/0/12" && byDevice.get("dev-unauth")?.accessLocation === "ap-lobby-2",
);
check("provenance is deterministic", signals.every((s) => s.sourceSystem === "network-nac" && s.observedAt === OBSERVED_AT));

for (const s of fixture.sessions) {
  const v = evaluateNetwork(byDevice.get(s.deviceId)!, NOW_MS);
  const ok = v.posture === s.expected.posture && v.reasonCode === s.expected.reasonCode && v.recommendedAction === s.expected.recommendedAction;
  check(`evaluate ${s.deviceId} → ${s.expected.posture}/${s.expected.recommendedAction}`, ok);
}

// A once-trusted device with a stale auth is no longer proof of current state.
// ── SEGMENT APPROPRIATENESS ──────────────────────────────────────────────────
//
// THE DEFECT THIS REPLACES. The single assertion that used to live here read
//
//     check("a fresh authenticated+compliant device is trusted",
//       evaluateNetwork(signal, NOW_MS).posture === "on_trusted_segment");
//
// and it passed for a device on ANY VLAN, because the evaluator never looked at the
// segment. The connector read it, normalized it, carried it into evidence — and the
// word "segment" appeared exactly once in the evaluator, inside that posture string.
// A device authenticated onto the guest or management VLAN graded identically to one
// on the corporate user VLAN, with action `none`. The proof asserted the name, not
// the property.
{
  const base = byDevice.get("dev-trusted")!;
  const on = (segment: string | null) => ({ ...base, segment });

  // With NO policy, the segment is not graded — and the verdict no longer claims it is.
  const unverified = evaluateNetwork(base, NOW_MS);
  check("with no segment policy the verdict does NOT claim trust",
    unverified.posture === "on_unverified_segment" &&
    unverified.reasonCode === "AUTHENTICATED_SEGMENT_UNVERIFIED");
  check("...and it still grants — an operator who expressed no policy did not ask for the check",
    unverified.recommendedAction === "none");

  const POLICY = { expected: ["VLAN10", "corp-wired"], restricted: ["VLAN60", "VLAN70"] };

  // Non-vacuity: the expected segment must still clear, or every refusal below is trivial.
  const good = evaluateNetwork(on("VLAN10"), NOW_MS, { segmentPolicy: POLICY });
  check("an EXPECTED segment is trusted, and now genuinely verified",
    good.posture === "on_trusted_segment" && good.reasonCode === "AUTHENTICATED_TRUSTED_SEGMENT" &&
    good.recommendedAction === "none");

  // THE CASE THAT USED TO GRANT: the guest VLAN.
  const guest = evaluateNetwork(on("VLAN40"), NOW_MS, { segmentPolicy: POLICY });
  check("an UNEXPECTED segment steps up — this is the case that used to grant",
    guest.posture === "on_unexpected_segment" && guest.reasonCode === "SEGMENT_UNEXPECTED" &&
    guest.recommendedAction === "step_up");

  // The management VLAN outranks it: lateral movement into the control plane.
  const mgmt = evaluateNetwork(on("VLAN60"), NOW_MS, { segmentPolicy: POLICY });
  check("a RESTRICTED segment restricts — reaching the management VLAN is not a misconfiguration",
    mgmt.reasonCode === "SEGMENT_RESTRICTED" && mgmt.recommendedAction === "restrict");
  check("...and restricted OUTRANKS merely-unexpected, so the worse finding wins",
    mgmt.recommendedAction === "restrict" && guest.recommendedAction === "step_up");

  // A segment listed as BOTH expected and restricted is expected — an explicit
  // allowance beats a general caution, which is what lets a management workstation
  // legitimately sit on the management VLAN.
  check("expected wins over restricted when a segment is in both lists",
    evaluateNetwork(on("VLAN60"), NOW_MS,
      { segmentPolicy: { expected: ["VLAN60"], restricted: ["VLAN60"] } }).recommendedAction === "none");

  // A policy that cannot be applied must foreclose, not assume compliance.
  check("a policy with NO reported segment forecloses rather than assuming it is fine",
    evaluateNetwork(on(null), NOW_MS, { segmentPolicy: POLICY }).reasonCode ===
      "SEGMENT_UNREPORTED_UNDER_POLICY");
  check("...and an EMPTY expected list is treated as no policy, not as 'nothing is allowed'",
    evaluateNetwork(on("VLAN40"), NOW_MS, { segmentPolicy: { expected: [] } }).reasonCode ===
      "AUTHENTICATED_SEGMENT_UNVERIFIED");

  // Real-world spelling drift: the same VLAN arrives differently from NAC, RADIUS
  // and switch inventories. A policy that misses on whitespace silently stops working.
  check("segment matching is trimmed and case-insensitive across vendor spellings",
    ["  VLAN10", "vlan10", "VLAN10  ", "Vlan10"].every(
      (sp) => evaluateNetwork(on(sp), NOW_MS, { segmentPolicy: POLICY }).recommendedAction === "none"));
  check("...but it is not merely a substring match — VLAN100 is not VLAN10",
    evaluateNetwork(on("VLAN100"), NOW_MS, { segmentPolicy: POLICY }).reasonCode === "SEGMENT_UNEXPECTED");

  // Segment grading must not override the stronger concerns that precede it.
  check("an unauthenticated device still restricts regardless of segment policy",
    evaluateNetwork({ ...base, authState: "unauthenticated", segment: "VLAN10" }, NOW_MS,
      { segmentPolicy: POLICY }).recommendedAction === "restrict");
  check("a NAC-noncompliant device still steps up even on an expected segment",
    evaluateNetwork({ ...base, nacCompliant: false, segment: "VLAN10" }, NOW_MS,
      { segmentPolicy: POLICY }).reasonCode === "NAC_NONCOMPLIANT");

  // ── SESSION-PLANE POSTURE: the grant must be earned ─────────────────────────
  //
  // THE DEFECT THIS REPLACES, second verse. The segment fix above stopped the
  // evaluator claiming a segment it never checked. The SAME shape survived one
  // layer down: both grant exits returned `none` whether or not `nacCompliant`
  // and auth freshness were ever REPORTED. A device whose source said "stale" or
  // "noncompliant" stepped up; a device whose source said NOTHING graded
  // identical to verified-good. Executed counterexample (2026-08-20): authenticated
  // + nacCompliant:null + lastAuthAt:null on an expected segment → on_trusted_segment
  // / none. Per docs/RADIUS_NAC_LIVE_SHAPE_CHECK.md those two fields are not
  // authentication facts and never arrive with a plain RADIUS result — so the
  // unreported combination is the COMMON live case, not an edge.
  {
    // Segment pinned to an expected one, so every check below isolates the
    // SESSION plane — the fixture device's own segment is not in POLICY.
    const onExpected = { ...base, segment: "VLAN10" };
    const unreported = { ...onExpected, nacCompliant: null, lastAuthAt: null, freshness: "unknown" as const };

    // THE CASE THAT USED TO GRANT.
    const ghost = evaluateNetwork(unreported, NOW_MS, { segmentPolicy: POLICY });
    check("SESSION-PLANE: nothing reported → monitor, never a clean grant — the case that used to return none",
      ghost.reasonCode === "AUTHENTICATED_POSTURE_UNVERIFIED" && ghost.recommendedAction === "monitor");
    check("...and the segment posture survives, because the segment WAS verified",
      ghost.posture === "on_trusted_segment");

    // Each unreported field alone is enough to withhold the clean grant.
    check("unreported compliance ALONE withholds the clean grant",
      evaluateNetwork({ ...onExpected, nacCompliant: null }, NOW_MS, { segmentPolicy: POLICY })
        .reasonCode === "AUTHENTICATED_POSTURE_UNVERIFIED");
    check("unknown freshness ALONE withholds the clean grant",
      evaluateNetwork({ ...onExpected, lastAuthAt: null, freshness: "unknown" }, NOW_MS, { segmentPolicy: POLICY })
        .reasonCode === "AUTHENTICATED_POSTURE_UNVERIFIED");

    // The lattice, asserted as an ordering rather than three loose facts:
    // verified-good (none) > unreported (monitor) > reported-bad (step_up).
    const earned = evaluateNetwork(onExpected, NOW_MS, { segmentPolicy: POLICY });
    const staleV = evaluateNetwork(onExpected, NOW_MS + 60 * 60 * 1000, { segmentPolicy: POLICY });
    check("LATTICE: verified-good grants, unreported monitors, reported-stale steps up — three distinct rungs",
      earned.recommendedAction === "none" && ghost.recommendedAction === "monitor" && staleV.recommendedAction === "step_up");

    // The no-policy grant path is guarded identically.
    check("the no-policy grant is guarded too: unreported posture monitors there as well",
      evaluateNetwork(unreported, NOW_MS).reasonCode === "AUTHENTICATED_POSTURE_UNVERIFIED" &&
      evaluateNetwork(unreported, NOW_MS).posture === "on_unverified_segment");

    // Non-vacuity: the earned grant still exists, or every refusal above is trivial.
    check("NON-VACUITY: compliant + fresh on an expected segment still earns the clean grant",
      earned.reasonCode === "AUTHENTICATED_TRUSTED_SEGMENT" && earned.recommendedAction === "none");
  }
}
check("far-future makes the trusted device stale → step_up", evaluateNetwork(byDevice.get("dev-trusted")!, NOW_MS + 60 * 60 * 1000).reasonCode === "STALE_NETWORK_STATE");

// ── fuses into the unified composer via the new `network` adapter ─────────────
const unauthVerdict = evaluateNetwork(byDevice.get("dev-unauth")!, NOW_MS);
const composed = composeDeviceRisk([fromNetwork(unauthVerdict)]);
check("an unauthenticated NAC verdict composes to restrict/blocked", composed.strongestAction === "restrict" && composed.riskTier === "blocked");
check("the network driver is carried with its reason", composed.drivers[0]?.kind === "network" && composed.drivers[0]?.reason === "UNAUTHENTICATED_AT_CONNECTION");

// ── read-only enforcement ──────────────────────────────────────────────────────
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof NetworkConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// ── auth failure ──────────────────────────────────────────────────────────────
const bad = new NetworkNacConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: NetworkConnectorError | null = null;
try { await bad.listSessions(); } catch (err) { authErr = err instanceof NetworkConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// ── gating ────────────────────────────────────────────────────────────────────
check("dev tier resolves to fixture mode", resolveNetworkNacConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveNetworkNacConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live + token resolves live", resolveNetworkNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "network-nac",
  resolve: (env) => resolveNetworkNacConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    NAC_ACCESS_TOKEN: "t",
  },
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
