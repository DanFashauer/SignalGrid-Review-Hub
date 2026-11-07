// Proof: the evidence verdict does not depend on the evaluating host's timezone.
//
// BUILD_BACKLOG row "groupLatest's Date.parse ordering is host-timezone-dependent
// for an offset-less observedAt". `Date.parse("2026-07-13T08:00:00")` is LOCAL
// time per ECMA-262, so the same two wire readings ordered differently on a host
// in Asia/Tokyo than on one in UTC — a different security decision from nothing
// but the evaluator's clock zone. An offset-less stamp is an unknown instant; it
// is treated as illegible (never wins as latest, cannot vouch, worst-wins), the
// same rule that already governs an unparseable stamp.
//
// The fixture runs as a SEPARATE CHILD PROCESS per TZ value, so this process's
// own TZ cannot mask the defect. Asia/Tokyo (+09:00) is the zone that reorders
// the two readings; UTC and America/New_York alone already agree today.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildEvidence,
  classifyFreshness,
  EVIDENCE_VALUE_DOMAINS,
  evaluatePolicy,
  fixedClock,
  normalizeAttachRecord,
  runDockSync,
  seedDemoStore,
  SHARED_DEVICE_RULES_V1,
  type Device,
  type Identity,
  type NormalizedSignal,
  type SignalCategory,
  type Workflow,
  verifyRemediation,
  puckVerdict,
  type PuckSituation,
} from "@workspace/signalgrid-core";

import { ageMs, deriveFreshness } from "@workspace/integrations/utils/freshness";
import { fromDevicePosture } from "@workspace/posture-composition";
import { evaluateNetwork } from "@workspace/integrations/network-nac";
import { evaluateReachability } from "@workspace/integrations/carrier";
import { evaluateLocation } from "@workspace/integrations/location-services";

const SELF = fileURLToPath(import.meta.url);

const identity: Identity = {
  id: "id_tz", tenantId: "tenant_northwind", externalRef: "nurse.tz",
  displayName: "Nurse", state: "enabled", assignedRole: "nurse",
};
const device: Device = {
  id: "dev_tz", tenantId: "tenant_northwind", externalRef: "ipad-tz", name: "Ward iPad",
  osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune",
};
const workflow: Workflow = {
  id: "wf_tz", tenantId: "tenant_northwind", key: "clinical-session",
  name: "Clinical session", riskTier: "elevated",
};
const BASE = "2026-07-13T13:00:00.000Z";
const sig = (id: string, category: SignalCategory, value: NormalizedSignal["value"], observedAt: string): NormalizedSignal => ({
  id, tenantId: "tenant_northwind", connectorId: "conn", subjectType: "device", subjectId: device.id,
  category, value, observedAt, freshness: "fresh", sourceReference: "fixture:tz",
});
const healthy = (): NormalizedSignal[] => [
  sig("s_m", "device_management", true, BASE),
  sig("s_e", "device_encryption", true, BASE),
  sig("s_o", "os_support", true, BASE),
  sig("s_p", "posture_freshness", "fresh", BASE),
];

/** Two device_compliance readings: an accusation at 07:30Z and a vouch at `vouchObservedAt`. */
function verdictFor(vouchObservedAt: string, accusedAt = "2026-07-13T07:30:00Z"): string {
  const signals = [
    sig("s_nc", "device_compliance", "non_compliant", accusedAt),
    sig("s_c", "device_compliance", "compliant", vouchObservedAt),
    ...healthy(),
  ];
  const ev = buildEvidence(identity, device, workflow, signals);
  const pv = {
    id: "pv_tz", tenantId: "tenant_northwind", policyId: "pol_tz", version: 1,
    status: "active" as const, rules: SHARED_DEVICE_RULES_V1,
    createdAt: BASE, digest: "test",
  };
  return `${evaluatePolicy(pv, ev).outcome}|${ev.deviceCompliance}`;
}

/** An OLDER parseable accusation against a NEWER accusation whose stamp is `newerObservedAt`. */
function accusationFor(category: "tamper_state" | "badge_binding", older: string, newer: string, newerObservedAt: string): string {
  const signals = [
    sig("s_old", category, older, "2026-07-13T04:00:00.000Z"),
    sig("s_new", category, newer, newerObservedAt),
    sig("s_c", "device_compliance", "compliant", BASE),
    ...healthy(),
  ];
  const ev = buildEvidence(identity, device, workflow, signals);
  return category === "tamper_state" ? ev.tamperState : ev.badgeBinding;
}

/** Every family with more than one accusing value: [category, evidence field, older (milder), newer (stronger)]. */
const FAMILIES: ReadonlyArray<readonly [SignalCategory, string, string, string]> = [
  ["tamper_state", "tamperState", "suspected", "confirmed"],
  ["badge_binding", "badgeBinding", "removed", "forced"],
  ["battery_health", "batteryHealth", "degraded", "failing"],
  ["device_management_health", "managementHealthState", "degraded", "broken"],
  ["charge_state", "dockChargeState", "low", "critical"],
  ["security_baseline", "baselineCompliance", "partial", "drifted"],
  ["dock_state", "dockState", "offline", "faulted"],
  ["posture_freshness", "postureFreshness", "stale", "unknown"],
];

/** For each family, an OLDER parseable milder value against a NEWER stronger one stamped `newerObservedAt`. */
function matrixFor(newerObservedAt: string): string {
  return FAMILIES.map(([category, field, older, newer]) => {
    const signals = [
      sig("s_old", category, older, "2026-07-13T04:00:00.000Z"),
      sig("s_new", category, newer, newerObservedAt),
      sig("s_c", "device_compliance", "compliant", BASE),
      ...healthy().filter((x) => x.category !== category),
    ];
    const ev = buildEvidence(identity, device, workflow, signals) as unknown as Record<string, unknown>;
    return `${category}=${String(ev[field])}`;
  }).join(";");
}

/** Two accusations at the SAME instant, in the given arrival order. */
function tieFor(category: SignalCategory, field: string, first: string, second: string): string {
  const signals = [
    sig("s_a", category, first, "2026-07-13T12:00:00.000Z"),
    sig("s_b", category, second, "2026-07-13T12:00:00.000Z"),
    sig("s_c", "device_compliance", "compliant", BASE),
    ...healthy(),
  ];
  const ev = buildEvidence(identity, device, workflow, signals) as unknown as Record<string, unknown>;
  return String(ev[field]);
}

/** The freshness classifier on one stamp, at a fixed reference clock. */
function freshnessFor(observedAt: string): string {
  return classifyFreshness(observedAt, "2026-07-13T13:00:00.000Z", 1, 24);
}

/** runDockSync end to end: a second dock feed carries `observedAt`; report the dock-wide freshness. */
function dockFreshnessFor(observedAt: string): string {
  const seeded = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z"));
  const store = seeded.store;
  const connector = store.listConnectors(seeded.tenants.northwind).find((c) => c.kind === "dockbridge-custody");
  const base = connector ? seeded.dockRecords[connector.id]?.[0] : undefined;
  if (!connector || !base) return "SETUP-MISSING";
  const dev = store.findDeviceByRef(connector.tenantId, base.deviceRef);
  const ident = store.findIdentityByRef(connector.tenantId, "nurse.compliant");
  const wf = store.findWorkflowByKey(connector.tenantId, "clinical-session");
  if (!dev || !ident || !wf) return "SETUP-MISSING";
  runDockSync(store, fixedClock("2026-07-13T15:00:00.000Z"), { ...connector, id: "conn_dock_tz" }, [
    { ...base, observedAt },
  ]);
  const signals = store.listSignalsForSubject(connector.tenantId, "device", dev.id);
  return buildEvidence(ident, dev, wf, signals).dockEvidenceFreshness;
}

/** Two posture_freshness readings at the SAME instant (no healthy posture sibling), in the given arrival order. */
function postureTieFor(first: string, second: string): string {
  const signals = [
    sig("s_a", "posture_freshness", first, "2026-07-13T12:00:00.000Z"),
    sig("s_b", "posture_freshness", second, "2026-07-13T12:00:00.000Z"),
    sig("s_c", "device_compliance", "compliant", BASE),
    ...healthy().filter((x) => x.category !== "posture_freshness"),
  ];
  return String(buildEvidence(identity, device, workflow, signals).postureFreshness);
}

/** The freshness classifier with an offset-less EVALUATION clock: the clock names no instant either. */
function freshnessAtOffsetlessNow(observedAt: string): string {
  return classifyFreshness(observedAt, "2026-07-13T13:00:00", 1, 24);
}

/** The attach normalizer on one stamp: 3600 s bound, reference 13:00Z. */
function attachFor(observedAt: string): string {
  return normalizeAttachRecord(
    { credentialRef: "puck-tz", deviceRef: "ipad-tz", receiverRef: "rx-tz", wireState: "attached", observedAt },
    "2026-07-13T13:00:00Z",
    3600,
  ).state;
}

/** Remediation verification with one evidence read stamped `observedAt`; request 11:30Z, as-of 13:00Z. */
function verifyFor(observedAt: string): string {
  return verifyRemediation(
    {
      id: "rem_tz", tenantId: "tenant_northwind", decisionId: "dec_tz", kind: "request_device_remediation",
      targetType: "device", targetRef: "ipad-tz", reasonCode: "DEVICE_NONCOMPLIANT", status: "approved_simulated",
      approvalRequired: true, simulatedOnly: true, requestedAt: "2026-07-13T11:30:00Z", approvedAt: "2026-07-13T11:31:00Z", note: "",
    },
    [{ targetRef: "ipad-tz", reasonCodes: [], observedAt }],
    "2026-07-13T13:00:00Z",
  ).state;
}

/**
 * Remediation verification with TWO reads (request 08:00Z, as-of 09:00Z): `accusingAt` still carries the code,
 * a zoned read at 08:20Z has it cleared. A UTC host reading an offset-less 08:10:00 under Date.parse said
 * not_cleared; an accusing read that cannot be placed must never let the later clearing read decide instead.
 */
function verifyTwoReadsFor(accusingAt: string): string {
  return verifyRemediation(
    {
      id: "rem_tz2", tenantId: "tenant_northwind", decisionId: "dec_tz2", kind: "request_device_remediation",
      targetType: "device", targetRef: "ipad-tz", reasonCode: "DEVICE_NONCOMPLIANT", status: "approved_simulated",
      approvalRequired: true, simulatedOnly: true, requestedAt: "2026-07-13T08:00:00Z", approvedAt: "2026-07-13T08:01:00Z", note: "",
    },
    [
      { targetRef: "ipad-tz", reasonCodes: ["DEVICE_NONCOMPLIANT"], observedAt: accusingAt },
      { targetRef: "ipad-tz", reasonCodes: [], observedAt: "2026-07-13T08:20:00Z" },
    ],
    "2026-07-13T09:00:00Z",
  ).state;
}

/** Puck 4's matrix row for one attach record on an otherwise fully trusted session; 120 s bound. */
function puckFor(wireState: string, forced: string, observedAt: string, reference: string): string {
  const reading = normalizeAttachRecord(
    { credentialRef: "puck-tz", deviceRef: "ipad-tz", receiverRef: "rx-tz", wireState, forced: forced === "forced", observedAt },
    reference,
    120,
  );
  const situation: PuckSituation = {
    attach: reading.state, forced: reading.forced, release: "not_applicable", returned: "not_applicable",
    identityConfirmed: true, postureCompliant: true, credentialStanding: "valid", readStrength: "strong",
    enrolledStrength: "strong", higherRiskAction: false, presenceRadioLost: false, inactive: false, redockPendingReevaluation: false,
  };
  const row = puckVerdict(situation);
  return `${reading.state}|${row.verdict}|${row.reasonCode}`;
}

/**
 * Owner decision (b): remediation with one CLEARING read stamped `observedAt`; request 2026-07-12T23:30Z, as-of
 * 2026-07-13T01:00Z. A date-only "2026-07-13" read as exact midnight fell inside that window and cleared.
 */
function verifyDateFor(observedAt: string): string {
  return verifyRemediation(
    {
      id: "rem_tz3", tenantId: "tenant_northwind", decisionId: "dec_tz3", kind: "request_device_remediation",
      targetType: "device", targetRef: "ipad-tz", reasonCode: "DEVICE_NONCOMPLIANT", status: "approved_simulated",
      approvalRequired: true, simulatedOnly: true, requestedAt: "2026-07-12T23:30:00Z", approvedAt: "2026-07-12T23:31:00Z", note: "",
    },
    [{ targetRef: "ipad-tz", reasonCodes: [], observedAt }],
    "2026-07-13T01:00:00Z",
  ).state;
}

/** fixedClock on one stamp: the instant it pins, or THROWS. */
function clockFor(iso: string): string {
  try { return fixedClock(iso).now().toISOString(); } catch { return "THROWS"; }
}

/** The shared connector freshness helper on one sighting, reference 13:00Z, 7-day bound. */
function sharedFreshnessFor(seenAt: string): string {
  const now = parseInt("1783947600000", 10); // 2026-07-13T13:00:00Z, as epoch ms so no parse is involved
  const age = ageMs(seenAt, now);
  return `${deriveFreshness(seenAt, now, 7 * 24 * 3600 * 1000)}|${age === null ? "null" : "age"}`;
}

/** Graph device posture composed with a healthy record whose last sighting is `lastSeenAt`; read at `observedAt`. */
function devicePostureFor(lastSeenAt: string, observedAt: string): string {
  const out = fromDevicePosture({
    sourceSystem: "microsoft-graph", correlationId: "c_tz", observedAt, subjectId: "u_tz",
    identityStatus: "enabled", userRisk: "none", deviceId: "d_tz", deviceComplianceState: "compliant",
    deviceManagementState: "managed", deviceRegistrationState: "registered", deviceLastSeenAt: lastSeenAt,
  });
  return `${out.action}|${out.reason}`;
}

/**
 * One connector family's verdict for an otherwise-trusted signal whose sighting is `stamp` ("-" = absent), judged at
 * 13:00Z with a 30-minute bound. NAC: authenticated + compliant, no segment policy. Carrier: provisioned, online,
 * not roaming, backchannel present. Location: inside the geofence.
 */
function familyFor(family: string, stamp: string): string {
  const now = parseInt("1783947600000", 10); // 2026-07-13T13:00:00Z, as epoch ms so no parse is involved
  const seen = stamp === "-" ? null : stamp;
  const bound = { staleAfterMs: 30 * 60 * 1000 };
  if (family === "nac") {
    const r = evaluateNetwork({
      sourceSystem: "network-nac", correlationId: "c_tz", observedAt: "2026-07-13T13:00:00Z", deviceId: "d_tz",
      authState: "authenticated", segment: "corp", accessLocation: null, nacCompliant: true, lastAuthAt: seen, freshness: "unknown",
    }, now, bound);
    return `${r.recommendedAction}|${r.reasonCode}`;
  }
  if (family === "carrier") {
    const r = evaluateReachability({
      sourceSystem: "carrier", correlationId: "c_tz", observedAt: "2026-07-13T13:00:00Z", deviceId: "d_tz",
      cellularReachability: "online", smsReachable: true, lastSeenAt: seen, freshness: "unknown", roaming: false,
      provisioning: "active", cellularBackchannel: "present",
    } as Parameters<typeof evaluateReachability>[0], now, bound);
    return `${r.recommendedAction}|${r.reasonCode}`;
  }
  if (family === "location") {
    const r = evaluateLocation({
      sourceSystem: "location-services", correlationId: "c_tz", observedAt: "2026-07-13T13:00:00Z", deviceId: "d_tz",
      geofenceState: "inside", geofenceId: "g_tz", source: "gps", accuracyMeters: 10, capturedAt: seen,
      freshness: "unknown", hasPreciseCoordinates: false,
    } as Parameters<typeof evaluateLocation>[0], now, bound);
    return `${r.recommendedAction}|${r.reasonCode}`;
  }
  return "BAD-FAMILY";
}

/**
 * OWNER DECISION (a), 2026-11-06: KEEP BOTH. Two different accusations about one subject at the same instant (or
 * one whose stamp cannot be read) both reach the policy. A TENANT policy that ranks the members differently from
 * the shipped rules (it denies the MILDER one and has no rule for the stronger) must still see the milder one.
 * `shape`: "tie" = both at 12:00Z; "illegible" = the milder one has an offset-less stamp, the stronger is at 12:00Z.
 * Returns `<outcome>|<reasonCodes>` under the tenant policy, then `<outcome>` under the shipped rules.
 */
function tenantFor(category: SignalCategory, milder: string, stronger: string, shape: string, order: string): string {
  const field = category === "tamper_state" ? "tamperState" : category === "custody_state" ? "custodyState" : "badgeState";
  const milderAt = shape === "illegible" ? "2026-07-13T12:00:00" : "2026-07-13T12:00:00.000Z";
  const a = sig("s_milder", category, milder, milderAt);
  const b = sig("s_stronger", category, stronger, "2026-07-13T12:00:00.000Z");
  const signals = [...(order === "milder-first" ? [a, b] : [b, a]), sig("s_c", "device_compliance", "compliant", BASE), ...healthy()];
  const ev = buildEvidence(identity, device, workflow, signals);
  const tenant = {
    id: "pv_tenant", tenantId: "tenant_northwind", policyId: "pol_tenant", version: 7, status: "active" as const,
    createdAt: BASE, digest: "test",
    rules: [
      { id: "tenant-milder-deny", description: "this tenant denies the milder member", match: [{ field, in: [milder] }], outcome: "deny" as const, reasonCode: "TENANT_MILDER_DENY", severity: "high" as const },
      { id: "tenant-managed-allow", description: "managed and compliant", match: [{ field: "deviceManaged", equals: true }, { field: "deviceCompliance", in: ["compliant"] }], outcome: "allow" as const, reasonCode: "TENANT_MANAGED_ALLOW", severity: "low" as const },
    ],
  } as unknown as Parameters<typeof evaluatePolicy>[0];
  const shipped = { ...tenant, id: "pv_shipped", rules: SHARED_DEVICE_RULES_V1 } as Parameters<typeof evaluatePolicy>[0];
  const t = evaluatePolicy(tenant, ev);
  return `${t.outcome}|${t.reasonCodes.join("+")}|shipped=${evaluatePolicy(shipped, ev).outcome}`;
}

if (process.argv[2] === "--worker") {
  const [mode, a, b, c] = process.argv.slice(3);
  const out =
    mode === "tenant" ? tenantFor(a as SignalCategory, b!, c!, process.argv[7]!, process.argv[8]!)
    : mode === "verdict" ? verdictFor(a!, b)
    : mode === "accuse" ? accusationFor(a as "tamper_state" | "badge_binding", b!, c!, process.argv[7]!)
    : mode === "matrix" ? matrixFor(a!)
    : mode === "tie" ? tieFor(a as SignalCategory, b!, c!, process.argv[7]!)
    : mode === "freshness" ? freshnessFor(a!)
    : mode === "dock" ? dockFreshnessFor(a!)
    : mode === "ptie" ? postureTieFor(a!, b!)
    : mode === "freshnow" ? freshnessAtOffsetlessNow(a!)
    : mode === "attach" ? attachFor(a!)
    : mode === "verify" ? verifyFor(a!)
    : mode === "clock" ? clockFor(a!)
    : mode === "verify2" ? verifyTwoReadsFor(a!)
    : mode === "puck" ? puckFor(a!, b!, c!, "2026-07-13T08:00:30Z")
    : mode === "puckref" ? puckFor(a!, b!, "2026-07-13T08:00:00Z", c!)
    : mode === "sharedfresh" ? sharedFreshnessFor(a!)
    : mode === "devposture" ? devicePostureFor(a!, b!)
    : mode === "family" ? familyFor(a!, b!)
    : mode === "puckdate" ? puckFor(a!, b!, "2026-07-13", "2026-07-13T00:00:30Z")
    : mode === "verifydate" ? verifyDateFor(a!)
    : "BAD-MODE";
  console.log(`VERDICT ${out}`);
  process.exit(0);
}

function inZone(tz: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, ["--import", "tsx", SELF, "--worker", ...args], {
    env: { ...process.env, TZ: tz }, encoding: "utf8",
  });
  const m = /^VERDICT (.+)$/m.exec(r.stdout ?? "");
  return m ? m[1]! : `CRASH(status=${r.status}) ${(r.stderr ?? "").slice(0, 200)}`;
}

const failures: string[] = [];
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const ZONES = ["UTC", "America/New_York", "Asia/Tokyo"];
const OFFSETLESS = "2026-07-13T08:00:00";

const offsetless = ZONES.map((z) => [z, inZone(z, "verdict", OFFSETLESS)] as const);
console.log(offsetless.map(([z, v]) => `${z}=${v}`).join("  "));
check(
  "offset-less observedAt: identical verdict under UTC, America/New_York and Asia/Tokyo",
  new Set(offsetless.map(([, v]) => v)).size === 1,
  offsetless.map(([z, v]) => `${z}=${v}`).join(" "),
);
check(
  "offset-less observedAt: the non_compliant accusation is not vouched down (never allow)",
  offsetless.every(([, v]) => !v.startsWith("allow") && !v.includes("CRASH")),
  offsetless.map(([, v]) => v).join(","),
);

// Control: an explicit-offset stamp keeps ordering by instant, in every zone.
const explicit = ZONES.map((z) => inZone(z, "verdict", "2026-07-13T08:00:00Z"));
check(
  "explicit-Z observedAt: later compliant reading still wins by instant, identically in every zone",
  new Set(explicit).size === 1 && explicit[0]!.endsWith("|compliant"),
  explicit.join(","),
);
// +02:00 control that BITES: 09:00+02:00 is 07:00Z, OLDER than the 07:30Z accusation, so the accusation
// must stand. A parser that ignores the offset reads it as 09:00Z, a later vouch, and flips to allow.
const explicitOff = ZONES.map((z) => inZone(z, "verdict", "2026-07-13T09:00:00+02:00"));
check(
  "explicit +02:00 observedAt: the offset is applied (09:00+02:00 = 07:00Z is OLDER than the accusation), identically in every zone",
  new Set(explicitOff).size === 1 && explicitOff[0]!.endsWith("|non_compliant"),
  explicitOff.join(","),
);

// OWNER DECISION (b), 2026-11-06: a date-only stamp is UNREADABLE. "2026-07-13" names a day, not an instant, so
// it can neither vouch nor be ordered. It used to read as exact UTC midnight: a date-only "compliant" outranked a
// 23:00Z accusation the day before and allowed, and (the refute on #1792) a date-only "non_compliant" lost to a
// 07:30Z vouch the same day and allowed too.
const dateOnly = ZONES.map((z) => inZone(z, "verdict", "2026-07-13", "2026-07-12T23:00:00Z"));
check(
  "date-only vouch is illegible: it cannot outrank a 23:00Z accusation the day before (never allow), identically in every zone",
  new Set(dateOnly).size === 1 && dateOnly[0]!.endsWith("|non_compliant") && !dateOnly[0]!.startsWith("allow"),
  dateOnly.join(","),
);
const dateOnlyAccuse = ZONES.map((z) => inZone(z, "verdict", "2026-07-13T07:30:00Z", "2026-07-13"));
check(
  "date-only accusation is illegible but still accuses: a 07:30Z vouch the same day cannot erase it (never allow), identically in every zone",
  new Set(dateOnlyAccuse).size === 1 && dateOnlyAccuse[0]!.endsWith("|non_compliant") && !dateOnlyAccuse[0]!.startsWith("allow"),
  dateOnlyAccuse.join(","),
);
const dateOnlyFresh = ZONES.map((z) => inZone(z, "freshness", "2026-07-13"));
check("classifyFreshness: a date-only stamp is 'unknown' (cannot vouch for freshness), in every zone", dateOnlyFresh.every((v) => v === "unknown"), dateOnlyFresh.join(","));

// An offset-less NEWER accusation must still beat an OLDER one of lower severity, in every zone. Two accusing
// values tie at the coarse severity level, so without a per-family order the older parseable one would stand.
const tamper = ZONES.map((z) => inZone(z, "accuse", "tamper_state", "suspected", "confirmed", "2026-07-13T14:50:00"));
check(
  "offset-less confirmed tamper is not outranked by an older suspected one (deny stays deny), identically in every zone",
  new Set(tamper).size === 1 && tamper[0] === "confirmed",
  tamper.join(","),
);
const badge = ZONES.map((z) => inZone(z, "accuse", "badge_binding", "removed", "forced", "2026-07-13T14:50:00"));
check(
  "offset-less forced badge is not outranked by an older removed one, identically in every zone",
  new Set(badge).size === 1 && badge[0] === "forced",
  badge.join(","),
);
const tamperRfc = ZONES.map((z) => inZone(z, "accuse", "tamper_state", "suspected", "confirmed", "Mon, 13 Jul 2026 14:50:00 GMT"));
check(
  "non-ISO zoned (RFC 2822) confirmed tamper is not outranked by an older suspected one, identically in every zone",
  new Set(tamperRfc).size === 1 && tamperRfc[0] === "confirmed",
  tamperRfc.join(","),
);

// The freshness classifier must not read an offset-less stamp in host-local time.
const fresh = ZONES.map((z) => inZone(z, "freshness", "2026-07-13T08:00:00"));
check(
  "classifyFreshness: an offset-less stamp is 'unknown' in every zone (never host-local fresh or stale)",
  fresh.every((v) => v === "unknown"),
  fresh.join(","),
);
const freshZ = ZONES.map((z) => inZone(z, "freshness", "2026-07-13T12:30:00Z"));
check(
  "classifyFreshness: an explicit-Z stamp is classified by instant, identically in every zone",
  new Set(freshZ).size === 1 && freshZ[0] === "fresh",
  freshZ.join(","),
);

// runDockSync end to end: the dock-wide freshness for a second feed with an offset-less stamp must not depend on the host zone.
const dock = ZONES.map((z) => inZone(z, "dock", "2026-07-13T08:00:00"));
check(
  "runDockSync: dock-wide freshness with an offset-less feed is identical in every zone and never 'fresh'",
  new Set(dock).size === 1 && dock[0] !== "fresh" && !dock[0]!.includes("MISSING") && !dock[0]!.includes("CRASH"),
  dock.join(","),
);


// Zoned forms that name an exact instant are ORDERED, not discarded. A vouch at 08:00Z is later than the 07:30Z
// accusation, so each of these must read `compliant`; one that fell to illegible could not vouch and would not.
for (const stamp of [
  "2026-07-13 08:00:00Z",
  "2026-07-13 08:00:00+00",
  "2026-07-13T08:00:00+0000",
  "2026-07-13T10:00:00+02",
  "2026-07-13 10:00:00+02:00",
]) {
  const r = ZONES.map((z) => inZone(z, "verdict", stamp));
  check(
    `zoned stamp '${stamp}' is ordered by instant (later vouch wins), identically in every zone`,
    new Set(r).size === 1 && r[0]!.endsWith("|compliant"),
    r.join(","),
  );
}

// Every family with two accusing values: a NEWER, STRONGER accusation whose stamp cannot be ordered must not be
// outranked by an OLDER, milder ordered one. Expected per family: the stronger value, in every zone and for every
// stamp shape (offset-less, RFC 2822 text, and a plain explicit Z as the control).
const strongerOf = FAMILIES.map(([category, , , newer]) => `${category}=${newer}`).join(";");
for (const stamp of ["2026-07-13T14:50:00", "Mon, 13 Jul 2026 14:50:00 GMT", "2026-07-13T14:50:00Z"]) {
  const r = ZONES.map((z) => inZone(z, "matrix", stamp));
  check(
    `all families, newer stronger accusation stamped '${stamp}': the stronger value stands, identically in every zone`,
    new Set(r).size === 1 && r[0] === strongerOf,
    r.join(" | "),
  );
}

// Same-instant pairs resolve by severity, not by arrival order, in both orders.
for (const [category, field, mild, strong] of FAMILIES.filter(([c]) => c !== "posture_freshness")) {
  const ab = inZone("UTC", "tie", category, field, mild, strong);
  const ba = inZone("UTC", "tie", category, field, strong, mild);
  check(`same-instant ${category}: ${mild}+${strong} resolves to ${strong} in either arrival order`, ab === strong && ba === strong, `${ab}/${ba}`);
}

// Impossible calendar or clock values are NOT instants. `Date.parse` rolls "2026-02-30" over to March 2, so a
// vouch carrying one would outrank a valid March 1 accusation and read `compliant`. Every one of these must be
// illegible (cannot vouch) in every zone, including the `Z` form that mainline already rolled over.
for (const stamp of [
  "2026-02-30T08:00:00+00",
  "2026-02-30T08:00:00Z",
  "2026-02-30",
  "2026-02-29T08:00:00Z",
  "2026-13-01T08:00:00Z",
  "2026-03-02T24:00:00Z",
  "2026-03-02T08:60:00Z",
  "2026-03-02T08:00:60Z",
  "2026-03-02T08:00:00+24:00",
  "2026-03-02T08:00:00+00:60",
]) {
  const r = ZONES.map((z) => inZone(z, "verdict", stamp, "2026-03-01T00:00:00Z"));
  check(
    `impossible stamp '${stamp}' is illegible (cannot vouch past a valid March 1 accusation), identically in every zone`,
    new Set(r).size === 1 && r[0]!.endsWith("|non_compliant"),
    r.join(","),
  );
}
// Control: the valid neighbours of those stamps still order by instant (2026-03-02 is a real, later date). The
// date-only "2026-03-02" left this list on 2026-11-06: owner decision (b) makes a date-only stamp illegible.
for (const stamp of ["2026-03-02T08:00:00+00", "2026-03-02T00:00:00Z", "2024-02-29T08:00:00Z"]) {
  const accused = stamp.startsWith("2024") ? "2024-02-28T00:00:00Z" : "2026-03-01T00:00:00Z";
  const r = ZONES.map((z) => inZone(z, "verdict", stamp, accused));
  check(
    `valid stamp '${stamp}' is ordered by instant (later vouch wins), identically in every zone`,
    new Set(r).size === 1 && r[0]!.endsWith("|compliant"),
    r.join(","),
  );
}

// Accusing values the shipped rules treat ALIKE sit in one tier and TIE: the first arrival stands (as on mainline),
// because a tenant's own active policy may tell them apart and collapsing them to the later-listed one loses that.
{
  const ab = inZone("UTC", "tie", "custody_state", "custodyState", "overdue", "maintenance");
  const ba = inZone("UTC", "tie", "custody_state", "custodyState", "maintenance", "overdue");
  check("same-instant custody overdue+maintenance (same shipped outcome): the FIRST arrival stands, in either order", ab === "overdue" && ba === "maintenance", `${ab}/${ba}`);
  const cd = inZone("UTC", "tie", "charge_state", "dockChargeState", "low", "not_present");
  const dc = inZone("UTC", "tie", "charge_state", "dockChargeState", "not_present", "low");
  check("same-instant charge low+not_present (same shipped outcome): the FIRST arrival stands, in either order", cd === "low" && dc === "not_present", `${cd}/${dc}`);
}

// The accusation orders are not hand-trusted: derive each member's outcome from the SHIPPED rule set, require
// every accusing member to be listed, and require the order to be non-decreasing in outcome.
{
  const RANK: Record<string, number> = { allow: 0, step_up: 1, restrict: 2, deny: 3 };
  const FIELD_OF: Record<string, string> = {
    tamper: "tamperState", badge: "badgeBinding", battery: "batteryHealth", managementHealth: "managementHealthState",
    charge: "dockChargeState", baseline: "baselineCompliance", dock: "dockState", custody: "custodyState",
  };
  const base = buildEvidence(identity, device, workflow, [sig("s_c", "device_compliance", "compliant", BASE), ...healthy()]);
  const pv = { id: "pv_o", tenantId: "tenant_northwind", policyId: "pol_o", version: 1, status: "active" as const, rules: SHARED_DEVICE_RULES_V1, createdAt: BASE, digest: "test" };
  const outcomeOf = (field: string, member: string) =>
    RANK[evaluatePolicy(pv, { ...base, [field]: member } as typeof base).outcome]!;
  const problems: string[] = [];
  for (const [key, field] of Object.entries(FIELD_OF)) {
    const domain = (EVIDENCE_VALUE_DOMAINS as Record<string, { members: readonly unknown[]; good: readonly unknown[]; worse?: readonly unknown[] }>)[key === "battery" ? "batteryHealth" : key];
    if (!domain) { problems.push(`${key}: no such domain`); continue; }
    const accusing = domain.members.filter((m) => !domain.good.includes(m)) as string[];
    const tiers = (domain.worse ?? []) as unknown as string[][];
    const listed = tiers.flat();
    for (const m of accusing) if (!listed.includes(m)) problems.push(`${key}: accusing member '${m}' is not ranked`);
    let prevTier = -1;
    tiers.forEach((tier, i) => {
      const ranks = tier.map((m) => outcomeOf(field, m));
      if (new Set(ranks).size > 1) problems.push(`${key}: tier ${i} [${tier.join(",")}] mixes outcomes ${ranks.join(",")}`);
      if (ranks[0]! <= prevTier) problems.push(`${key}: tier ${i} [${tier.join(",")}] (${ranks[0]}) does not outrank the tier before it (${prevTier})`);
      prevTier = Math.max(prevTier, ...ranks);
    });
  }
  check("accusation orders match the shipped rules' outcomes, and every accusing member is ranked", problems.length === 0, problems.join("; "));
}

// The POSTURE freshness fold is hand-ordered (POSTURE_SEVERITY in evidence.ts); hold it to the shipped rules too.
// For every pair the rules separate, a same-instant tie must resolve to the value with the harsher shipped outcome,
// in either arrival order. A reorder such as stale above missing turns a restrict into a step-up and fails here.
{
  const RANK: Record<string, number> = { allow: 0, step_up: 1, restrict: 2, deny: 3 };
  const base = buildEvidence(identity, device, workflow, [sig("s_c", "device_compliance", "compliant", BASE), ...healthy()]);
  const pv = { id: "pv_p", tenantId: "tenant_northwind", policyId: "pol_p", version: 1, status: "active" as const, rules: SHARED_DEVICE_RULES_V1, createdAt: BASE, digest: "test" };
  const outcomeOf = (member: string) =>
    RANK[evaluatePolicy(pv, { ...base, postureFreshness: member } as typeof base).outcome]!;
  const values = ["fresh", "stale", "expired", "missing", "unknown"];
  const problems: string[] = [];
  for (const x of values) for (const y of values) {
    if (outcomeOf(x) <= outcomeOf(y)) continue;
    for (const [first, second] of [[x, y], [y, x]] as const) {
      const got = inZone("UTC", "ptie", first, second);
      if (outcomeOf(got) !== outcomeOf(x)) problems.push(`${first}+${second} -> ${got} (outcome ${outcomeOf(got)}, want ${outcomeOf(x)})`);
    }
  }
  check("posture freshness: a same-instant tie resolves to the harsher shipped outcome, in either arrival order", problems.length === 0, problems.join("; "));
}

// A NEGATIVE offset is applied with its sign: 06:00-02:00 is 08:00Z, LATER than the 07:30Z accusation, so the vouch
// wins. Dropping or flipping the sign reads it as 04:00Z (older) or illegible and the accusation stands.
{
  const r = ZONES.map((z) => inZone(z, "verdict", "2026-07-13T06:00:00-02:00"));
  check(
    "explicit -02:00 observedAt: the negative offset is applied (06:00-02:00 = 08:00Z is LATER than the accusation), identically in every zone",
    new Set(r).size === 1 && r[0]!.endsWith("|compliant"),
    r.join(","),
  );
}

// The EVALUATION clock goes through the same strict parser: an offset-less `now` names no instant, so freshness is
// "unknown" in every zone rather than a host-local fresh/stale.
{
  const r = ZONES.map((z) => inZone(z, "freshnow", "2026-07-13T12:30:00Z"));
  check("classifyFreshness: an offset-less evaluation clock is 'unknown' in every zone", r.every((v) => v === "unknown"), r.join(","));
}

// The other core readers of an instant use the same strict parser. An offset-less stamp names no instant, so the
// answer must not move with the host zone, and it must be the fail-closed one: attach `unknown`, remediation
// `unobserved` (the restriction holds), and a test clock that refuses to pin a zone-dependent instant.
{
  const offsetlessAttach = ZONES.map((z) => inZone(z, "attach", "2026-07-13T12:30:00"));
  check("attach: an offset-less observation is 'unknown' in every zone (never host-local attached)", offsetlessAttach.every((v) => v === "unknown"), offsetlessAttach.join(","));
  const zonedAttach = ZONES.map((z) => inZone(z, "attach", "2026-07-13T14:30:00+02:00"));
  check("attach: a zoned observation 30 min before the reference is 'attached' in every zone (control)", zonedAttach.every((v) => v === "attached"), zonedAttach.join(","));
  const offsetlessVerify = ZONES.map((z) => inZone(z, "verify", "2026-07-13T12:00:00"));
  check("remediation: an offset-less evidence read is not admissible, 'unobserved' in every zone (never host-local cleared)", offsetlessVerify.every((v) => v === "unobserved"), offsetlessVerify.join(","));
  const zonedVerify = ZONES.map((z) => inZone(z, "verify", "2026-07-13T08:00:00-04:00"));
  check("remediation: a zoned read inside the window clears, in every zone (control)", zonedVerify.every((v) => v === "cleared"), zonedVerify.join(","));
  const offsetlessClock = ZONES.map((z) => inZone(z, "clock", "2026-07-13T08:00:00"));
  check("fixedClock: an offset-less stamp is refused in every zone (never a host-local pinned instant)", offsetlessClock.every((v) => v === "THROWS"), offsetlessClock.join(","));
  const zonedClock = ZONES.map((z) => inZone(z, "clock", "2026-07-13T08:00:00Z"));
  check("fixedClock: a Z stamp pins that instant in every zone (control)", zonedClock.every((v) => v === "2026-07-13T08:00:00.000Z"), zonedClock.join(","));
}

// FAIL-CLOSED, NOT ONLY ZONE-INDEPENDENT. The checks above prove an offset-less stamp gets the same answer in every
// zone. These prove that answer is never MILDER than the one a UTC host gave the same input under Date.parse
// (golden rule 2: an unreadable signal raises, never lowers). Each failed on head e8dfb15d before its fix.
{
  // Remediation: an accusing read whose instant cannot be read cannot be placed before the request, so it may be the
  // FIRST read in the window. Dropping it let a later clearing read decide: a UTC host under Date.parse said
  // not_cleared (the offset-less 08:10 read came first); the strict parser alone said cleared in every zone.
  const accusing = ZONES.map((z) => inZone(z, "verify2", "2026-07-13T08:10:00"));
  check("remediation: an accusing read with an offset-less instant blocks a later clearing read, not_cleared in every zone", accusing.every((v) => v === "not_cleared"), accusing.join(","));
  const garbled = ZONES.map((z) => inZone(z, "verify2", "not-a-date"));
  check("remediation: an accusing read with a garbled instant also blocks clearing, in every zone", garbled.every((v) => v === "not_cleared"), garbled.join(","));
  const placedBefore = ZONES.map((z) => inZone(z, "verify2", "2026-07-13T07:50:00Z"));
  check("remediation: an accusing read PLACED before the request is outside the window, so the clearing read decides (control)", placedBefore.every((v) => v === "cleared"), placedBefore.join(","));

  // Attach: a removal is an accusation. A UTC host under Date.parse read an offset-less 08:00:00 as 30 s old and
  // graded a forced removal deny CUSTODY_TORN; the strict parser alone dropped it to unknown, step_up CUSTODY_UNKNOWN.
  const torn = ZONES.map((z) => inZone(z, "puck", "removed", "forced", "2026-07-13T08:00:00"));
  check("attach: a forced removal with an offset-less instant stays deny CUSTODY_TORN in every zone (never unknown/step_up)", torn.every((v) => v === "removed|deny|CUSTODY_TORN"), torn.join(","));
  const lifted = ZONES.map((z) => inZone(z, "puck", "removed", "unforced", "2026-07-13T08:00:00"));
  check("attach: an unforced removal with an offset-less instant stays restrict CUSTODY_REMOVED in every zone", lifted.every((v) => v === "removed|restrict|CUSTODY_REMOVED"), lifted.join(","));
  const tornRef = ZONES.map((z) => inZone(z, "puckref", "removed", "forced", "2026-07-13T08:00:30"));
  check("attach: a forced removal judged against an offset-less REFERENCE stays deny CUSTODY_TORN in every zone", tornRef.every((v) => v === "removed|deny|CUSTODY_TORN"), tornRef.join(","));

  // The general rule over every wire state: the same report with an unreadable time is never milder than with a
  // readable, timely one. `attached` is not an accusation, so its unreadable form RAISES (allow -> step_up).
  const RANK: Record<string, number> = { allow: 0, step_up: 1, restrict: 2, deny: 3 };
  const severity = (v: string): number => RANK[v.split("|")[1] ?? ""] ?? -1;
  for (const [wire, forced] of [["removed", "forced"], ["removed", "unforced"], ["attached", "unforced"], ["unseated?", "unforced"]] as const) {
    const timely = inZone("UTC", "puck", wire, forced, "2026-07-13T08:00:00Z");
    for (const unreadable of ["2026-07-13T08:00:00", "garbled"]) {
      const got = ZONES.map((z) => inZone(z, "puck", wire, forced, unreadable));
      check(
        `attach: ${wire}/${forced} with an unreadable instant (${unreadable}) is never milder than the timely reading (${timely}), in every zone`,
        severity(timely) >= 0 && got.every((v) => severity(v) >= severity(timely)),
        got.join(","),
      );
    }
  }
}

// The CONNECTOR side reads instants through one shared helper (lib/integrations/src/utils/freshness.ts) and the
// Graph device-posture adapter. They must read an offset-less stamp the same way the core does: as no instant.
{
  const offsetless = ZONES.map((z) => inZone(z, "sharedfresh", "2026-07-13T12:30:00"));
  check("integrations deriveFreshness/ageMs: an offset-less sighting is stale (present but unreadable) with no age, in every zone", offsetless.every((v) => v === "stale|null"), offsetless.join(","));
  const zoned = ZONES.map((z) => inZone(z, "sharedfresh", "2026-07-13T14:30:00+02:00"));
  check("integrations deriveFreshness/ageMs: a zoned sighting 30 min old is fresh, in every zone (control)", zoned.every((v) => v === "fresh|age"), zoned.join(","));
  const lastSeen = ZONES.map((z) => inZone(z, "devposture", "2026-07-13T12:30:00", "2026-07-13T13:00:00Z"));
  check("device posture: an offset-less deviceLastSeenAt is DEVICE_POSTURE_STALE (same step_up rung as unknown), in every zone", lastSeen.every((v) => v === "step_up|DEVICE_POSTURE_STALE"), lastSeen.join(","));
  const readAt = ZONES.map((z) => inZone(z, "devposture", "2026-07-13T12:30:00Z", "2026-07-13T13:00:00"));
  check("device posture: an offset-less read instant cannot vouch, identically in every zone and never COMPLIANT_MANAGED", new Set(readAt).size === 1 && !readAt[0]!.includes("COMPLIANT_MANAGED"), readAt.join(","));
  const control = ZONES.map((z) => inZone(z, "devposture", "2026-07-13T12:30:00Z", "2026-07-13T13:00:00Z"));
  check("device posture: zoned stamps compose to COMPLIANT_MANAGED, in every zone (control)", control.every((v) => v === "none|COMPLIANT_MANAGED"), control.join(","));
}

// FAIL-CLOSED ON THE CONNECTOR SIDE. NAC, carrier and location rank `stale` ABOVE `unknown` (stale -> step_up/locate,
// unknown -> monitor; deliberate, and the owner's to change). So an offset-less sighting that a UTC host read as stale
// under Date.parse must not become `unknown` and drop to monitor: a PRESENT but unreadable stamp derives `stale`, and
// `unknown` stays reserved for an ABSENT one. Each check below that names a stale outcome failed on head 4cca56a5.
{
  const STALE_ON_UTC = "2026-07-13T12:00:00"; // a UTC host read this as 60 min old against a 30 min bound
  const expectStale: Record<string, string> = {
    nac: "step_up|STALE_NETWORK_STATE",
    carrier: "locate|STALE_LAST_SEEN",
    location: "locate|STALE_LOCATION_FIX",
  };
  const expectAbsent: Record<string, string> = {
    nac: "monitor|AUTHENTICATED_POSTURE_UNVERIFIED",
    carrier: "monitor|LAST_SEEN_UNVERIFIED",
    location: "monitor|UNVERIFIED_LOCATION_FRESHNESS",
  };
  // Ranked within each family's own action set; the shared table is safe because no family mixes the tied rungs.
  const RANK: Record<string, number> = { none: 0, monitor: 1, locate: 2, step_up: 2, alert: 3, restrict: 3, escalate: 4 };
  const rank = (v: string): number => RANK[v.split("|")[0] ?? ""] ?? -1;
  for (const family of ["nac", "carrier", "location"]) {
    const utcTwin = inZone("UTC", "family", family, `${STALE_ON_UTC}Z`);
    check(`${family}: the Z twin of the stale-on-UTC stamp is ${expectStale[family]} (what a UTC host gave under Date.parse)`, utcTwin === expectStale[family], utcTwin);
    const got = ZONES.map((z) => inZone(z, "family", family, STALE_ON_UTC));
    check(`${family}: an offset-less sighting a UTC host read as stale stays ${expectStale[family]} in every zone (never unknown/monitor)`, got.every((v) => v === expectStale[family]), got.join(","));
    const absent = ZONES.map((z) => inZone(z, "family", family, "-"));
    check(`${family}: an ABSENT sighting is still unknown, ${expectAbsent[family]}, in every zone (control)`, absent.every((v) => v === expectAbsent[family]), absent.join(","));
    // The general rule: for an offset-less stamp anywhere (fresh, stale or future on a UTC host) and a garbled one,
    // no zone answers more mildly than a UTC host did under Date.parse (the Z twin; a garbled stamp was NaN there).
    for (const [label, stamp, twin] of [
      ["fresh-on-UTC", "2026-07-13T12:59:00", "2026-07-13T12:59:00Z"],
      ["stale-on-UTC", STALE_ON_UTC, `${STALE_ON_UTC}Z`],
      ["future-on-UTC", "2026-07-13T13:30:00", "2026-07-13T13:30:00Z"],
      ["garbled", "garbled", "-"],
    ] as const) {
      const before = inZone("UTC", "family", family, twin);
      const after = ZONES.map((z) => inZone(z, "family", family, stamp));
      check(
        `${family}: a ${label} unreadable stamp is never milder than a UTC host's Date.parse answer (${before}), in every zone`,
        rank(before) >= 0 && after.every((v) => rank(v) >= rank(before)),
        after.join(","),
      );
    }
  }
}

// OWNER DECISION (b), 2026-11-06, in the attach, remediation and test-clock readers: a date-only stamp names a
// day, not an instant. It may not vouch (an `attached` dated "2026-07-13" was 30 s old at 00:00:30Z and allowed),
// may not clear a restriction (it fell inside a 23:30Z-01:00Z window and cleared), and may not pin a clock. An
// accusation dated that way still stands (a forced removal stays deny).
{
  const seated = ZONES.map((z) => inZone(z, "puckdate", "attached", "unforced"));
  check("date-only: an attach record dated '2026-07-13' cannot vouch, unknown/step_up in every zone (never attached/allow)", seated.every((v) => v === "unknown|step_up|CUSTODY_UNKNOWN"), seated.join(","));
  const torn = ZONES.map((z) => inZone(z, "puckdate", "removed", "forced"));
  check("date-only: a forced removal dated '2026-07-13' still denies CUSTODY_TORN in every zone", torn.every((v) => v === "removed|deny|CUSTODY_TORN"), torn.join(","));
  const cleared = ZONES.map((z) => inZone(z, "verifydate", "2026-07-13"));
  check("date-only: a clearing read dated '2026-07-13' cannot clear, unobserved in every zone (the restriction holds)", cleared.every((v) => v === "unobserved"), cleared.join(","));
  const control = ZONES.map((z) => inZone(z, "verifydate", "2026-07-13T00:00:00Z"));
  check("date-only control: the same read at an exact 00:00:00Z clears, in every zone", control.every((v) => v === "cleared"), control.join(","));
  const clock = ZONES.map((z) => inZone(z, "clock", "2026-07-13"));
  check("date-only: fixedClock refuses '2026-07-13' in every zone (never a pinned midnight)", clock.every((v) => v === "THROWS"), clock.join(","));
}

// OWNER DECISION (a), 2026-11-06: KEEP BOTH accusations until the policy runs (the Codex P1 on #1442/#1792,
// evidence.ts ~622). A tenant policy that denies the MILDER member and has no rule for the stronger one must
// still deny, in either arrival order, whether the two tie on the instant or the milder one's stamp is
// unreadable. The shipped rules must keep their own answer (the stronger member's).
{
  const CASES: ReadonlyArray<readonly [SignalCategory, string, string, string]> = [
    // cross-tier: the shipped rules deny confirmed, restrict suspected; this tenant denies suspected only
    ["tamper_state", "suspected", "confirmed", "deny"],
    // cross-tier: the shipped rules deny forced, restrict removed; this tenant denies removed only
    ["badge_binding", "removed", "forced", "deny"],
    // same tier (the first arrival stood): this tenant denies maintenance, the shipped rules restrict both
    ["custody_state", "maintenance", "overdue", "restrict"],
  ];
  // The bounds of the world enumeration, in-process (no zone involved). Unambiguous evidence carries no retained
  // list (its snapshot is byte-identical to before); too many combinations never allow; a malformed list cannot
  // loosen the base answer.
  {
    const ev = buildEvidence(identity, device, workflow, [sig("s_c", "device_compliance", "compliant", BASE), ...healthy()]);
    const allowAll = {
      id: "pv_allow", tenantId: "tenant_northwind", policyId: "pol_allow", version: 1, status: "active" as const, createdAt: BASE, digest: "test",
      rules: [{ id: "managed-allow", description: "managed", match: [{ field: "deviceManaged", equals: true }], outcome: "allow" as const, reasonCode: "MANAGED_ALLOW", severity: "low" as const }],
    } as unknown as Parameters<typeof evaluatePolicy>[0];
    check("keep both: unambiguous evidence carries no retainedAccusations key", !("retainedAccusations" in ev));
    const many = { ...ev, retainedAccusations: {
      custodyState: ["overdue", "exception", "maintenance"], dockChargeState: ["low", "critical", "not_present"],
      batteryHealth: ["degraded", "failing"], dockState: ["offline", "faulted"], baselineCompliance: ["partial", "drifted", "not_assessed"],
    } } as unknown as typeof ev;
    const truncated = evaluatePolicy(allowAll, many);
    check("keep both: past the world cap the policy never allows (step_up ALLOW_SUPPRESSED_DEGRADED_EVIDENCE)",
      truncated.outcome === "step_up" && truncated.reasonCodes.includes("ALLOW_SUPPRESSED_DEGRADED_EVIDENCE"), `${truncated.outcome}|${truncated.reasonCodes.join("+")}`);
    const malformed = evaluatePolicy(allowAll, { ...ev, retainedAccusations: { tamperState: "confirmed" } } as unknown as typeof ev);
    check("keep both: a malformed retained list is ignored, never loosening the base answer", malformed.outcome === evaluatePolicy(allowAll, ev).outcome, malformed.outcome);
  }
  for (const [category, milder, stronger, shippedOutcome] of CASES) {
    for (const shape of ["tie", "illegible"]) {
      for (const order of ["milder-first", "stronger-first"]) {
        const r = ZONES.map((z) => inZone(z, "tenant", category, milder, stronger, shape, order));
        check(
          `keep both: ${category} ${milder}+${stronger} (${shape}, ${order}) reaches a tenant policy that denies '${milder}' -> deny TENANT_MILDER_DENY, shipped rules still ${shippedOutcome}, in every zone`,
          r.every((v) => v.startsWith("deny|") && v.includes("TENANT_MILDER_DENY") && v.endsWith(`|shipped=${shippedOutcome}`)),
          r.join(","),
        );
      }
    }
  }
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
