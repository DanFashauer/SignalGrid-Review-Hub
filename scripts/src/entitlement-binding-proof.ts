// Entitlement-binding proof — OFFLINE and deterministic.
//
// Asserted, in order of how much each matters:
//   1. THE LIVE-CALL GATE refuses unless every condition holds, each gate ISOLATED
//      so a control on any one of them fires. (The uem proof learned this the hard
//      way: a control that barely fires means the gate is barely tested.)
//   2. NO UNJUSTIFIED CLEAN VERDICTS across the entire normalized state space, with
//      the clean set pinned to an exact count rather than a floor.
//   3. THE BOUNDARIES that make this dimension distinct — it must not double-count a
//      direct binding, must not grade hygiene as governance, and must not exceed its
//      own ceiling.
//   4. NO NETWORK I/O in the family.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateEntitlementBinding,
  evaluateEntitlementBindingFixture,
  normalizeGraphBinding,
  resolveEntitlementBindingConnector,
  ENTITLEMENT_BINDING_FIXTURES,
  ENTITLEMENT_BINDING_READ_CONTRACT,
} from "@workspace/integrations/entitlement-binding";
import type {
  BindingMechanism,
  CarrierOwnerState,
  CarrierType,
  NormalizedEntitlementBinding,
} from "@workspace/integrations/entitlement-binding";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Entitlement-binding proof — is the grant REVIEWABLE, gated, deterministic\n");

// ── 1. The live-call gate, each condition ISOLATED ───────────────────────────
const T = { readBinding: async () => ({}) };
const FULL = {
  SIGNALGRID_TIER: "prod",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  ENTITLEMENT_DIRECTORY: "entra",
  ENTITLEMENT_ACCESS_TOKEN: "t",
};
check("default env (dev tier) refuses live",
  resolveEntitlementBindingConnector({}, T).mode === "fixture");
check("ISOLATED: tier alone blocks live",
  resolveEntitlementBindingConnector({ ...FULL, SIGNALGRID_TIER: "dev" }, T).mode === "fixture");
check("ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
  resolveEntitlementBindingConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T).mode === "fixture");
check("ISOLATED: an unrecognised directory alone blocks live",
  resolveEntitlementBindingConnector({ ...FULL, ENTITLEMENT_DIRECTORY: "nope" }, T).mode === "fixture");
check("ISOLATED: a missing credential alone blocks live",
  resolveEntitlementBindingConnector({ ...FULL, ENTITLEMENT_ACCESS_TOKEN: "" }, T).mode === "fixture");
check("no transport refuses even with every gate satisfied — this repo ships none",
  resolveEntitlementBindingConnector(FULL).mode === "fixture");
// Non-vacuity: the live branch must be reachable or every refusal above is trivial.
check("...and the live branch IS reachable when a transport is injected",
  resolveEntitlementBindingConnector(FULL, T).mode === "live");
{
  const reasons = new Set(
    [
      resolveEntitlementBindingConnector({}, T),
      resolveEntitlementBindingConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T),
      resolveEntitlementBindingConnector({ ...FULL, ENTITLEMENT_DIRECTORY: "nope" }, T),
      resolveEntitlementBindingConnector({ ...FULL, ENTITLEMENT_ACCESS_TOKEN: "" }, T),
    ].map((r) => (r.mode === "fixture" ? r.reason : "live")),
  );
  check("each refusal names a DISTINCT cause (tier / flag / directory / credential)", reasons.size === 4);
}

// ── 2. Exhaustive: no unjustified clean verdicts ──────────────────────────────
const MECHANISMS: BindingMechanism[] = ["group", "direct_to_principal", "unknown"];
const CARRIERS: CarrierType[] = [
  "security_group", "mail_enabled_security_group", "distribution_group", "not_applicable", "unknown",
];
const OWNERS: CarrierOwnerState[] = ["owner_assigned", "ownerless", "not_applicable", "unknown"];
// 3 is here ON PURPOSE: it equals the budget below, so the <= / < boundary lands
// INSIDE the exhaustive sweep instead of resting on a single hand-written assertion.
// A negative control that flipped `>` to `>=` originally failed exactly one check —
// which is the "a control that barely fires means the gate is barely tested" signal
// the uem proof was rebuilt around. With 3 in the set the pinned clean count moves
// too, so the sweep catches the off-by-one as well.
const DEPTHS: (number | null)[] = [null, 0, 1, 3, 5];
const BUDGETS: (number | null)[] = [null, 3];
const INTEGRITIES = ["intact", "malformed"] as const;

let total = 0;
let clean = 0;
const unjustified: string[] = [];
for (const mechanism of MECHANISMS)
  for (const carrier of CARRIERS)
    for (const carrierOwner of OWNERS)
      for (const nestingDepth of DEPTHS)
        for (const nestingDepthBudget of BUDGETS)
          for (const reportIntegrity of INTEGRITIES) {
            total += 1;
            const b: NormalizedEntitlementBinding = {
              principalId: "p", mechanism, carrier, carrierOwner,
              nestingDepth, nestingDepthBudget, reportIntegrity,
            };
            const v = evaluateEntitlementBinding(b);
            if (v.recommendedAction !== "none") continue;
            clean += 1;
            // A clean verdict requires the grant to be positively reviewable: carried
            // by a security principal, owned, and either within the operator's depth
            // budget or not measured against one.
            const carrierIsSecurityPrincipal =
              carrier === "security_group" || carrier === "mail_enabled_security_group";
            const depthOk =
              nestingDepthBudget === null || nestingDepth === null ||
              nestingDepth <= nestingDepthBudget;
            const justified =
              reportIntegrity === "intact" && mechanism === "group" &&
              carrierIsSecurityPrincipal && carrierOwner === "owner_assigned" && depthOk;
            // `carrierOwner === "owner_assigned"` already excludes `not_applicable`,
            // which is the leak the first version of this predicate let through: the
            // evaluator treated an inapplicable owner as no-concern even when a group
            // was named as the carrier. See the coherence assertions below.
            if (!justified) {
              unjustified.push(`${mechanism}/${carrier}/${carrierOwner}/${nestingDepth}/${nestingDepthBudget}/${reportIntegrity}`);
            }
          }

check(`state space enumerated (${total} states)`, total === 1200);
check(
  `ZERO unjustified clean verdicts across all ${total} states` +
    (unjustified.length ? ` — leaked: ${unjustified.slice(0, 5).join(", ")}` : ""),
  unjustified.length === 0,
);
// Non-vacuity, pinned EXACTLY. "Nothing leaked" passes trivially if nothing is ever
// clean. 2 security-principal carriers x owner_assigned x 9 depth/budget pairs that
// clear (all 5 depths against budget=null, plus null/0/1/3 against budget=3) = 18.
check(`...and the clean path is REACHABLE — exactly 18 reviewable states (got ${clean})`, clean === 18);

// ── 3. The boundaries that make this dimension distinct ──────────────────────
{
  const governable: NormalizedEntitlementBinding = {
    principalId: "p", mechanism: "group", carrier: "security_group",
    carrierOwner: "owner_assigned", nestingDepth: 1, nestingDepthBudget: 3,
    reportIntegrity: "intact",
  };

  check("a governable grant is clean and says so",
    evaluateEntitlementBinding(governable).recommendedAction === "none" &&
    evaluateEntitlementBinding(governable).posture === "governable");

  // THE CORE CLAIM. This is the state access-governance would call fine.
  const direct = evaluateEntitlementBinding({
    ...governable, mechanism: "direct_to_principal",
    carrier: "not_applicable", carrierOwner: "not_applicable", nestingDepth: null,
  });
  check("a permission pinned DIRECTLY to the principal steps up and names itself",
    direct.recommendedAction === "step_up" &&
    direct.reasonCode === "PERMISSION_BOUND_DIRECT_TO_PRINCIPAL" &&
    direct.posture === "unreviewable");
  // NO DOUBLE-COUNTING: a direct binding has no carrier, and `not_applicable` must
  // not read as a second, separate finding — that would make the reason code depend
  // on evaluation order.
  check("...and `not_applicable` carrier/owner contribute NOTHING of their own",
    direct.reasonCode === "PERMISSION_BOUND_DIRECT_TO_PRINCIPAL");

  const dist = evaluateEntitlementBinding({ ...governable, carrier: "distribution_group" });
  check("a distribution group carrying authorization steps up",
    dist.recommendedAction === "step_up" && dist.reasonCode === "CARRIER_NOT_A_SECURITY_GROUP");

  // HYGIENE IS NOT GOVERNANCE. A mail-enabled security group IS a security principal
  // and IS enumerated by security-group reviews. Grading it would be enforcing
  // naming standards through a runtime gate.
  check("a MAIL-ENABLED security group is governable — hygiene is not this gate's question",
    evaluateEntitlementBinding({ ...governable, carrier: "mail_enabled_security_group" })
      .recommendedAction === "none");

  const ownerless = evaluateEntitlementBinding({ ...governable, carrierOwner: "ownerless" });
  check("an ownerless carrier steps up — a campaign can 'certify' what nobody is accountable for",
    ownerless.reasonCode === "CARRIER_HAS_NO_OWNER" && ownerless.posture === "unattestable");

  // Depth: MONITOR, not step_up. Depth does not make a grant wrong.
  const deep = evaluateEntitlementBinding({ ...governable, nestingDepth: 5 });
  check("depth over budget yields MONITOR, not step_up — reduced traceability is not a bad grant",
    deep.recommendedAction === "monitor" && deep.reasonCode === "NESTING_DEPTH_OVER_BUDGET" &&
    deep.posture === "obscured");
  check("...and depth at the budget boundary is clean (<= not <)",
    evaluateEntitlementBinding({ ...governable, nestingDepth: 3 }).recommendedAction === "none");
  // NO INVENTED THRESHOLD. With no operator budget, depth is not graded at all —
  // the alternative is applying a number nobody chose to every tenant.
  check("with NO budget, even depth 5 is ungraded — no threshold is invented here",
    evaluateEntitlementBinding({ ...governable, nestingDepth: 5, nestingDepthBudget: null })
      .recommendedAction === "none");

  // Worst-concern-wins, and ORDER-PROOF: a monitor must never mask a step_up.
  check("a step_up alongside a monitor wins — the calmer concern does not dilute it",
    evaluateEntitlementBinding({ ...governable, carrierOwner: "ownerless", nestingDepth: 5 })
      .recommendedAction === "step_up");

  // Unknowns foreclose, each naming its own field.
  check("an isolated UNKNOWN forecloses and is INDETERMINATE, not an affirmative failure",
    (["mechanism", "carrier", "carrierOwner"] as const).every((f) => {
      const v = evaluateEntitlementBinding({ ...governable, [f]: "unknown" });
      return v.recommendedAction === "step_up" && v.posture === "indeterminate";
    }));
  check("...and each unknown names a DISTINCT field",
    new Set((["mechanism", "carrier", "carrierOwner"] as const).map(
      (f) => evaluateEntitlementBinding({ ...governable, [f]: "unknown" }).reasonCode)).size === 3);
  check("a malformed report short-circuits to its own code, not a list of unknowns",
    evaluateEntitlementBinding({ ...governable, reportIntegrity: "malformed" }).reasonCode ===
      "BINDING_REPORT_MALFORMED");

  // COHERENCE. Found by the sweep above, not by reading the code: `not_applicable`
  // contributes no concern of its own, so a report claiming a GROUP carries the
  // permission while the carrier owner is `not_applicable` cleared the gate as
  // GOVERNABLE. Every Entra/AD group has an owner attribute — empty means
  // `ownerless` — so no group's ownership is inapplicable, and a report saying
  // otherwise contradicts itself. Asserted in BOTH directions.
  check("a GROUP binding with an inapplicable carrier owner is INCOHERENT, not governable",
    evaluateEntitlementBinding({ ...governable, carrierOwner: "not_applicable" }).reasonCode ===
      "BINDING_REPORT_INCOHERENT");
  check("...and a GROUP binding with an inapplicable carrier is too",
    evaluateEntitlementBinding({ ...governable, carrier: "not_applicable" }).reasonCode ===
      "BINDING_REPORT_INCOHERENT");
  check("a DIRECT binding that also names a real carrier is INCOHERENT — two different grants",
    evaluateEntitlementBinding({
      ...governable, mechanism: "direct_to_principal", carrier: "security_group",
      carrierOwner: "not_applicable",
    }).reasonCode === "BINDING_REPORT_INCOHERENT");
  check("...and a DIRECT binding naming a real carrier OWNER is too",
    evaluateEntitlementBinding({
      ...governable, mechanism: "direct_to_principal", carrier: "not_applicable",
      carrierOwner: "owner_assigned",
    }).reasonCode === "BINDING_REPORT_INCOHERENT");
  // Coherence must NOT fire when the mechanism is unknown — there is nothing to be
  // consistent with, and reporting a contradiction would give the wrong reason for a
  // step_up that is already correct on its own.
  check("an UNKNOWN mechanism is not judged for coherence — the unknown is the finding",
    evaluateEntitlementBinding({ ...governable, mechanism: "unknown", carrier: "not_applicable" })
      .reasonCode === "BINDING_MECHANISM_UNKNOWN");
  // Integrity still outranks coherence: an unparseable report is not a contradictory one.
  check("malformed OUTRANKS incoherent — an unparseable report is a different failure",
    evaluateEntitlementBinding({
      ...governable, reportIntegrity: "malformed", carrierOwner: "not_applicable",
    }).reasonCode === "BINDING_REPORT_MALFORMED");

  // THE CEILING is real. Governability is a review failure, never evidence of
  // compromise, so this dimension must never reach for the top of the ladder.
  let overCeiling = 0;
  for (const mechanism of MECHANISMS)
    for (const carrier of CARRIERS)
      for (const carrierOwner of OWNERS)
        for (const reportIntegrity of INTEGRITIES) {
          const a = evaluateEntitlementBinding({
            principalId: "p", mechanism, carrier, carrierOwner,
            nestingDepth: 5, nestingDepthBudget: 3, reportIntegrity,
          }).recommendedAction as string;
          if (a === "alert" || a === "restrict" || a === "escalate") overCeiling += 1;
        }
  check("never alerts, restricts or escalates — an unreviewable grant is not an incident",
    overCeiling === 0);

  check("the verdict echoes its subject, so a downstream driver cannot lose it",
    evaluateEntitlementBinding({ ...governable, principalId: "who" }).principalId === "who");
  check("evaluation is deterministic",
    JSON.stringify(evaluateEntitlementBinding(governable)) ===
    JSON.stringify(evaluateEntitlementBinding(governable)));
}

// ── 4. The Graph normalizer, on real fields ──────────────────────────────────
check("principalType 'Group' → a group binding",
  normalizeGraphBinding({ principalId: "p", principalType: "Group" }).mechanism === "group");
check("principalType 'User' and 'ServicePrincipal' → direct_to_principal",
  normalizeGraphBinding({ principalId: "p", principalType: "User" }).mechanism === "direct_to_principal" &&
  normalizeGraphBinding({ principalId: "p", principalType: "ServicePrincipal" }).mechanism === "direct_to_principal");
check("an unrecognised principalType → unknown, never assumed to be a group",
  normalizeGraphBinding({ principalId: "p", principalType: "SomethingNew" }).mechanism === "unknown" &&
  normalizeGraphBinding({ principalId: "p" }).mechanism === "unknown");
check("a direct binding reports not_applicable carrier/owner, NOT unknown",
  normalizeGraphBinding({ principalId: "p", principalType: "User" }).carrier === "not_applicable" &&
  normalizeGraphBinding({ principalId: "p", principalType: "User" }).carrierOwner === "not_applicable");
// Graph's securityEnabled/mailEnabled pair is the real discriminator.
const carrierOf = (securityEnabled: unknown, mailEnabled: unknown) =>
  normalizeGraphBinding({
    principalId: "p", principalType: "Group",
    group: { securityEnabled, mailEnabled, ownerCount: 1 },
  }).carrier;
check("securityEnabled+!mailEnabled → security_group", carrierOf(true, false) === "security_group");
check("securityEnabled+mailEnabled → mail_enabled_security_group",
  carrierOf(true, true) === "mail_enabled_security_group");
// A distribution group is only callable as such once Graph has positively said the
// group is NOT Unified — the securityEnabled/mailEnabled pair alone cannot tell a DL
// from a Microsoft 365 group, and the previous version asserted it could.
check("!securityEnabled+mailEnabled + groupTypes WITHOUT Unified → distribution_group",
  normalizeGraphBinding({ principalId: "p", principalType: "Group",
    group: { securityEnabled: false, mailEnabled: true, ownerCount: 1, groupTypes: [] } }).carrier === "distribution_group");
check("...but the SAME flags with groupTypes ['Unified'] are an M365 group, NOT a DL",
  normalizeGraphBinding({ principalId: "p", principalType: "Group",
    group: { securityEnabled: false, mailEnabled: true, ownerCount: 1, groupTypes: ["Unified"] } }).carrier !== "distribution_group");
check("...and with groupTypes ABSENT the pair is ambiguous, so unknown — never the confident wrong answer",
  carrierOf(false, true) === "unknown");
check("both false (an M365 group shape) → unknown, not silently graded",
  carrierOf(false, false) === "unknown");
check("a NON-BOOLEAN flag is unknown, not coerced — 'false' the string is not false",
  carrierOf("true", "false") === "unknown" && carrierOf(1, 0) === "unknown");
check("ownerCount 0 → ownerless, >0 → owner_assigned, absent → unknown",
  normalizeGraphBinding({ principalId: "p", principalType: "Group", group: { securityEnabled: true, mailEnabled: false, ownerCount: 0 } }).carrierOwner === "ownerless" &&
  normalizeGraphBinding({ principalId: "p", principalType: "Group", group: { securityEnabled: true, mailEnabled: false, ownerCount: 2 } }).carrierOwner === "owner_assigned" &&
  normalizeGraphBinding({ principalId: "p", principalType: "Group", group: { securityEnabled: true, mailEnabled: false } }).carrierOwner === "unknown");
// A broken count must not compare as shallow.
// ASSERTED-BUT-UNREADABLE is distinct from NOT-REPORTED, and conflating them let a
// broken report grade cleaner than an honest over-budget one.
check("a negative or fractional depth is 'malformed', NOT null and NOT a small number",
  normalizeGraphBinding({ principalId: "p", principalType: "Group", nestingDepth: -1 }).nestingDepth === "malformed" &&
  normalizeGraphBinding({ principalId: "p", principalType: "Group", nestingDepth: 1.5 }).nestingDepth === "malformed" &&
  normalizeGraphBinding({ principalId: "p", principalType: "Group", nestingDepth: "9" }).nestingDepth === "malformed");
check("...an ABSENT depth is still null (silence is not a broken assertion)",
  normalizeGraphBinding({ principalId: "p", principalType: "Group" }).nestingDepth === null);
check("...and a malformed depth is GRADED even with no budget, unlike an absent one",
  evaluateEntitlementBinding({ principalId: "p", mechanism: "group", carrier: "security_group",
    carrierOwner: "owner_assigned", nestingDepth: "malformed", nestingDepthBudget: null,
    reportIntegrity: "intact" }).reasonCode === "NESTING_DEPTH_MALFORMED");
check("a payload with no identifiable principal is malformed, not a verdict about nobody",
  normalizeGraphBinding({ principalType: "Group" }).reportIntegrity === "malformed");
check("the budget is a PARAMETER, never read from the directory payload",
  normalizeGraphBinding({ principalId: "p", principalType: "Group", nestingDepthBudget: 99 } as never, 3)
    .nestingDepthBudget === 3);
check("on-prem Active Directory is declared UNSUPPORTED rather than half-supported",
  ENTITLEMENT_BINDING_READ_CONTRACT.activeDirectorySupported === false);

// ── 5. Fixtures grade the way their names claim ───────────────────────────────
const expectations: Record<string, string> = {
  "governable-security-group": "none",
  "direct-to-user": "step_up",
  "distribution-group-carrying-permissions": "step_up",
  "ownerless-group": "step_up",
  "deeply-nested": "monitor",
  "mail-enabled-security-group": "none",
  unreadable: "step_up",
  "incoherent-group-without-owner-concept": "step_up",
};
check(`every fixture grades as its name claims (${Object.keys(expectations).length} fixtures)`,
  Object.entries(expectations).every(
    ([name, action]) => evaluateEntitlementBindingFixture(name)?.recommendedAction === action));
check("an unknown fixture name is null, never invented",
  evaluateEntitlementBindingFixture("no-such-fixture") === null);
check("the fixture corpus covers every posture this dimension can report",
  new Set(Object.keys(ENTITLEMENT_BINDING_FIXTURES).map(
    (n) => evaluateEntitlementBindingFixture(n)!.posture)).size === 5);
check("no fixture carries a wall-clock timestamp — depths are counts, not times",
  Object.values(ENTITLEMENT_BINDING_FIXTURES).every(
    (f) => f.nestingDepth === null || Number.isInteger(f.nestingDepth)));

// ── 6. No network I/O in the family ──────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "../../lib/integrations/src/integrations/entitlement-binding");
  // RECURSIVE. The previous scan used a flat readdirSync, so a subdirectory could
  // hold anything at all and the guarantee would still print green.
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []);
  const files = walk(dir);
  const offenders: string[] = [];

  // WHAT THIS BANS, and the claim is now narrowed to what it actually checks.
  //
  // THE OLD VERSION PRINTED A FALSE GUARANTEE. It said "no network I/O in any
  // source" while matching only fetch/axios/got/undici/https.request and a mutating
  // `method:` literal. Adversarial review found `nac/store.ts` doing
  // `await import("ioredis")` and opening a TCP connection to Redis — real network
  // I/O, invisible to every pattern in the list. The scan was reporting success over
  // something it had stopped looking at, which this repo's own guard-registry header
  // calls WORSE than no guard.
  //
  // Two changes. (1) The claim is now "no VENDOR-API call", which is the property
  // that actually matters here — Redis is configuration storage, not a device
  // actuator, and banning it outright would be theatre. (2) The pattern list gained
  // dynamic import of network clients, node:net/http/https/tls, XHR, WebSocket and
  // aliased fetch, so the next thing that sneaks in has fewer doors.
  const banned = [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i,
    /\b(?:const|let|var)\s+\w+\s*=\s*fetch\b/i,            // aliased fetch
    /\brequire\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i,
    /\bimport\s*\(\s*['"](?:axios|got|undici|node-fetch|superagent|request|ioredis|redis|pg|mysql2|mongodb)['"]/i,
    /\bfrom\s+['"](?:axios|got|undici|node-fetch|superagent|request)['"]/i,
    /\bfrom\s+['"]node:(?:net|http|https|tls|dgram)['"]/i,
    /\bhttps?\.(?:request|get)\s*\(/i,
    /\bnet\.(?:connect|createConnection)\s*\(/i,
    /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
  ];
    const allowed = (_rel: string): boolean => false;
  for (const f of files) {
    const rel = f.slice(dir.length + 1);
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (allowed(rel) ) return;
      if (banned.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  if (offenders.length) console.log(`      offenders: ${offenders.join(", ")}`);
  check(`no VENDOR-API call in any entitlement-binding/ source — an actuator cannot return (${files.length} files scanned recursively)`,
    offenders.length === 0);
  // NON-VACUITY: the scan must be able to FAIL. Without this, deleting the pattern
  // list would leave the assertion green and nobody would notice.
  check("...and the scan actually detects a planted vendor call",
    banned.some((re) => re.test(`await fetch("https://vendor/api", { method: "POST" })`)) &&
    banned.some((re) => re.test(`const { Redis } = await import("ioredis");`)));
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
