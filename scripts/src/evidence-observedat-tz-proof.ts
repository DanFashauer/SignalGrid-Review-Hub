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
  PRE_STRICT_HOST_OFFSETS_MINUTES,
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
} from "@workspace/signalgrid-core";

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
  const r = evaluatePolicy(pv(rules), buildEvidence(identity, device, workflow, signals, now));
  return `${r.outcome}|${r.reasonCodes.join("+")}`;
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

console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
