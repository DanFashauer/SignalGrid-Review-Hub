// UEM dimension proof — OFFLINE and deterministic.
//
// This dimension existed for a long time with NO proof at all, which is how it kept
// a hardcoded `compliant: true`, an ungated device-lock actuator, and a `Date.now()`
// in a decision path. The gate below is the thing that was missing.
//
// Three things are asserted, in order of how much they matter:
//   1. THE LIVE-CALL GATE refuses unless every condition holds, and names which one
//      failed. Fail-closed and unanimous.
//   2. NO UNJUSTIFIED GRANTS across the entire normalized state space. Exhaustive,
//      because a spot-check cannot see a field nobody thought to test — which is
//      precisely how `deviceRegistrationState` went unread in the Graph adapter.
//   3. WRITE ACTUATORS STAY GONE. A source-level assertion, because this is a
//      boundary the type system cannot express and a future edit could quietly
//      reintroduce.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateUem,
  normalizeJamfDevice,
  normalizeIntuneDevice,
  normalizeWorkspaceOneDevice,
  normalizeUemDevice,
  resolveUemConnector,
  UEM_FIXTURES,
} from "@workspace/integrations/uem";
import type {
  NormalizedUemDeviceState,
  UemCompliance,
  UemEnrollment,
  UemOwnership,
  UemSupervision,
  UemVendor,
} from "@workspace/integrations/uem";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("UEM dimension proof — read-only, gated, deterministic\n");

// ── 1. The live-call gate ────────────────────────────────────────────────────
const noTransport = undefined;
check("default env (dev tier) refuses live",
  resolveUemConnector({}, noTransport).mode === "fixture");
check("beta tier alone refuses live",
  resolveUemConnector({ SIGNALGRID_TIER: "beta" }, noTransport).mode === "fixture");
check("beta + LIVE_INTEGRATIONS but no vendor refuses live",
  resolveUemConnector({ SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true" }, noTransport).mode === "fixture");
check("beta + LIVE + vendor but no token refuses live",
  resolveUemConnector({ SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "jamf" }, noTransport).mode === "fixture");
check("an unrecognised vendor refuses live",
  resolveUemConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "totally-made-up", UEM_ACCESS_TOKEN: "t" }, noTransport).mode === "fixture");
check("EVERY gate satisfied but no transport still refuses — this repo ships none",
  resolveUemConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "jamf", UEM_ACCESS_TOKEN: "t" }, noTransport).mode === "fixture");
// Non-vacuity: the live branch must be REACHABLE, or every refusal above is trivial.
const liveTransport = { readDevice: async () => ({}) };
check("...and the live branch IS reachable when a transport is injected",
  resolveUemConnector(
    { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "jamf", UEM_ACCESS_TOKEN: "t" },
    liveTransport,
  ).mode === "live");

// EACH GATE ISOLATED — every other condition satisfied, including the transport, so
// the ONLY thing standing between this call and a live vendor read is the one gate
// under test. Added after a negative control exposed the gap: deleting the
// LIVE_INTEGRATIONS check left the suite almost entirely green, because no
// assertion had that flag as its sole cause of refusal. A control that barely fires
// is telling you the gate is barely tested.
check("ISOLATED: tier alone blocks live (everything else satisfied)",
  resolveUemConnector(
    { SIGNALGRID_TIER: "dev", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "jamf", UEM_ACCESS_TOKEN: "t" },
    liveTransport,
  ).mode === "fixture");
check("ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
  resolveUemConnector(
    { SIGNALGRID_TIER: "prod", UEM_VENDOR: "jamf", UEM_ACCESS_TOKEN: "t" },
    liveTransport,
  ).mode === "fixture");
check("ISOLATED: a missing credential alone blocks live",
  resolveUemConnector(
    { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "jamf" },
    liveTransport,
  ).mode === "fixture");
check("ISOLATED: an unrecognised vendor alone blocks live",
  resolveUemConnector(
    { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", UEM_VENDOR: "nope", UEM_ACCESS_TOKEN: "t" },
    liveTransport,
  ).mode === "fixture");
// Each refusal names its own cause rather than a generic message.
{
  const reasons = new Set([
    resolveUemConnector({}, noTransport),
    resolveUemConnector({ SIGNALGRID_TIER: "beta" }, noTransport),
    resolveUemConnector({ SIGNALGRID_TIER: "beta", SIGNALGRID_LIVE_INTEGRATIONS: "true" }, noTransport),
  ].map((r) => (r.mode === "fixture" ? r.reason : "live")));
  check("each refusal names a DISTINCT cause (tier / flag / vendor)", reasons.size === 3);
}

// ── 2. Exhaustive grant safety ───────────────────────────────────────────────
const VENDORS: UemVendor[] = ["intune", "jamf", "workspace-one", "unknown"];
const ENROLLMENTS: UemEnrollment[] = ["enrolled", "not_enrolled", "retired", "unknown"];
const COMPLIANCES: UemCompliance[] = ["compliant", "non_compliant", "in_grace_period", "not_evaluated", "unknown"];
const SUPERVISIONS: UemSupervision[] = ["supervised", "unsupervised", "unknown"];
const OWNERSHIPS: UemOwnership[] = ["corporate", "personal", "unknown"];
const INTEGRITIES = ["intact", "malformed"] as const;

let total = 0;
const unjustified: string[] = [];
let granting = 0;
for (const vendor of VENDORS)
  for (const enrollment of ENROLLMENTS)
    for (const compliance of COMPLIANCES)
      for (const supervision of SUPERVISIONS)
        for (const ownership of OWNERSHIPS)
          for (const reportIntegrity of INTEGRITIES) {
            total += 1;
            const state: NormalizedUemDeviceState = {
              deviceId: "d", vendor, enrollment, compliance, supervision, ownership,
              osVersion: null, lastCheckInAgeSeconds: null, reportIntegrity,
            };
            const v = evaluateUem(state);
            if (v.recommendedAction !== "none") continue;
            granting += 1;
            // The management story must be positively confirmed. Supervision clears
            // EITHER by being present, OR by being absent on a device that is
            // affirmatively employee-owned — where absence is the correct state and
            // no supervised alternative exists. `ownership: "unknown"` does NOT
            // clear it: that is the case we cannot read, so it cannot be a grant.
            const supervisionConfirmed =
              supervision === "supervised" ||
              (supervision === "unsupervised" && ownership === "personal");
            const confirmedClean =
              vendor !== "unknown" && enrollment === "enrolled" && compliance === "compliant" &&
              supervisionConfirmed && reportIntegrity === "intact";
            if (!confirmedClean) unjustified.push(`${vendor}/${enrollment}/${compliance}/${supervision}/${ownership}/${reportIntegrity}`);
          }

check(`state space enumerated (${total} states)`, total === 1440);
check(
  `ZERO unjustified grants across all ${total} states` +
    (unjustified.length ? ` — leaked: ${unjustified.slice(0, 5).join(", ")}` : ""),
  unjustified.length === 0,
);
// Non-vacuity: "no unjustified grants" passes trivially if nothing grants, so the
// grant path is pinned EXACTLY — not merely "> 0", which would let the set silently
// widen. Three vendors x four confirmed-clean shapes: supervised under each of the
// three ownership values (ownership is irrelevant once supervision is confirmed),
// plus unsupervised-and-personal, the BYOD case this change added. 3 x 4 = 12.
//
// This number is the tripwire. It was 3 before the ownership axis; if a later edit
// makes ownership foreclose the grant on its own it drops to 9, and if one makes
// `unknown` ownership behave like `personal` it rises to 15. Either way the figure
// moves and this assertion fails, which is the point of pinning it rather than
// asserting a floor.
check(`...and the grant path is REACHABLE — exactly 12 confirmed-clean states (got ${granting})`, granting === 12);

// The ceiling is real: this dimension never escalates.
{
  let escalated = 0;
  for (const enrollment of ENROLLMENTS)
    for (const compliance of COMPLIANCES)
      for (const supervision of SUPERVISIONS)
        for (const ownership of OWNERSHIPS) {
          const v = evaluateUem({
            deviceId: "d", vendor: "jamf", enrollment, compliance, supervision, ownership,
            osVersion: null, lastCheckInAgeSeconds: null, reportIntegrity: "intact",
          });
          if ((v.recommendedAction as string) === "escalate") escalated += 1;
        }
  check("never escalates — that ceiling belongs to dimensions that can see a compromise", escalated === 0);
}

// An UNKNOWN forecloses the grant but never DENIES.
//
// This must ISOLATE the unknown. An earlier version of this check swept unknown
// against every other value and counted any resulting `restrict` — which fired on
// `enrollment=unknown, compliance=non_compliant`, where the restrict is correctly
// driven by the affirmative non-compliance and the unknown is incidental. That
// asserted something the evaluator should not satisfy: a real bad fact alongside an
// unknown must still restrict. Each field is now varied alone against an otherwise
// fully-confirmed state, which is the actual claim.
{
  const clean: NormalizedUemDeviceState = {
    deviceId: "d", vendor: "jamf", enrollment: "enrolled", compliance: "compliant",
    supervision: "supervised", ownership: "corporate",
    osVersion: null, lastCheckInAgeSeconds: null, reportIntegrity: "intact",
  };
  const isolated = [
    evaluateUem({ ...clean, enrollment: "unknown" }),
    evaluateUem({ ...clean, compliance: "unknown" }),
    evaluateUem({ ...clean, supervision: "unknown" }),
    evaluateUem({ ...clean, vendor: "unknown" }),
    evaluateUem({ ...clean, reportIntegrity: "malformed" }),
  ];
  check("an isolated UNKNOWN yields step_up — forecloses the grant, does not deny",
    isolated.every((v) => v.recommendedAction === "step_up"));
  check("...and an unknown ALONGSIDE a real bad fact still restricts (the unknown does not soften it)",
    evaluateUem({ ...clean, enrollment: "unknown", compliance: "non_compliant" }).recommendedAction === "restrict");
}

// ── 2b. SUPERVISION IS READ THROUGH OWNERSHIP ────────────────────────────────
//
// The defect: `supervision === "unsupervised"` graded step_up unconditionally. Apple
// supervision requires organisational ownership, so an employee-owned device can
// never be supervised — the gate fired on every BYOD decision, forever, for a state
// with no remediation. These assertions are the three-way distinction that fixes it,
// plus the two boundaries a future edit is most likely to blur.
{
  const base: NormalizedUemDeviceState = {
    deviceId: "d", vendor: "intune", enrollment: "enrolled", compliance: "compliant",
    supervision: "unsupervised", ownership: "corporate",
    osVersion: null, lastCheckInAgeSeconds: null, reportIntegrity: "intact",
  };

  const corporate = evaluateUem(base);
  check("CORPORATE + unsupervised → step_up (a device the org could have supervised and did not)",
    corporate.recommendedAction === "step_up" && corporate.reasonCode === "DEVICE_UNSUPERVISED");

  // THE FIX. This is the assertion that would have failed before the ownership axis.
  const personal = evaluateUem({ ...base, ownership: "personal" });
  check("PERSONAL + unsupervised → GRANTS — the expected, permanent, unremediable BYOD state",
    personal.recommendedAction === "none" && personal.reasonCode === "UEM_MANAGED_COMPLIANT");

  const unknownOwner = evaluateUem({ ...base, ownership: "unknown" });
  check("UNKNOWN ownership + unsupervised → step_up, naming ownership as the unread input",
    unknownOwner.recommendedAction === "step_up" &&
    unknownOwner.reasonCode === "UNSUPERVISED_OWNERSHIP_UNKNOWN");
  check("...and it is INDETERMINATE, not degraded — we do not know the device is worse, only that we cannot clear it",
    unknownOwner.posture === "indeterminate");

  // BOUNDARY 1: `personal` excuses ONLY the supervision concern. It must not become a
  // general amnesty — the failure mode where "it's BYOD" silently waives real facts.
  check("personal ownership does NOT excuse affirmative non-compliance",
    evaluateUem({ ...base, ownership: "personal", compliance: "non_compliant" }).recommendedAction === "restrict");
  check("personal ownership does NOT excuse a device that is not enrolled",
    evaluateUem({ ...base, ownership: "personal", enrollment: "not_enrolled" }).recommendedAction === "restrict");
  check("personal ownership does NOT excuse an unreadable report",
    evaluateUem({ ...base, ownership: "personal", reportIntegrity: "malformed" }).reasonCode === "REPORT_MALFORMED");
  check("personal ownership does NOT excuse supervision being UNKNOWN (that is unconfirmed, not expected-absent)",
    evaluateUem({ ...base, ownership: "personal", supervision: "unknown" }).reasonCode === "SUPERVISION_STATE_UNKNOWN");

  // BOUNDARY 2: the documented judgement call in evaluate.ts — ownership does NOT
  // independently foreclose the grant, because it carries no decision weight once
  // supervision is confirmed. Pinned in BOTH directions so the decision is explicit
  // rather than an accident, and so reversing it requires editing an assertion.
  check("ownership unknown + supervision CONFIRMED still grants — ownership only interprets supervision",
    evaluateUem({ ...base, supervision: "supervised", ownership: "unknown" }).recommendedAction === "none");
  check("...and ownership unknown + supervision ABSENT does not, so the field is genuinely load-bearing",
    evaluateUem({ ...base, supervision: "unsupervised", ownership: "unknown" }).recommendedAction === "step_up");
}

// The vendors' real ownership fields, read rather than assumed.
check("Intune managedDeviceOwnerType 'company' → corporate",
  normalizeIntuneDevice({ id: "x", managedDeviceOwnerType: "company" }).ownership === "corporate");
check("...'personal' → personal",
  normalizeIntuneDevice({ id: "x", managedDeviceOwnerType: "personal" }).ownership === "personal");
check("...and an absent or unrecognised owner type → unknown, never personal",
  normalizeIntuneDevice({ id: "x" }).ownership === "unknown" &&
  normalizeIntuneDevice({ id: "x", managedDeviceOwnerType: "someNewMember" }).ownership === "unknown");
check("Workspace ONE Ownership 'C' and 'S' both → corporate (dedicated and SHARED)",
  normalizeWorkspaceOneDevice({ Uuid: "a", Ownership: "C" }).ownership === "corporate" &&
  normalizeWorkspaceOneDevice({ Uuid: "a", Ownership: "S" }).ownership === "corporate");
check("...'E' → personal, 'U' → unknown",
  normalizeWorkspaceOneDevice({ Uuid: "a", Ownership: "E" }).ownership === "personal" &&
  normalizeWorkspaceOneDevice({ Uuid: "a", Ownership: "U" }).ownership === "unknown");
check("Jamf reports NO ownership field, so it is unknown — not guessed as corporate",
  normalizeJamfDevice({ computer: { general: { id: 1, remote_management: { managed: true }, supervised: false } } }).ownership === "unknown");

// The fixture pair that demonstrates the fix end-to-end.
check("fixture 'intune-byod-personal' GRANTS — the BYOD case that used to step up forever",
  evaluateUem(UEM_FIXTURES["intune-byod-personal"]!).recommendedAction === "none");
check("fixture 'intune-unsupervised-owner-unknown' steps up — identical but for the unread owner",
  evaluateUem(UEM_FIXTURES["intune-unsupervised-owner-unknown"]!).reasonCode === "UNSUPERVISED_OWNERSHIP_UNKNOWN");

// ── 3. The fail-opens that actually shipped ──────────────────────────────────
check("Jamf's 'no compliance evaluated' is NOT reported as compliant",
  normalizeJamfDevice({ computer: { general: { id: 7, remote_management: { managed: true }, supervised: true } } }).compliance === "not_evaluated");
check("...and it grades as step_up, not none",
  evaluateUem(normalizeJamfDevice({ computer: { general: { id: 7, remote_management: { managed: true }, supervised: true } } })).recommendedAction === "step_up");
check("an Intune device being retired is not reported as enrolled",
  normalizeIntuneDevice({ id: "x", managementState: "retirePending" }).enrollment === "retired");
check("an unrecognised Intune complianceState falls to unknown, never a pass",
  normalizeIntuneDevice({ id: "x", complianceState: "someNewEnumMember" }).compliance === "unknown");
check("a Workspace ONE payload keyed on the OLD wrong field is malformed, not healthy",
  normalizeWorkspaceOneDevice({ DeviceUUID: "abc" } as never).reportIntegrity === "malformed");
check("...and the corrected canonical field parses",
  normalizeWorkspaceOneDevice({ Uuid: "abc", EnrollmentStatus: "Enrolled", ComplianceStatus: "Compliant", IsSupervised: true }).enrollment === "enrolled");
check("an unattributable payload is malformed, never guessed",
  normalizeUemDevice("unknown" as UemVendor, { id: "x" }).reportIntegrity === "malformed");
check("a non-boolean 'supervised' is unknown, not false",
  normalizeJamfDevice({ computer: { general: { id: 1, remote_management: { managed: true }, supervised: "true" } } }).supervision === "unknown");

// Determinism: same input, same verdict, no clock anywhere in the path.
check("evaluation is deterministic",
  JSON.stringify(evaluateUem(UEM_FIXTURES["intune-healthy"]!)) === JSON.stringify(evaluateUem(UEM_FIXTURES["intune-healthy"]!)));
check("no fixture carries a wall-clock timestamp — ages are durations supplied by the caller",
  Object.values(UEM_FIXTURES).every((f) => f.lastCheckInAgeSeconds === null || Number.isInteger(f.lastCheckInAgeSeconds)));

// ── 4. The write actuators stay gone ─────────────────────────────────────────
// A boundary the type system cannot express: nothing stops a future edit from
// pasting a fetch() back in. This asserts it at the source level instead.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const uemDir = resolve(here, "../../lib/integrations/src/integrations/uem");
  const files = readdirSync(uemDir).filter((f) => f.endsWith(".ts"));
  const offenders: string[] = [];

  // BAN NETWORK I/O, NOT VOCABULARY.
  //
  // The first version of this scan also banned the verbs themselves — LockDevice,
  // remoteLock, wipe, EraseDevice — and immediately flagged three false positives:
  // `startsWith("wipe")` in the Intune enrollment mapping, and the
  // `enterprisewipepending` / `devicewipepending` cases in Workspace ONE. Those are
  // vendor enum values this connector must READ in order to grade a device as
  // retiring. Banning the words would have forced the normalizers to obfuscate the
  // very states they exist to recognise.
  //
  // Narrowing to network primitives is a tightening, not a weakening: a write
  // actuator needs I/O to act. A verb with no request attached is an inert string,
  // and a request is exactly what this catches.
  const banned =
    /\b(fetch|XMLHttpRequest)\s*\(|\b(?:axios|got|undici)\b|https?\.request\s*\(|method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i;

  for (const f of files) {
    readFileSync(join(uemDir, f), "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (banned.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  check(`no network I/O in any uem/ source — a write actuator cannot return (${files.length} files scanned)`,
    offenders.length === 0);
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
