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
  PRE_STRICT_FLOATING_FROM,
  PRE_STRICT_HOST_OFFSETS_MINUTES,
  PRE_STRICT_LARGE_STEPS_UNTIL,
  PRE_STRICT_SMALL_STEP_MINUTES,
  preStrictEvidenceWith,
  preStrictStamp,
  runDockSync,
  seedDemoStore,
  SHARED_DEVICE_RULES_V1,
  validatePolicyRules,
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

/**
 * fixedClock on one stamp: the instant it pins, or THROWS when it refuses with ITS OWN zoned-timestamp error. Any
 * other exception is reported verbatim, so a crash elsewhere cannot pass as the refusal (review LOW, 2026-11-07).
 */
function clockFor(iso: string): string {
  try {
    return fixedClock(iso).now().toISOString();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return message === `fixedClock requires a zoned ISO timestamp (Z or ±HH:MM), got: ${iso}` ? "THROWS" : `OTHER-ERROR: ${message}`;
  }
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
function familyFor(family: string, stamp: string, nowEpochMs = "1783947600000"): string {
  const now = parseInt(nowEpochMs, 10); // default 2026-07-13T13:00:00Z, as epoch ms so no parse is involved
  const seen = stamp === "-" ? null : stamp;
  const bound = { staleAfterMs: 30 * 60 * 1000 };
  if (family === "nac" || family === "nacmgmt") {
    // Review F2 (2026-11-07): judged under a segment policy, so a stamp's age can never mask a restricted segment.
    // `nac` is on the expected segment; `nacmgmt` sits on the restricted management segment.
    const r = evaluateNetwork({
      sourceSystem: "network-nac", correlationId: "c_tz", observedAt: "2026-07-13T13:00:00Z", deviceId: "d_tz",
      authState: "authenticated", segment: family === "nac" ? "corp" : "mgmt", accessLocation: null, nacCompliant: true, lastAuthAt: seen, freshness: "unknown",
    }, now, { ...bound, segmentPolicy: { expected: ["corp"], restricted: ["mgmt"] } });
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

/**
 * Review F1 (2026-11-07): ONE posture reading stated `expired` whose stamp cannot be read or is future-dated. The
 * fold answers `unknown`, but a tenant policy that denies `expired` must still see it. `shape` picks the stamp.
 */
function postureTenantFor(shape: string): string {
  const at = shape === "garbled" ? "garbled" : shape === "offsetless" ? "2026-07-13T09:00:00" : "2026-07-14T09:00:00Z";
  const signals = [sig("s_p", "posture_freshness", "expired", at), sig("s_c", "device_compliance", "compliant", BASE), ...healthy().filter((x) => x.category !== "posture_freshness")];
  const ev = buildEvidence(identity, device, workflow, signals, shape === "future" ? BASE : undefined);
  const tenant = {
    id: "pv_exp", tenantId: "tenant_northwind", policyId: "pol_exp", version: 1, status: "active" as const, createdAt: BASE, digest: "test",
    rules: [
      { id: "tenant-expired-deny", description: "expired posture denies", match: [{ field: "postureFreshness", in: ["expired"] }], outcome: "deny" as const, reasonCode: "TENANT_EXPIRED_DENY", severity: "high" as const },
      { id: "tenant-managed-allow", description: "managed", match: [{ field: "deviceManaged", equals: true }], outcome: "allow" as const, reasonCode: "TENANT_MANAGED_ALLOW", severity: "low" as const },
    ],
  } as unknown as Parameters<typeof evaluatePolicy>[0];
  const r = evaluatePolicy(tenant, ev);
  return `${r.outcome}|${r.reasonCodes.join("+")}`;
}

/**
 * The six Codex P1 repros of 2026-11-07, as `<outcome>|<reasons>`. Each was LOOSER than the pre-strict reader on a
 * UTC host; the expected answer is that reader's (and it is reached in every zone).
 */
function codexFor(which: string): string {
  const allowManaged = { id: "allow", description: "a", match: [{ field: "deviceManaged", equals: true }], outcome: "allow" as const, reasonCode: "TENANT_ALLOW", severity: "low" as const };
  const pv = (rules: unknown) => ({ id: "pv_codex", tenantId: "tenant_northwind", policyId: "pol_codex", version: 1, status: "active" as const, rules, createdAt: BASE, digest: "test" }) as unknown as Parameters<typeof evaluatePolicy>[0];
  const base = (drop: SignalCategory[] = []) => [sig("s_c", "device_compliance", "compliant", BASE), ...healthy()].filter((x) => !drop.includes(x.category));
  let signals: NormalizedSignal[] = [];
  let rules: unknown = SHARED_DEVICE_RULES_V1;
  let now: string | undefined;
  const pairs = (families: (readonly [SignalCategory, ...string[]])[]) => families.flatMap(([c, ...vs]) => vs.map((v, i) => sig(`s_${c}_${i}`, c, v, "2026-07-13T12:00:00.000Z")));
  if (which === "a") signals = [sig("s_1", "charge_state", "low", "2026-07-13T07:00:00Z"), sig("s_2", "charge_state", "bogus", "2026-07-13T08:00:00"), ...base()];
  if (which === "b") {
    signals = [...pairs([["tamper_state", "suspected", "confirmed"], ["badge_binding", "removed", "forced"], ["custody_state", "overdue", "maintenance"], ["charge_state", "low", "critical"], ["battery_health", "degraded", "failing"], ["dock_state", "offline", "faulted"], ["security_baseline", "partial", "drifted"], ["device_management_health", "degraded", "broken"], ["posture_freshness", "stale", "expired"]]), ...base(["posture_freshness"])];
    rules = [{ id: "d", description: "d", match: [{ field: "tamperState", in: ["suspected"] }, { field: "badgeState", in: ["removed"] }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged];
  }
  if (which === "c") {
    signals = [sig("s_1", "enrollment_strength", "strong", "2026-07-13T07:00:00Z"), sig("s_2", "enrollment_strength", "legacy_125khz", "2026-07-13T08:00:00"), ...base()];
    rules = [{ id: "d", description: "d", match: [{ field: "enrollmentStrength", in: ["legacy_125khz"] }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged];
  }
  if (which === "d") { signals = [sig("s_1", "posture_freshness", "fresh", BASE), sig("s_2", "posture_freshness", "fresh", "2026-07-13T14:00:00"), ...base(["posture_freshness"])]; now = BASE; }
  if (which === "e-charge") signals = [sig("s_1", "charge_state", "garbled", BASE), sig("s_2", "charge_state", "low", "2026-07-13"), ...base()];
  if (which === "e-battery") signals = [sig("s_1", "battery_health", "garbled", BASE), sig("s_2", "battery_health", "degraded", "2026-07-13"), ...base()];
  if (which === "f") {
    signals = [...pairs([["custody_state", "overdue", "maintenance", "exception"], ["charge_state", "low", "critical", "not_present"], ["battery_health", "degraded", "failing"], ["tamper_state", "suspected", "confirmed", "sensor_unavailable"], ["dock_state", "offline", "faulted"], ["security_baseline", "partial", "drifted", "not_assessed"]]), ...base()];
    rules = [{ id: "d", description: "d", match: [{ field: "batteryHealth", in: ["degraded"] }, { field: "tamperState", in: ["suspected"] }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged];
  }
  // Round 5 (2026-11-07). g/h: RFC 2822 text Date.parse read, the strict reader cannot, beside an orderable
  // "fresh"; i/j: a validated tenant policy that matches criticalSignalsPresent=true, which mainline's complete
  // evidence reaches and a backstop pinned to the base's failed one never did.
  if (which === "g") { signals = [sig("s_1", "posture_freshness", "fresh", BASE), sig("s_2", "posture_freshness", "fresh", "Tue, 14 Jul 2026 13:00:00 GMT"), ...base(["posture_freshness"])]; now = BASE; }
  if (which === "h") { signals = [sig("s_1", "posture_freshness", "fresh", BASE), sig("s_2", "posture_freshness", "fresh", "Mon, 13 Jul 2026 14:00:00 GMT"), ...base(["posture_freshness"])]; now = BASE; }
  if (which === "i") {
    signals = [sig("s_t", "tamper_state", "confirmed", BASE), sig("s_1", "charge_state", "bogus", "2026-07-13T07:00:00Z"), sig("s_2", "charge_state", "charged", "2026-07-13T08:00:00"), ...base()];
    rules = validatePolicyRules([{ id: "d", description: "confirmed tamper on complete evidence", match: [{ field: "tamperState", in: ["confirmed"] }, { field: "criticalSignalsPresent", equals: true }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged]);
  }
  if (which === "j") {
    signals = [sig("s_1", "device_compliance", "malformed", "2026-07-13T07:00:00Z"), sig("s_2", "device_compliance", "compliant", "2026-07-13T08:00:00"), ...base(["device_compliance"])];
    rules = validatePolicyRules([{ id: "d", description: "complete evidence denies", match: [{ field: "criticalSignalsPresent", equals: true }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged]);
  }
  // Round 6 (2026-11-08), Codex P1 on #1809 (thread 4504013403): a daylight-saving switch BETWEEN two floating
  // stamps of one decision. Under America/New_York mainline reads 01:30 at -05:00 (06:30Z, after the stale 06:15Z
  // charge reading) and 03:30 at -04:00 (07:30Z, before the fresh 08:00Z battery reading), so both dock categories
  // select their FRESH reading and the evidence is complete; no single offset does that, and round 5 stepped up.
  if (which === "k") {
    const at = (id: string, category: SignalCategory, value: NormalizedSignal["value"], observedAt: string, freshness: NormalizedSignal["freshness"]): NormalizedSignal => ({ ...sig(id, category, value, observedAt), freshness });
    const T = "2026-03-08T08:30:00Z";
    signals = [
      sig("s_m", "device_management", true, T), sig("s_e", "device_encryption", true, T), sig("s_o", "os_support", true, T),
      sig("s_c", "device_compliance", "compliant", T), sig("s_p", "posture_freshness", "fresh", T),
      at("s_c1", "charge_state", "charged", "2026-03-08T06:15:00Z", "stale"), at("s_c2", "charge_state", "charged", "2026-03-08T01:30:00", "fresh"),
      at("s_b1", "battery_health", "healthy", "2026-03-08T08:00:00Z", "fresh"), at("s_b2", "battery_health", "healthy", "2026-03-08T03:30:00", "stale"),
    ];
    now = "2026-03-08T09:00:00Z";
    rules = validatePolicyRules([{ id: "d", description: "complete evidence denies", match: [{ field: "criticalSignalsPresent", equals: true }], outcome: "deny", reasonCode: "TENANT_DENY", severity: "high" }, allowManaged]);
  }
  const r = evaluatePolicy(pv(rules), buildEvidence(identity, device, workflow, signals, now));
  return `${r.outcome}|${r.reasonCodes.join("+")}`;
}

/**
 * THE CLASS ACROSS A DAYLIGHT-SAVING SWITCH (round 6): the same differential as `classFor`, over stamps around the
 * real 2026 transitions of America/New_York (03-08, 11-01), Europe/London (03-29, 10-25) and Australia/Lord_Howe
 * (04-05, 10-04, a 30-minute step): offset-less quarter-hour wall times across each switch, zoned stamps within two
 * hours of where that zone puts such a wall, per-reading freshness labels (the dock-wide freshness folds them), a
 * clock after the zoned stamps (or offset-less, or absent), and validated tenant policies with a deny on
 * criticalSignalsPresent=true. The reference is `Date.parse` on THIS host, which steps its offset between stamps.
 */
function dstClassFor(seedText: string, trialsText: string): string {
  let seed = Number(seedText) >>> 0;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const p2 = (x: number): string => String(x).padStart(2, "0");
  // [date, first wall hour, last wall hour, offset before, offset after (minutes), wall minute the new offset starts]
  const SWITCHES: readonly (readonly [string, number, number, number, number, number])[] = [
    ["2026-03-08", 0, 5, -300, -240, 180], ["2026-11-01", 0, 4, -240, -300, 120],
    ["2026-03-29", 0, 3, 0, 60, 120], ["2026-10-25", 0, 3, 60, 0, 120],
    ["2026-04-05", 1, 3, 660, 630, 120], ["2026-10-04", 1, 3, 630, 660, 150],
  ];
  const DOCK: readonly (readonly [SignalCategory, readonly NormalizedSignal["value"][]])[] = [
    ["custody_state", ["checked_in", "overdue", "maintenance"]], ["charge_state", ["charged", "low", "critical"]],
    ["battery_health", ["healthy", "degraded", "failing"]], ["tamper_state", ["none", "suspected", "confirmed"]],
    ["dock_state", ["occupied", "offline", "faulted"]], ["badge_binding", ["present", "removed", "forced"]], ["attach_state", ["attached", "removed"]],
  ];
  const OTHER: readonly (readonly [SignalCategory, readonly NormalizedSignal["value"][]])[] = [
    ["device_compliance", ["compliant", "non_compliant"]], ["posture_freshness", ["fresh", "stale", "unknown"]], ["security_baseline", ["aligned", "drifted"]],
    ["device_management", [true, false]], ["device_encryption", [true, false]], ["os_support", [true, false]], ["identity_state", [true, false]],
  ];
  const FIELDS: Record<string, readonly string[]> = {
    deviceCompliance: ["compliant", "non_compliant", "unknown"], postureFreshness: ["fresh", "stale", "expired", "missing", "unknown"],
    chargeState: ["charged", "low", "unknown", "unreadable"], batteryHealth: ["healthy", "degraded", "unknown", "unreadable"],
    tamperState: ["none", "suspected", "confirmed", "unknown", "unreadable"], dockState: ["occupied", "offline", "unknown", "unreadable"],
    badgeState: ["present", "removed", "forced", "unknown", "unreadable"], attachState: ["attached", "removed", "unknown"],
  };
  const RANK: Record<string, number> = { allow: 0, step_up: 1, restrict: 2, deny: 3 };
  let milder = 0;
  let fingerprint = 0x811c9dc5;
  let example = "";
  for (let trial = 0; trial < Number(trialsText); trial++) {
    const [date, h0, h1, before, after, switchAt] = pick(SWITCHES);
    const pickWall = (): readonly [number, number] => [h0 + Math.floor(rnd() * (h1 - h0 + 1)), 15 * Math.floor(rnd() * 4)];
    const wall = (): string => { const [h, m] = pickWall(); return `${date}T${p2(h)}:${p2(m)}:00`; };
    const zoned = (): string => {
      const [h, m] = pickWall();
      const t = Date.parse(`${date}T${p2(h)}:${p2(m)}:00Z`) - (h * 60 + m >= switchAt ? after : before) * 60_000 + (Math.floor(rnd() * 17) - 8) * 900_000;
      return new Date(t).toISOString().replace(".000Z", "Z");
    };
    const signals: NormalizedSignal[] = [];
    const touched = new Set<string>();
    for (let f = 1 + Math.floor(rnd() * 4); f > 0; f--) {
      const [category, members] = rnd() < 0.7 ? pick(DOCK) : pick(OTHER);
      touched.add(category);
      for (let r = 2 + Math.floor(rnd() * 2); r > 0; r--) {
        const value = rnd() < 0.05 ? "bogus" : rnd() < 0.7 ? members[0]! : pick(members);
        signals.push({ ...sig(`s${signals.length}`, category, value, rnd() < 0.5 ? wall() : zoned()), freshness: pick(["fresh", "stale"] as const) });
      }
    }
    for (const [category, value] of [["device_management", true], ["device_encryption", true], ["os_support", true], ["device_compliance", "compliant"], ["posture_freshness", "fresh"]] as const) {
      if (!touched.has(category)) signals.push(sig(`s${signals.length}`, category, value, zoned()));
    }
    const latest = Math.max(...signals.map((x) => (x.observedAt.endsWith("Z") ? Date.parse(x.observedAt) : -Infinity)));
    const later = new Date(Math.floor((latest + (1 + rnd() * 3) * 3_600_000) / 900_000) * 900_000).toISOString().replace(".000Z", "Z");
    const now = pick([later, later, later, wall(), undefined]);
    const id = { ...identity, state: rnd() < 0.8 ? ("enabled" as const) : pick(["disabled", "unknown_state"] as const) } as Identity;
    const raw: unknown[] = [];
    if (rnd() < 0.5) raw.push({ id: "critical", description: "complete evidence denies", match: [{ field: "criticalSignalsPresent", equals: true }], outcome: "deny", reasonCode: "TENANT_CRIT", severity: "high" });
    for (let i = Math.floor(rnd() * 3); i > 0; i--) {
      const field = pick(Object.keys(FIELDS));
      const values = FIELDS[field]!.filter(() => rnd() < 0.35);
      raw.push({ id: `r${i}`, description: "tenant rule", match: [{ field, in: values.length > 0 ? values : [pick(FIELDS[field]!)] }, ...(rnd() < 0.5 ? [{ field: "criticalSignalsPresent", equals: rnd() < 0.6 }] : [])], outcome: pick(["step_up", "restrict", "deny"]), reasonCode: `TENANT_R${i}`, severity: "high" });
    }
    raw.push({ id: "managed", description: "managed allow", match: [{ field: "deviceManaged", equals: true }], outcome: "allow", reasonCode: "TENANT_ALLOW", severity: "low" });
    const rules = rnd() < 0.15 ? SHARED_DEVICE_RULES_V1 : validatePolicyRules(raw);
    const pv = { id: "pv_dst", tenantId: "tenant_northwind", policyId: "pol_dst", version: 1, status: "active" as const, rules, createdAt: BASE, digest: "test" } as unknown as Parameters<typeof evaluatePolicy>[0];
    const head = evaluatePolicy(pv, buildEvidence(id, device, workflow, signals, now)).outcome;
    const reference = evaluatePolicy(pv, preStrictEvidenceWith(id, device, workflow, signals, now, (iso) => Date.parse(iso))).outcome;
    for (const ch of head) fingerprint = Math.imul(fingerprint ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    if (RANK[head]! < RANK[reference]!) {
      milder++;
      if (example === "") example = ` first=trial${trial}:${reference}->${head}`;
    }
  }
  return `milder=${milder} fingerprint=${fingerprint.toString(16)}${example}`;
}

/**
 * The three facts about real zones that make round 6's offset model every host (`preStrictOffsetSteps` in util.ts),
 * measured against THIS runtime's own zone data (Intl), every zone it ships, from `PRE_STRICT_FLOATING_FROM` to 2040:
 * (1) every offset is a whole quarter hour in [-12:00, +14:00]; (2) two transitions of one zone are at least 156
 * hours apart; (3) after `PRE_STRICT_LARGE_STEPS_UNTIL` no transition steps by more than
 * `PRE_STRICT_SMALL_STEP_MINUTES`. Offsets are sampled every 72 hours and each change is located to the minute,
 * so a period between two transitions shorter than 72 hours would be missed (none is known; the shortest found is
 * 167 hours). A newer runtime whose zone data breaks a fact fails this proof, and the constants must move.
 */
function zoneFacts(): string {
  const zones = Intl.supportedValuesOf("timeZone");
  const lowest = PRE_STRICT_HOST_OFFSETS_MINUTES[0]!;
  const highest = PRE_STRICT_HOST_OFFSETS_MINUTES[PRE_STRICT_HOST_OFFSETS_MINUTES.length - 1]!;
  const from = PRE_STRICT_FLOATING_FROM - 14 * 3_600_000;
  const to = Date.UTC(2040, 0, 1);
  const SAMPLE = 72 * 3_600_000;
  const problems: string[] = [];
  let transitions = 0;
  let shortest = Infinity;
  let largestRecent = 0;
  for (const zone of zones) {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
    const offsetAt = (t: number): number => {
      const text = format.formatToParts(new Date(t)).find((part) => part.type === "timeZoneName")!.value;
      const m = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
      if (!m) return Number.NaN;
      if (m[1] === undefined) return 0;
      return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60);
    };
    let previous = offsetAt(from);
    let previousAt = from;
    let lastTransition = -Infinity;
    const onGrid = (offset: number): boolean => Number.isInteger(offset / 15) && offset >= lowest && offset <= highest;
    if (!onGrid(previous)) problems.push(`${zone}: ${previous}min at the start`);
    for (let t = from + SAMPLE; t <= to; t += SAMPLE) {
      const offset = offsetAt(t);
      if (offset === previous) { previousAt = t; continue; }
      // Locate the change to the minute.
      let lo = previousAt, hi = t;
      while (hi - lo > 60_000) { const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000; if (offsetAt(mid) === previous) lo = mid; else hi = mid; }
      transitions++;
      if (!onGrid(offset)) problems.push(`${zone}: ${offset}min at ${new Date(hi).toISOString()}`);
      if (hi - lastTransition < shortest) shortest = hi - lastTransition;
      if (hi - lastTransition < 156 * 3_600_000) problems.push(`${zone}: transitions ${((hi - lastTransition) / 3_600_000).toFixed(1)}h apart at ${new Date(hi).toISOString()}`);
      if (hi >= PRE_STRICT_LARGE_STEPS_UNTIL) {
        largestRecent = Math.max(largestRecent, Math.abs(offset - previous));
        if (Math.abs(offset - previous) > PRE_STRICT_SMALL_STEP_MINUTES) problems.push(`${zone}: a ${offset - previous}min step at ${new Date(hi).toISOString()}`);
      }
      lastTransition = hi;
      previous = offset;
      previousAt = t;
    }
  }
  return `zones=${zones.length} transitions=${transitions} shortestGapDays=${(shortest / 86_400_000).toFixed(2)} largestStepSince2012=${largestRecent}min problems=${problems.length}${problems.length > 0 ? ` ${problems.slice(0, 5).join("; ")}` : ""}`;
}

/**
 * THE CLASS (round 5): a seeded differential, run in THIS process's zone. Each trial builds random multi-family
 * evidence over stamp shapes the strict and pre-strict readers disagree on (offset-less, date-only, impossible
 * dates, RFC 2822 / RFC 1123 text zoned and zone-less, other Date.parse text, garbage, ±HH) and malformed values
 * beside valid ones, and a random tenant policy that `validatePolicyRules` accepts (deny rules on
 * criticalSignalsPresent=true, tamper, compliance, posture and every other field), or the shipped rules. The
 * reference is the pre-strict reader on THIS host: `preStrictEvidenceWith(..., Date.parse)`, mainline's folds and
 * mainline's reader. Prints how many verdicts came out MILDER than the reference (owner decision (c)'s ±HH stamps
 * excepted) and a fingerprint of every verdict, which must be the same in every zone.
 */
function classFor(seedText: string, trialsText: string): string {
  let seed = Number(seedText) >>> 0;
  const rnd = (): number => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const FAMILIES: readonly (readonly [SignalCategory, readonly NormalizedSignal["value"][]])[] = [
    ["device_compliance", ["compliant", "non_compliant"]], ["custody_state", ["checked_in", "overdue", "maintenance"]],
    ["charge_state", ["charged", "low", "critical"]], ["battery_health", ["healthy", "degraded", "failing"]],
    ["tamper_state", ["none", "suspected", "confirmed"]], ["dock_state", ["occupied", "offline", "faulted"]],
    ["security_baseline", ["aligned", "partial", "drifted"]], ["badge_binding", ["present", "removed", "forced"]],
    ["device_management_health", ["healthy", "degraded", "broken"]], ["enrollment_strength", ["strong", "legacy_125khz"]],
    ["posture_freshness", ["fresh", "stale", "expired", "missing", "unknown"]], ["device_management", [true, false]],
    ["device_encryption", [true, false]], ["os_support", [true, false]], ["identity_state", [true, false]],
  ];
  const PLUS_HH = ["2026-07-13T09:00:00+00", "2026-07-13T10:00:00-07"];
  const STAMPS = [
    "2026-07-13T07:00:00Z", "2026-07-13T08:00:00Z", "2026-07-13T12:59:00Z", "2026-07-12T01:00:00Z", "2026-07-14T09:00:00Z", "2026-07-13T09:00:00+02:00",
    "2026-07-13T08:00:00", "2026-07-13T14:00:00", "2026-07-12T20:00:00", "2026-07-13 09:00:00", "2026-07-13", "2026-07-14", "2026-02-30T08:00:00Z",
    "Tue, 14 Jul 2026 13:00:00 GMT", "Mon, 13 Jul 2026 14:00:00 GMT", "Mon, 13 Jul 2026 12:00:00 GMT", "Fri, 10 Jul 2026 08:00:00 GMT",
    "Mon, 13 Jul 2026 21:00:00 +0900", "Mon, 13 Jul 2026 08:00:00 EST", "Jul 13 2026 08:00:00", "7/13/2026 14:00", "13 Jul 2026 08:00 +9",
    "Mon, 13 Jul 2026 08:00-07", "garbled", "", ...PLUS_HH,
  ];
  const FIELDS: Record<string, readonly string[]> = {
    deviceCompliance: ["compliant", "non_compliant", "unknown"], postureFreshness: ["fresh", "stale", "expired", "missing", "unknown"],
    custodyState: ["checked_in", "overdue", "maintenance", "unknown", "unreadable"], chargeState: ["charged", "low", "critical", "unknown", "unreadable"],
    batteryHealth: ["healthy", "degraded", "failing", "unknown", "unreadable"], tamperState: ["none", "suspected", "confirmed", "unknown", "unreadable"],
    dockState: ["occupied", "offline", "faulted", "unknown", "unreadable"], baselineState: ["aligned", "partial", "drifted", "unknown"],
    badgeState: ["present", "removed", "forced", "unknown", "unreadable"], managementHealthState: ["healthy", "degraded", "broken", "unknown"],
    enrollmentStrength: ["strong", "legacy_125khz", "unknown", "not_applicable"],
  };
  const RANK: Record<string, number> = { allow: 0, step_up: 1, restrict: 2, deny: 3 };
  const trials = Number(trialsText);
  let milder = 0;
  let fingerprint = 0x811c9dc5;
  let example = "";
  for (let trial = 0; trial < trials; trial++) {
    const signals: NormalizedSignal[] = [];
    const touched = new Set<string>();
    for (let f = 1 + Math.floor(rnd() * 4); f > 0; f--) {
      const [category, members] = pick(FAMILIES);
      touched.add(category);
      for (let r = 1 + Math.floor(rnd() * 3); r > 0; r--) {
        signals.push(sig(`s${signals.length}`, category, rnd() < 0.15 ? pick(["bogus", 42, ""]) as NormalizedSignal["value"] : pick(members), pick(STAMPS)));
      }
    }
    for (const x of [sig("s_c", "device_compliance", "compliant", "2026-07-13T12:30:00Z"), ...healthy()]) if (!touched.has(x.category)) signals.push(x);
    const now = pick([BASE, BASE, undefined, "2026-07-13T13:00:00"]);
    const rules = rnd() < 0.2 ? SHARED_DEVICE_RULES_V1 : validatePolicyRules([
      ...Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({
        id: `r${i}`, description: "tenant rule", outcome: pick(["allow", "step_up", "restrict", "deny", "deny"]), reasonCode: `TENANT_R${i}`, severity: "high",
        match: Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => {
          const roll = rnd();
          if (roll < 0.3) return { field: "criticalSignalsPresent", equals: rnd() < 0.7 };
          if (roll < 0.45) return { field: pick(["identityEnabled", "deviceManaged", "deviceEncrypted", "osSupported"]), equals: pick([true, false, "unknown"]) };
          const field = pick(Object.keys(FIELDS));
          const pool = FIELDS[field]!;
          const values = pool.filter(() => rnd() < 0.35);
          return { field, in: values.length > 0 ? values : [pick(pool)] };
        }),
      })),
      { id: "managed", description: "managed allow", match: [{ field: "deviceManaged", equals: true }], outcome: "allow", reasonCode: "TENANT_ALLOW", severity: "low" },
    ]);
    const pv = { id: "pv_class", tenantId: "tenant_northwind", policyId: "pol_class", version: 1, status: "active" as const, rules, createdAt: BASE, digest: "test" } as unknown as Parameters<typeof evaluatePolicy>[0];
    const head = evaluatePolicy(pv, buildEvidence(identity, device, workflow, signals, now)).outcome;
    const reference = evaluatePolicy(pv, preStrictEvidenceWith(identity, device, workflow, signals, now, (iso) => Date.parse(iso))).outcome;
    for (const ch of head) fingerprint = Math.imul(fingerprint ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    if (RANK[head]! < RANK[reference]! && !signals.some((x) => PLUS_HH.includes(x.observedAt))) {
      milder++;
      if (example === "") example = ` first=trial${trial}:${reference}->${head}`;
    }
  }
  return `milder=${milder} fingerprint=${fingerprint.toString(16)}${example}`;
}

/**
 * The pre-strict stamp classifier against the real `Date.parse` of THIS process's zone, over a generated corpus of
 * date text: prints the classification of every accepted stamp, and how many disagree with this zone's
 * `Date.parse` (a `fixed` stamp at another instant, a `floating` one off the modelled offsets).
 */
function classifyFor(): string {
  const dates = ["2026-07-13", "2026-7-13", "2026/07/13", "07/13/2026", "13 Jul 2026", "Jul 13 2026", "July 13, 2026", "Mon, 13 Jul 2026", "Monday, July 13, 2026", "2026-07", "13-Jul-2026", "2026-02-30", "+002026-07-13", "2026-03-08", "2026-03-29", "Nov 1 2026", "1 Jan 1970"];
  const times = ["", "T08:00:00", "T08:00", "T08:00:00.123", " 08:00:00", " 08:00", " 8:00 PM", "t08:00:00", " 24:00:00", "T02:30:00", " 01:30", " 12:00 AM"];
  const zones = ["", " GMT", " UTC", " UT", "Z", "z", "+0900", "-0700", "+09:00", "+05", "-07", " +0900", " GMT+0900", " EST", " PDT", " (JST)", " GMT+0900 (Japan Standard Time)", " +9", " UTC+1", " garbage"];
  const out: string[] = [];
  let bad = 0;
  for (const d of dates) for (const t of times) for (const z of zones) {
    const text = `${d}${t}${z}`;
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) continue;
    const stamp = preStrictStamp(text);
    out.push(`${text}=${stamp.kind}:${stamp.kind === "fixed" ? stamp.at : stamp.kind === "floating" ? stamp.wall : ""}`);
    if (stamp.kind === "fixed" && stamp.at !== parsed) bad++;
    if (stamp.kind === "floating" && !PRE_STRICT_HOST_OFFSETS_MINUTES.includes((stamp.wall - parsed) / 60_000)) bad++;
  }
  let fingerprint = 0x811c9dc5;
  for (const ch of out.join("\n")) fingerprint = Math.imul(fingerprint ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `accepted=${out.length} disagree=${bad} fingerprint=${fingerprint.toString(16)}`;
}

if (process.argv[2] === "--worker") {
  const [mode, a, b, c] = process.argv.slice(3);
  const out =
    mode === "codex" ? codexFor(a!)
    : mode === "class" ? classFor(a!, b!)
    : mode === "dstclass" ? dstClassFor(a!, b!)
    : mode === "zonefacts" ? zoneFacts()
    : mode === "classify" ? classifyFor()
    : mode === "ptenant" ? postureTenantFor(a!)
    : mode === "tenant" ? tenantFor(a as SignalCategory, b!, c!, process.argv[7]!, process.argv[8]!)
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
    : mode === "familydate" ? familyFor(a!, "2026-07-13", "1783901400000") // judged at 2026-07-13T00:10:00Z
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
    nacmgmt: "restrict|SEGMENT_RESTRICTED",
    carrier: "locate|STALE_LAST_SEEN",
    location: "locate|STALE_LOCATION_FIX",
  };
  const expectAbsent: Record<string, string> = {
    nac: "monitor|AUTHENTICATED_POSTURE_UNVERIFIED",
    nacmgmt: "restrict|SEGMENT_RESTRICTED",
    carrier: "monitor|LAST_SEEN_UNVERIFIED",
    location: "monitor|UNVERIFIED_LOCATION_FRESHNESS",
  };
  // Ranked within each family's own action set; the shared table is safe because no family mixes the tied rungs.
  const RANK: Record<string, number> = { none: 0, monitor: 1, locate: 2, step_up: 2, alert: 3, restrict: 3, escalate: 4 };
  const rank = (v: string): number => RANK[v.split("|")[0] ?? ""] ?? -1;
  for (const family of ["nac", "nacmgmt", "carrier", "location"]) {
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
    // Above the world cap (here 4*4*3*3*4*4*3*4 = 27648 combinations) the policy bounds the strictest combination:
    // it never allows, and a rule that needs TWO families' values together is still found (Codex P1s (b), (f)).
    const many = { ...ev, retainedAccusations: {
      custodyState: ["overdue", "exception", "maintenance"], dockChargeState: ["low", "critical", "not_present"],
      batteryHealth: ["degraded", "failing"], dockState: ["offline", "faulted"], baselineCompliance: ["partial", "drifted", "not_assessed"],
      tamperState: ["suspected", "confirmed", "sensor_unavailable"], badgeBinding: ["removed", "forced"],
      managementHealthState: ["degraded", "broken", "unknown"],
    } } as unknown as typeof ev;
    const truncated = evaluatePolicy(allowAll, many);
    check("keep both: past the world cap the policy never allows (step_up ALLOW_SUPPRESSED_DEGRADED_EVIDENCE)",
      truncated.outcome === "step_up" && truncated.reasonCodes.includes("ALLOW_SUPPRESSED_DEGRADED_EVIDENCE"), `${truncated.outcome}|${truncated.reasonCodes.join("+")}`);
    const pairDeny = { ...allowAll, id: "pv_pair", rules: [
      { id: "pair-deny", description: "two families together", match: [{ field: "tamperState", in: ["suspected"] }, { field: "badgeState", in: ["removed"] }], outcome: "deny" as const, reasonCode: "TENANT_PAIR_DENY", severity: "high" as const },
      ...(allowAll as unknown as { rules: unknown[] }).rules,
    ] } as unknown as Parameters<typeof evaluatePolicy>[0];
    const bounded = evaluatePolicy(pairDeny, many);
    check("keep both: past the world cap a rule needing two families' retained values still denies (never a sampled step_up)",
      bounded.outcome === "deny" && bounded.reasonCodes.includes("TENANT_PAIR_DENY"), `${bounded.outcome}|${bounded.reasonCodes.join("+")}`);
    // From a NON-allow baseline (a confirmed tamper denies under the shipped rules), so "never loosens" can fail:
    // a malformed list must not move deny anywhere, whether it is a bare string or an array naming the GOOD member.
    const accused = buildEvidence(identity, device, workflow, [sig("s_t", "tamper_state", "confirmed", BASE), sig("s_c", "device_compliance", "compliant", BASE), ...healthy()]);
    const shippedPv = { ...allowAll, id: "pv_shipped_m", rules: SHARED_DEVICE_RULES_V1 } as Parameters<typeof evaluatePolicy>[0];
    const baseline = evaluatePolicy(shippedPv, accused).outcome;
    const asString = evaluatePolicy(shippedPv, { ...accused, retainedAccusations: { tamperState: "none" } } as unknown as typeof accused).outcome;
    const asGood = evaluatePolicy(shippedPv, { ...accused, retainedAccusations: { tamperState: ["none"] } } as unknown as typeof accused).outcome;
    check("keep both: a malformed retained list never loosens a non-allow baseline (deny stays deny)", baseline === "deny" && asString === "deny" && asGood === "deny", `${baseline}|${asString}|${asGood}`);
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

// OWNER DECISION (b), 2026-11-06, on the connector side: a date-only sighting names a day, not an instant. It is
// PRESENT but unreadable, so it grades `stale` (never `fresh`, never the milder `unknown`) and has no age. Judged
// ten minutes after midnight, a "2026-07-13" read as exact midnight was 10 minutes old and fresh.
{
  const shared = ZONES.map((z) => inZone(z, "sharedfresh", "2026-07-13"));
  check("date-only: integrations deriveFreshness/ageMs grade a '2026-07-13' sighting stale with no age, in every zone", shared.every((v) => v === "stale|null"), shared.join(","));
  const posture = ZONES.map((z) => inZone(z, "devposture", "2026-07-13", "2026-07-13T13:00:00Z"));
  check("date-only: a Graph deviceLastSeenAt of '2026-07-13' is DEVICE_POSTURE_STALE, in every zone", posture.every((v) => v === "step_up|DEVICE_POSTURE_STALE"), posture.join(","));
  const expectStale: Record<string, string> = { nac: "step_up|STALE_NETWORK_STATE", nacmgmt: "restrict|SEGMENT_RESTRICTED", carrier: "locate|STALE_LAST_SEEN", location: "locate|STALE_LOCATION_FIX" };
  for (const family of ["nac", "nacmgmt", "carrier", "location"]) {
    const got = ZONES.map((z) => inZone(z, "familydate", family));
    check(`date-only: ${family} with a '2026-07-13' sighting judged at 00:10Z is ${expectStale[family]} (never the fresh grant), in every zone`, got.every((v) => v === expectStale[family]), got.join(","));
  }
}

// Review F1 (2026-11-07): a SOLE posture reading stated `expired` with a garbled, offset-less or future stamp folds to
// `unknown`. Keep-both must still hand `expired` to a tenant policy that denies it (mainline denied).
for (const shape of ["garbled", "offsetless", "future"]) {
  const r = ZONES.map((z) => inZone(z, "ptenant", shape));
  check(`keep both: a sole posture 'expired' with a ${shape} stamp still reaches a tenant policy that denies expired -> deny TENANT_EXPIRED_DENY, in every zone`, r.every((v) => v.startsWith("deny|") && v.includes("TENANT_EXPIRED_DENY")), r.join(","));
}

// The six Codex P1s of 2026-11-07: each answered LOOSER than the pre-strict reader on a UTC host. The expected
// answer is that reader's, in every zone.
for (const [which, expect, label] of [
  ["a", "step_up|DOCK_EVIDENCE_UNREADABLE", "an out-of-domain offset-less charge reading keeps the unreadable floor beside an older 'low'"],
  ["b", "deny|TENANT_DENY+TENANT_ALLOW", "nine families x 2 above the world cap: a rule needing suspected AND removed still denies"],
  ["c", "deny|TENANT_DENY+TENANT_ALLOW", "an offset-less legacy enrollment (a shipped-good value) still reaches a tenant policy that denies it"],
  ["d", "restrict|POSTURE_MISSING", "an offset-less future 'fresh' posture keeps its unknown-age floor beside an orderable 'fresh'"],
  ["e-charge", "step_up|DOCK_EVIDENCE_UNREADABLE", "a date-only 'low' cannot outrank a malformed current charge value"],
  ["e-battery", "step_up|DOCK_EVIDENCE_UNREADABLE", "a date-only 'degraded' cannot outrank a malformed current battery value"],
  ["f", "deny|TENANT_DENY+TENANT_ALLOW", "six families at one instant: a rule needing degraded AND suspected still denies"],
] as const) {
  const r = ZONES.map((z) => inZone(z, "codex", which));
  check(`never milder than the pre-strict reader (Codex ${which}): ${label} -> ${expect}, in every zone`, r.every((v) => v === expect), r.join(","));
}

// Round 5 (2026-11-07), the four Codex P1s on #1792 b2a6f876 and #1809 888888ae: each answered LOOSER than the
// pre-strict reader. g/h: RFC 2822 text the strict reader rejects lost its unknown age; i/j: a validated tenant
// rule on criticalSignalsPresent=true never matched because every alternate world's backstop was pinned false.
for (const [which, expectPrefix, expectCode, label] of [
  ["g", "restrict|", "POSTURE_MISSING", "an RFC 2822 future 'fresh' posture (Tue, 14 Jul 2026 13:00:00 GMT) keeps its unknown age beside an orderable 'fresh'"],
  ["h", "restrict|", "POSTURE_MISSING", "an RFC 2822 future 'fresh' posture (Mon, 13 Jul 2026 14:00:00 GMT) keeps its unknown age beside an orderable 'fresh'"],
  ["i", "deny|", "TENANT_DENY", "a tenant rule on tamperState=confirmed AND criticalSignalsPresent=true still sees the complete-evidence reading"],
  ["j", "deny|", "TENANT_DENY", "a tenant rule on criticalSignalsPresent=true still sees the complete-evidence reading"],
] as const) {
  const r = ZONES.map((z) => inZone(z, "codex", which));
  check(`never milder than the pre-strict reader (Codex round 5 ${which}): ${label} -> ${expectPrefix.slice(0, -1)} ${expectCode}, in every zone`, r.every((v) => v.startsWith(expectPrefix) && v.split("|")[1]!.split("+").includes(expectCode)), r.join(","));
}

// THE CLASS, held: never MILDER than the pre-strict reader on the evaluating host, for any input the generator
// makes, under five zones (the verdict must also be the SAME in every zone: the pre-strict answer is folded in for
// every modelled host, not just this one). An assertion that fails: on #1792 b2a6f876 this printed milder>0.
{
  const CLASS_ZONES = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"];
  const runs = CLASS_ZONES.map((z) => [z, inZone(z, "class", "20261107", "2000")] as const);
  console.log(runs.map(([z, v]) => `${z}: ${v}`).join("\n"));
  check("the class: no verdict is milder than the pre-strict reader's on the evaluating host, in five zones (2000 seeded trials each, validated tenant policies)",
    runs.every(([, v]) => v.startsWith("milder=0 ")), runs.map(([z, v]) => `${z}=${v}`).join(" "));
  check("the class: the verdicts are identical in every zone (one fingerprint)",
    new Set(runs.map(([, v]) => /fingerprint=(\w+)/.exec(v)?.[1] ?? v)).size === 1, runs.map(([z, v]) => `${z}=${v}`).join(" "));
  const classified = [...CLASS_ZONES, "Australia/Lord_Howe", "America/St_Johns", "Asia/Kathmandu", "Europe/London", "Etc/GMT+12"].map((z) => [z, inZone(z, "classify")] as const);
  check("pre-strict stamps: every stamp Date.parse accepts is classified the same in ten zones, and none disagrees with that zone's Date.parse",
    classified.every(([, v]) => / disagree=0 /.test(v)) && new Set(classified.map(([, v]) => v)).size === 1, classified.map(([z, v]) => `${z}=${v}`).join(" "));
}

// Round 6 (2026-11-08), Codex P1 on #1809 (thread 4504013403): a daylight-saving switch between two floating stamps
// of one decision. Mainline denies under America/New_York (its offset steps from -05:00 to -04:00 between 01:30 and
// 03:30); the answer is that deny in every zone, because every host's stepped reading is folded in.
{
  const DST_ZONES = ["America/New_York", "UTC", "Asia/Tokyo", "Australia/Lord_Howe", "Europe/London"];
  const r = DST_ZONES.map((z) => inZone(z, "codex", "k"));
  check("never milder than the pre-strict reader (Codex round 6 k): a DST switch between the floating charge (01:30) and battery (03:30) stamps -> deny TENANT_DENY, in every zone",
    r.every((v) => v.startsWith("deny|") && v.split("|")[1]!.split("+").includes("TENANT_DENY")), DST_ZONES.map((z, i) => `${z}=${r[i]}`).join(" "));
  // THE CLASS across real switches: the evaluating host steps its offset between stamps.
  const runs = DST_ZONES.map((z) => [z, inZone(z, "dstclass", "20261108", "600")] as const);
  console.log(runs.map(([z, v]) => `${z}: ${v}`).join("\n"));
  check("the class across a daylight-saving switch: no verdict is milder than the pre-strict reader's on the evaluating host (US, EU and Lord Howe 2026 switches, five zones, 600 seeded trials each)",
    runs.every(([, v]) => v.startsWith("milder=0 ")), runs.map(([z, v]) => `${z}=${v}`).join(" "));
  check("the class across a daylight-saving switch: the verdicts are identical in every zone (one fingerprint)",
    new Set(runs.map(([, v]) => /fingerprint=(\w+)/.exec(v)?.[1] ?? v)).size === 1, runs.map(([z, v]) => `${z}=${v}`).join(" "));
  const facts = inZone("UTC", "zonefacts");
  console.log(`zone data: ${facts}`);
  check("the offset model is every host: from 1979-10-03 every zone the runtime ships sits on the quarter-hour grid in [-12:00, +14:00], steps at most 3h after 2012-01-08, and never has two transitions within 156 hours",
    / problems=0$/.test(facts), facts);
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
