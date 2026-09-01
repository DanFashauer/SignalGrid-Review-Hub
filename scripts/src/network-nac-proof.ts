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
  type NetworkAuthState,
  type NormalizedNetworkSignal,
  type NetworkTransport,
} from "@workspace/integrations/network-nac";
import { composeDeviceRisk, fromNetwork } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";
import { checkLiveGateIsolated, checkCollectionRefusals } from "./lib/live-gate.js";

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

  // THE FAIL-OPEN ECC CONFIRMED (2026-09-01): a lastAuthAt in the FUTURE read as the
  // freshest possible auth (nowMs - t negative, trivially <= staleAfterMs) and, with a
  // compliant flag on an expected segment, granted the trusted-segment verdict. The
  // two sibling connectors guarded this; this one did not. One shared body now does.
  const futureAuth = evaluateNetwork(
    { ...on("VLAN10"), lastAuthAt: new Date(NOW_MS + 10 * 60 * 1000).toISOString(), nacCompliant: true },
    NOW_MS, { segmentPolicy: POLICY },
  );
  check("a lastAuthAt in the FUTURE (beyond clock skew) is unknown, not fresh — the verdict is NOT trusted",
    futureAuth.reasonCode === "AUTHENTICATED_POSTURE_UNVERIFIED" && futureAuth.recommendedAction === "monitor");
  // ...and the guard is not over-tight: seconds of skew are a clock, not a contradiction.
  const skewAuth = evaluateNetwork(
    { ...on("VLAN10"), lastAuthAt: new Date(NOW_MS + 30 * 1000).toISOString(), nacCompliant: true },
    NOW_MS, { segmentPolicy: POLICY },
  );
  check("a lastAuthAt 30s ahead (within skew tolerance) still reads fresh and trusts",
    skewAuth.reasonCode === "AUTHENTICATED_TRUSTED_SEGMENT" && skewAuth.recommendedAction === "none");
  // The BOUND side of the same body: staleAfterMs: Infinity made a 7-year-old auth read
  // fresh (every finite age <= Infinity). A garbled bound resolves to STALE — the raising
  // member (step_up), not "unknown" (monitor), which would grade a posed 0 worse than no
  // bound at all. Infinity is the discriminating value; NaN and 0 already read stale.
  const ancientAuth = { ...on("VLAN10"), lastAuthAt: new Date(NOW_MS - 7 * 365 * 24 * 3600 * 1000).toISOString(), nacCompliant: true };
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, 0]) {
    const v = evaluateNetwork(ancientAuth, NOW_MS, { segmentPolicy: POLICY, staleAfterMs: bad });
    check(`a garbled staleAfterMs (${String(bad)}) grades a 7-year-old auth STALE (step_up) — the strongest member, not merely "not trusted"`,
      v.reasonCode === "STALE_NETWORK_STATE" && v.recommendedAction === "step_up");
  }

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

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1 (DR-005 era): a grant must be UNREACHABLE by any
// unknown, missing, stale, or contradictory input. The two defects this family
// shipped — the segment never evaluated, then the session-plane grant issued on
// unreported compliance/freshness — were both invisible to fixture-driven
// checks, because fixtures exercise the states someone thought of. This block
// enumerates every combination of every axis and pins the granting set by
// equality, so the NEXT such defect fails the proof instead of shipping.
{
  const NOW = Date.parse("2026-07-20T12:00:00Z");
  const FRESH_ISO = "2026-07-20T11:55:00Z";   // 5 min old — fresh
  const STALE_ISO = "2026-07-20T10:00:00Z";   // 2 h old — stale
  const AUTH = ["authenticated", "unauthenticated", "quarantined", "unknown"] as const;
  const COMPLIANT = [true, false, null] as const;
  // lastAuthAt drives freshness INSIDE the evaluator: fresh, stale, unreported,
  // and unparseable (NaN → freshness unknown, same as unreported — asserted below).
  const LAST_AUTH = [FRESH_ISO, STALE_ISO, null, "not-a-date"] as const;
  // Against a fixed policy {expected:[VLAN10], restricted:[VLAN60]}: an expected
  // segment, a restricted one, an unlisted one, and unreported.
  const SEGMENT = ["VLAN10", "VLAN60", "VLAN40", null] as const;
  const POLICY = { expected: ["VLAN10"], restricted: ["VLAN60"] };

  const domains = {
    authState: AUTH, nacCompliant: COMPLIANT, lastAuthAt: LAST_AUTH, segment: SEGMENT,
  };
  const buildSignal = (c: Record<string, unknown>): NormalizedNetworkSignal => ({
    sourceSystem: "network-nac", observedAt: "2026-07-20T11:59:00Z", deviceId: "dev.enum",
    correlationId: "corr.enum",
    authState: c.authState as NetworkAuthState,
    segment: c.segment as string | null,
    accessLocation: null,
    nacCompliant: c.nacCompliant as boolean | null,
    lastAuthAt: c.lastAuthAt as string | null,
    freshness: "unknown", // recomputed by evaluateNetwork from lastAuthAt + nowMs
  });

  // WITH a segment policy: the ONLY clean state is every axis positively good.
  const withPolicy = enumerateGrantSafety<NormalizedNetworkSignal, ReturnType<typeof evaluateNetwork>>({
    domains,
    build: buildSignal,
    evaluate: (n) => evaluateNetwork(n, NOW, { segmentPolicy: POLICY }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.authState === "authenticated" && c.nacCompliant === true &&
      c.lastAuthAt === FRESH_ISO && c.segment === "VLAN10",
    // The grant must be the EARNED reason — the unverified-posture monitor path
    // must never leak through as action none.
    confirmedWhenNone: (v) => v.reasonCode === "AUTHENTICATED_TRUSTED_SEGMENT",
  });
  check(`ENUMERATION under policy: all ${withPolicy.combos} combinations swept (= product of domains)`,
    withPolicy.combos === productOf(domains) && withPolicy.combos === 4 * 3 * 4 * 4);
  check("ENUMERATION under policy: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    withPolicy.mismatches === 0);
  check("ENUMERATION under policy: exactly ONE granting state (non-vacuous)",
    withPolicy.noneCount === 1);

  // WITHOUT a policy: the segment is ungraded by operator choice, so clean is the
  // session plane alone — but still every session-plane axis positively good.
  const noPolicy = enumerateGrantSafety<NormalizedNetworkSignal, ReturnType<typeof evaluateNetwork>>({
    domains,
    build: buildSignal,
    evaluate: (n) => evaluateNetwork(n, NOW),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.authState === "authenticated" && c.nacCompliant === true && c.lastAuthAt === FRESH_ISO,
    confirmedWhenNone: (v) => v.reasonCode === "AUTHENTICATED_SEGMENT_UNVERIFIED",
  });
  check("ENUMERATION without policy: zero mismatches, and the grant honestly says the segment was not graded",
    noPolicy.mismatches === 0);
  check("ENUMERATION without policy: the granting set is the 4 segment values × one clean session plane",
    noPolicy.noneCount === 4);

  // NEGATIVE CONTROL — the enumeration can fail: declare the unreported-compliance
  // state clean and the harness must object, because the evaluator (correctly)
  // refuses to grant it. A harness that cannot fail proves nothing.
  const wrongPredicate = enumerateGrantSafety<NormalizedNetworkSignal, ReturnType<typeof evaluateNetwork>>({
    domains,
    build: buildSignal,
    evaluate: (n) => evaluateNetwork(n, NOW, { segmentPolicy: POLICY }),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) => c.authState === "authenticated" && c.lastAuthAt === FRESH_ISO && c.segment === "VLAN10",
  });
  check("NEGATIVE CONTROL: declaring unreported compliance clean is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");

  // The unparseable-date sentinel behaves exactly like unreported — pinned so a
  // future NaN path cannot quietly become fresh.
  check("an unparseable lastAuthAt grades identically to an unreported one, on every axis combination",
    ["authenticated", "unauthenticated", "quarantined", "unknown"].every((a) =>
      COMPLIANT.every((nc) => SEGMENT.every((seg) => {
        const va = evaluateNetwork(buildSignal({ authState: a, nacCompliant: nc, lastAuthAt: "not-a-date", segment: seg }), NOW, { segmentPolicy: POLICY });
        const vb = evaluateNetwork(buildSignal({ authState: a, nacCompliant: nc, lastAuthAt: null, segment: seg }), NOW, { segmentPolicy: POLICY });
        return va.reasonCode === vb.reasonCode && va.recommendedAction === vb.recommendedAction;
      }))));
}

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


// COLLECTION SHAPE and PAGE-CAP REFUSAL — both survived mutation until 2026-08-25.
// Shared helper, one statement of a rule nine families implement identically.
await checkCollectionRefusals({
  check,
  family: "network-nac",
  listWith: (t, pageLimit) => () =>
    new NetworkNacConnector({ accessToken: "t", baseUrl: BASE_URL, pageLimit }, t as unknown as NetworkTransport).listSessions(),
  codeOf: (e) => (e instanceof NetworkConnectorError ? e.code : undefined),
});


const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
