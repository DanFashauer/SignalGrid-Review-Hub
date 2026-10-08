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
  evaluatePolicy,
  SHARED_DEVICE_RULES_V1,
  type Device,
  type Identity,
  type NormalizedSignal,
  type SignalCategory,
  type Workflow,
} from "@workspace/signalgrid-core";

const SELF = fileURLToPath(import.meta.url);

function verdictFor(compliantObservedAt: string): string {
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
  const sig = (id: string, category: SignalCategory, value: NormalizedSignal["value"], observedAt: string): NormalizedSignal => ({
    id, tenantId: "tenant_northwind", connectorId: "conn", subjectType: "device", subjectId: device.id,
    category, value, observedAt, freshness: "fresh", sourceReference: "fixture:tz",
  });
  const base = "2026-07-13T13:00:00.000Z";
  const signals = [
    sig("s_nc", "device_compliance", "non_compliant", "2026-07-13T07:30:00Z"),
    sig("s_c", "device_compliance", "compliant", compliantObservedAt),
    sig("s_m", "device_management", true, base),
    sig("s_e", "device_encryption", true, base),
    sig("s_o", "os_support", true, base),
    sig("s_p", "posture_freshness", "fresh", base),
  ];
  const ev = buildEvidence(identity, device, workflow, signals);
  const pv = {
    id: "pv_tz", tenantId: "tenant_northwind", policyId: "pol_tz", version: 1,
    status: "active" as const, rules: SHARED_DEVICE_RULES_V1,
    createdAt: base, digest: "test",
  };
  return `${evaluatePolicy(pv, ev).outcome}|${ev.deviceCompliance}`;
}

if (process.argv[2] === "--worker") {
  const fixture = process.argv[3]!;
  console.log(`VERDICT ${verdictFor(fixture)}`);
  process.exit(0);
}

function inZone(tz: string, fixture: string): string {
  const r = spawnSync(process.execPath, ["--import", "tsx", SELF, "--worker", fixture], {
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

const offsetless = ZONES.map((z) => [z, inZone(z, OFFSETLESS)] as const);
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
const explicit = ZONES.map((z) => inZone(z, "2026-07-13T08:00:00Z"));
check(
  "explicit-Z observedAt: later compliant reading still wins by instant, identically in every zone",
  new Set(explicit).size === 1 && explicit[0]!.endsWith("|compliant"),
  explicit.join(","),
);
const explicitOff = ZONES.map((z) => inZone(z, "2026-07-13T10:00:00+02:00"));
check(
  "explicit +02:00 observedAt: ordered by instant, identically in every zone",
  new Set(explicitOff).size === 1 && explicitOff[0]!.endsWith("|compliant"),
  explicitOff.join(","),
);

console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
