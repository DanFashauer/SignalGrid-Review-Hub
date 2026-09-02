// Carrier / post-exit reachability proof — fully OFFLINE and deterministic.
//
// This exercises SignalGrid's answer to the "biggest technical constraint" the
// founder identified: once a shared device leaves managed Wi-Fi, is it still
// reachable, and how? It drives the REAL read-only carrier connector against a
// deterministic mock (normalization, pagination, read-only enforcement, auth
// failure, gating), then runs the PURE reachability evaluator over a full state
// matrix and asserts each device resolves to the right posture, reason code, and
// self-managing playbook action. No network, no SIMs, no wall clock (time is
// injected) — so it runs in the standard CI job.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cellularHardwareFrom, type UemCellularHardware } from "@workspace/integrations/uem";
import {
  CarrierConnectorError,
  CarrierReachabilityConnector,
  createMockCarrierTransport,
  evaluateReachability,
  guardReadOnly,
  normalizeSession,
  resolveCarrierReachabilityConnector,
  type CarrierSessionRaw,
  type CellularBackchannel,
  type ReachabilitySignal,
  type ReachabilityVerdict,
} from "@workspace/integrations/carrier";
import { checkLiveGateIsolated } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

interface ExpectedRow {
  cellularReachability: string;
  smsReachable: boolean;
  cellularBackchannel: string;
  provisioning: string;
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  locatable: boolean;
}
interface FixtureSession extends CarrierSessionRaw {
  expected: ExpectedRow;
}
interface Fixture {
  accessToken: string;
  observedAt: string;
  sessions: FixtureSession[];
}

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/carrier/sessions.json",
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const OBSERVED_AT = fixture.observedAt;
const NOW_MS = Date.parse(OBSERVED_AT);
const BASE_URL = "https://api.carrier.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

console.log("Carrier / post-exit reachability proof");
console.log(`sessions=${fixture.sessions.length} observedAt=${OBSERVED_AT}`);

// Strip the `expected` field before feeding the mock (it only serves raw fields).
const rawSessions: CarrierSessionRaw[] = fixture.sessions.map(({ expected, ...raw }) => raw);

// ── normalization + pagination (page size 2 forces multi-page reads) ───────────
const transport = createMockCarrierTransport({
  sessions: rawSessions,
  expectedToken: fixture.accessToken,
  pageSize: 2,
  baseUrl: BASE_URL,
});
const connector = new CarrierReachabilityConnector(
  { accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 },
  transport,
);

const listed = await connector.listSessions();
check(`pagination reassembles all ${fixture.sessions.length} sessions`, listed.length === fixture.sessions.length);

// THE CEILING OF A CARRIER-ONLY READ, asserted before anything else uses it.
// Whether a device HAS a radio is a device-inventory fact; this connector talks to
// one plane and must not guess at another's. Intake ledger row 55: the previous
// version derived it from three absences (no ICCID, no SMS capability, no data
// session) and asserted "no cellular backchannel at all" — so a device the carrier
// simply could not see was reported as having no radio, with `locatable: false`
// attached. A private-5G attachment produces exactly that wire shape.
const unposed = await connector.fetchReachability(OBSERVED_AT);
check(
  `a carrier-only read can NEVER assert the backchannel axis — all ${unposed.length} signals read \`unknown\``,
  unposed.length > 0 && unposed.every((s) => s.cellularBackchannel === "unknown"),
);
check(
  "...and that includes the device whose every relevant field is silent — silence is not a finding",
  unposed.find((s) => s.deviceId === "dev-private-5g")?.cellularBackchannel === "unknown",
);
// A posed map cannot be poisoned through the prototype chain.
check(
  "a prototype key cannot pose the axis",
  (await connector.fetchReachability(OBSERVED_AT, JSON.parse('{"__proto__":{"dev-private-5g":"absent"}}')))
    .every((s) => s.cellularBackchannel === "unknown"),
);

// Now pose each fixture's own answer and check the normalization end to end.
const posed: Record<string, string> = {};
for (const s of fixture.sessions) posed[s.deviceId] = s.expected.cellularBackchannel;
const signals = await connector.fetchReachability(
  OBSERVED_AT,
  posed as Readonly<Record<string, "present" | "absent" | "unknown">>,
);
const byDevice = new Map<string, ReachabilitySignal>(signals.map((s) => [s.deviceId, s]));

for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId);
  const normOk =
    !!sig &&
    sig.cellularReachability === s.expected.cellularReachability &&
    sig.smsReachable === s.expected.smsReachable &&
    sig.cellularBackchannel === s.expected.cellularBackchannel &&
    sig.provisioning === s.expected.provisioning;
  check(`normalize ${s.deviceId} → ${s.expected.cellularReachability}/${s.expected.provisioning}/${s.expected.cellularBackchannel}`, normOk);
}
check(
  "provenance is deterministic (sourceSystem + observedAt + correlationId)",
  signals.every((s) => s.sourceSystem === "carrier" && s.observedAt === OBSERVED_AT && s.correlationId.startsWith(`${s.deviceId}:`)),
);

// ── pure evaluator: the state matrix → posture + playbook action ───────────────
for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId)!;
  const v: ReachabilityVerdict = evaluateReachability(sig, NOW_MS);
  const ok =
    v.posture === s.expected.posture &&
    v.reasonCode === s.expected.reasonCode &&
    v.recommendedAction === s.expected.recommendedAction &&
    v.locatable === s.expected.locatable;
  check(`evaluate ${s.deviceId} → ${s.expected.posture}/${s.expected.reasonCode}/${s.expected.recommendedAction}`, ok);
}

// Determinism: same signal + same nowMs ⇒ identical verdict.
const detA = evaluateReachability(byDevice.get("dev-online")!, NOW_MS);
const detB = evaluateReachability(byDevice.get("dev-online")!, NOW_MS);
check("evaluator is deterministic (identical verdict for identical input)", JSON.stringify(detA) === JSON.stringify(detB));

// Freshness is time-driven: a once-reachable device far in the future is stale.
const future = evaluateReachability(byDevice.get("dev-online")!, NOW_MS + 3 * 60 * 60 * 1000);
check("a stale sighting degrades a reachable device to STALE_LAST_SEEN", future.reasonCode === "STALE_LAST_SEEN" && future.posture === "degraded");

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1. This family's affirmative is DIFFERENT from the
// posture connectors: it recommends playbook actions, and by design NO input
// ever yields action `none` — even a healthy online device stays `monitor`
// (post-exit reachability is always being watched). The enumeration pins that:
// the granting set is EMPTY across the entire input space, so a future edit
// cannot quietly introduce a silent outcome. The strongest claims it can make —
// posture `reachable` and `locatable: true` — are pinned as exact sets instead.
{
  const NOW_ENUM = Date.parse("2026-07-20T12:00:00Z");
  const FRESH_AT = "2026-07-20T11:50:00Z";
  const STALE_AT = "2026-07-20T09:00:00Z";
  const domains = {
    cellularBackchannel: ["present", "absent", "unknown"],
    provisioning: ["active", "suspended", "deactivated", "unknown"],
    cellularReachability: ["online", "idle", "offline", "unknown"],
    smsReachable: [true, false],
    roaming: [true, false],
    lastSeenAt: [FRESH_AT, STALE_AT, "not-a-date", null],
  } as const;

  const build = (c: Record<string, unknown>): ReachabilitySignal => ({
    sourceSystem: "carrier",
    correlationId: "corr.enum",
    observedAt: "2026-07-20T11:59:00Z",
    deviceId: "dev.enum",
    cellularBackchannel: c.cellularBackchannel,
    cellularReachability: c.cellularReachability,
    smsReachable: c.smsReachable,
    lastSeenAt: c.lastSeenAt,
    roaming: c.roaming,
    provisioning: c.provisioning,
  } as ReachabilitySignal);

  const swept = enumerateGrantSafety<ReachabilitySignal, ReturnType<typeof evaluateReachability>>({
    domains,
    build,
    evaluate: (s) => evaluateReachability(s, NOW_ENUM),
    actionOf: (v) => v.recommendedAction,
    // No state is silent: the granting set is empty by design.
    positivelyClean: () => false,
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 3 * 4 * 4 * 2 * 2 * 4);
  check("ENUMERATION: NO input in the entire space yields action `none` — reachability is always watched",
    swept.mismatches === 0 && swept.noneCount === 0);

  // NEGATIVE CONTROL — the enumeration can fail: declare the healthy online
  // state silent and the harness must object, because the evaluator (correctly)
  // keeps it at monitor.
  const wrongPredicate = enumerateGrantSafety<ReachabilitySignal, ReturnType<typeof evaluateReachability>>({
    domains,
    build,
    evaluate: (s) => evaluateReachability(s, NOW_ENUM),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) =>
      c.cellularBackchannel === "present" && c.provisioning === "active" &&
      c.cellularReachability === "online" && c.roaming === false && c.lastSeenAt === FRESH_AT,
  });
  check("NEGATIVE CONTROL: declaring the healthy online state silent is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");

  // The strongest affirmative this family CAN make, pinned as an exact set:
  // posture `reachable` requires a live online session, backchannel not declared
  // absent, provisioning not suspended/deactivated, no roaming, and a sighting
  // whose timestamp is REPORTED, PARSEABLE, and FRESH. Everything else — every
  // unknown, every contradiction — lands in a degraded/unreachable/unverified
  // posture. (Wedge #15, raised by Codex review on #221: the first version of
  // this set admitted null and unparseable timestamps, matching an evaluator
  // that let its strongest affirmative rest on a timestamp nobody could vouch
  // for. The evaluator now degrades those to LAST_SEEN_UNVERIFIED/monitor —
  // weaker than reported-stale's locate, because unreported is a blind spot,
  // not a reported bad state.)
  let reachableCount = 0;
  let reachableMismatch: string | null = null;
  for (const bc of domains.cellularBackchannel) for (const pv of domains.provisioning)
    for (const cr of domains.cellularReachability) for (const sms of domains.smsReachable)
      for (const ro of domains.roaming) for (const at of domains.lastSeenAt) {
        const v = evaluateReachability(build({ cellularBackchannel: bc, provisioning: pv, cellularReachability: cr, smsReachable: sms, roaming: ro, lastSeenAt: at }), NOW_ENUM);
        const isReachable = v.posture === "reachable";
        const shouldBe = bc !== "absent" && pv !== "suspended" && pv !== "deactivated" &&
          cr === "online" && ro === false && at === FRESH_AT;
        if (isReachable) reachableCount += 1;
        if (isReachable !== shouldBe && reachableMismatch === null) {
          reachableMismatch = JSON.stringify({ bc, pv, cr, sms, ro, at, got: v.posture });
        }
      }
  check(`the 'reachable' posture is exactly the online-verified set (${reachableCount} states, no strays)`,
    reachableMismatch === null && reachableCount === 2 * 2 * 1 * 2 * 1 * 1);

  // Wedge #15 pinned directly: an online, non-roaming device whose sighting
  // timestamp is missing or unparseable is DEGRADED, never confidently
  // reachable — and a provably-stale sighting keeps the stronger locate.
  for (const [label, at] of [["a missing lastSeenAt", null], ["an unparseable lastSeenAt", "not-a-date"]] as const) {
    const w = evaluateReachability(build({ cellularBackchannel: "present", provisioning: "active", cellularReachability: "online", smsReachable: true, roaming: false, lastSeenAt: at }), NOW_ENUM);
    check(`online + ${label} → degraded/LAST_SEEN_UNVERIFIED/monitor, never 'reachable' (wedge #15)`,
      w.posture === "degraded" && w.reasonCode === "LAST_SEEN_UNVERIFIED" && w.recommendedAction === "monitor");
  }
  const futureSeen = evaluateReachability(build({ cellularBackchannel: "present", provisioning: "active", cellularReachability: "online", smsReachable: true, roaming: false, lastSeenAt: "2026-07-20T14:00:00Z" }), NOW_ENUM);
  check("online + a future-dated lastSeenAt (a contradiction) → degraded/LAST_SEEN_UNVERIFIED, never the freshest reading (wedge #15)",
    futureSeen.posture === "degraded" && futureSeen.reasonCode === "LAST_SEEN_UNVERIFIED");
}

// ── read-only enforcement ──────────────────────────────────────────────────────
let readOnly = false;
try {
  guardReadOnly("POST");
} catch (err) {
  readOnly = err instanceof CarrierConnectorError && err.code === "read_only_violation";
}
check("a non-GET request is refused by the read-only guard", readOnly);
let threw = false;
try { guardReadOnly("get"); } catch { threw = true; }
check("a lowercase get is refused — the guard is strict, not case-folded", threw);

// ── auth-failure handling ──────────────────────────────────────────────────────
const badConnector = new CarrierReachabilityConnector({ accessToken: "wrong", baseUrl: BASE_URL }, transport);
const badHealth = await badConnector.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: CarrierConnectorError | null = null;
try {
  await badConnector.listSessions();
} catch (err) {
  authErr = err instanceof CarrierConnectorError ? err : null;
}
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed" && authErr.status === 401);
const goodHealth = await connector.healthCheck();
check("health check reports healthy with a valid token", goodHealth.healthy === true && goodHealth.status === 200);

// ── gating: live vendor calls off unless explicitly enabled ────────────────────
check("dev tier resolves to fixture mode", resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod tier WITHOUT live flag stays fixture mode", resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check(
  "prod tier WITH live flag but no token stays fixture mode",
  resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture",
);
check(
  "prod tier + live flag + token resolves to a live connector",
  resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CARRIER_ACCESS_TOKEN: "a-real-token" }).mode === "live",
);

// Sanity: normalizeSession is a pure function usable without the connector.
check("normalizeSession is pure and standalone", normalizeSession(rawSessions[0], OBSERVED_AT).deviceId === rawSessions[0].deviceId);

// ── The posed axis now has a REAL SUPPLIER ────────────────────────────────────
//
// Before this, `cellularBackchannel` was consumed by the evaluator and posed only in
// FIXTURES — every production deployment read `unknown` forever while this proof's
// own fixtures pretended the axis worked. The doc comment on `normalizeSession` named
// "the device-inventory plane" as the source; nothing was ever connected to it.
//
// `uem`'s `cellularHardware` is that supplier, and the interesting property is what it
// CANNOT say.
{
  const fromUem = (...ids: readonly unknown[]): UemCellularHardware => cellularHardwareFrom(...ids);

  // Assignable to the carrier axis with no mapper and no cast — the type system
  // carrying the law rather than a convention asking politely.
  const posedFromInventory: CellularBackchannel = fromUem("359881234567890");
  const posedFromSilence: CellularBackchannel = fromUem(null, undefined, "");
  check(
    "a uem hardware reading is directly assignable to the posed carrier axis",
    posedFromInventory === "present" && posedFromSilence === "unknown",
  );

  // THE LAW THAT MATTERS: the supplier can never produce `absent`. Row 55 removed
  // absent-by-inference from `carrier` because a carrier API cannot prove a radio's
  // absence. A UEM cannot either — a missing IMEI is a missing identifier, not a
  // missing modem — so sweeping every identifier shape must never yield a third value.
  const SHAPES: readonly (readonly unknown[])[] = [
    [], [null], [undefined], [""], ["  "], [false], [0], [{}], [[]], [null, undefined, ""],
    ["359881234567890"], ["", "89014103211118510720"], [null, null, "A1000009B7C1D2"],
  ];
  const produced = new Set<string>(SHAPES.map((sh) => fromUem(...sh)));
  check(
    `across ${SHAPES.length} identifier shapes the supplier produces {${[...produced].sort().join(", ")}} and never absent`,
    !produced.has("absent") && produced.size === 2,
  );

  // End-to-end consequence: a device the inventory plane is silent about must NOT take
  // the short-circuit row 55 removed. Silence keeps it eligible for a real reachability
  // read rather than being declared unlocatable.
  const sess = (deviceId: string): CarrierSessionRaw =>
    ({ deviceId, sessionState: "active", dataConnected: true }) as CarrierSessionRaw;
  const silent = normalizeSession(sess("dev-silent"), "2026-01-01T00:00:00.000Z", fromUem(null));
  const known = normalizeSession(sess("dev-known"), "2026-01-01T00:00:00.000Z", fromUem("359881234567890"));
  check(
    "an inventory-silent device poses `unknown`, not `absent` — no short-circuit",
    silent.cellularBackchannel === "unknown",
  );
  check(
    "an inventory-confirmed modem poses `present`, so the supplier is not inert",
    known.cellularBackchannel === "present",
  );
  check(
    "NON-VACUITY: the supplier actually distinguishes the two cases",
    silent.cellularBackchannel !== known.cellularBackchannel,
  );
}

// Computed HERE, not earlier. It was previously snapshotted mid-file, so any check
// added below that point printed a denominator smaller than the numerator — the
// proof under-reporting its own coverage, which is the stale-figure defect this
// repository guards against everywhere else.

// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "carrier",
  resolve: (env) => resolveCarrierReachabilityConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    CARRIER_ACCESS_TOKEN: "t",
  },
});

// The BOUND (independent sweep + ECC, 2026-09-01): a garbled staleAfterMs must grade an
// ancient sighting STALE_LAST_SEEN/locate — the same verdict the default bound gives — never
// the weaker LAST_SEEN_UNVERIFIED/monitor (a posed 0 must not outscore no bound at all).
{
  const ancient = { ...byDevice.get("dev-online")!, lastSeenAt: new Date(NOW_MS - 7 * 365 * 24 * 3600 * 1000).toISOString() };
  const onDefault = evaluateReachability(ancient, NOW_MS);
  check("bound control: a 7-year-old sighting is STALE_LAST_SEEN/locate on the default bound", onDefault.reasonCode === "STALE_LAST_SEEN" && onDefault.recommendedAction === "locate");
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, 0]) {
    const v = evaluateReachability(ancient, NOW_MS, { staleAfterMs: bad });
    check(`a garbled staleAfterMs (${String(bad)}) grades the same sighting STALE_LAST_SEEN/locate — never the weaker unverified/monitor`, v.reasonCode === "STALE_LAST_SEEN" && v.recommendedAction === "locate");
  }
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
