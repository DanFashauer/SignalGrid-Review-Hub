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
  evaluatePolicy,
  fixedClock,
  runDockSync,
  seedDemoStore,
  SHARED_DEVICE_RULES_V1,
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

if (process.argv[2] === "--worker") {
  const [mode, a, b, c] = process.argv.slice(3);
  const out =
    mode === "verdict" ? verdictFor(a!, b)
    : mode === "accuse" ? accusationFor(a as "tamper_state" | "badge_binding", b!, c!, process.argv[7]!)
    : mode === "freshness" ? freshnessFor(a!)
    : mode === "dock" ? dockFreshnessFor(a!)
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

// Date-only is UTC by spec. 2026-07-13 = 00:00Z is LATER than a 2026-07-12T23:00Z accusation; read as host-local
// midnight, Asia/Tokyo gives 2026-07-12T15:00Z, which is EARLIER, and the verdict flips.
const dateOnly = ZONES.map((z) => inZone(z, "verdict", "2026-07-13", "2026-07-12T23:00:00Z"));
check(
  "date-only observedAt: parsed as UTC midnight (later than 23:00Z the day before), identically in every zone",
  new Set(dateOnly).size === 1 && dateOnly[0]!.endsWith("|compliant"),
  dateOnly.join(","),
);

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

console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
