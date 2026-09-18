// Affected-audience proof — fully OFFLINE and deterministic.
//
// Cascade join 3: a decision's blast radius becomes routing instructions for people
// who were never part of it, delivered by the HOST on a channel they already use.
// This proof holds the two fail-closed properties the whole thing rests on, and
// holds them by construction rather than by inspection:
//
//  1. THE ONE OUTCOME THAT IS NEVER PRODUCED IS SILENCE. Every shape that could
//     plausibly yield nobody — an empty roster, a roster that matches no scope, a
//     roster of nothing but the subject, a holder with no reachable channel, an
//     absent area — is enumerated and asserted to route to the named OWNER instead.
//     "Nobody needed to know" and "we could not work out who needed to know" look
//     identical afterwards and are opposite facts.
//  2. SILENCE IS NEVER REPORTED AS TOLD. Every notice is born `undelivered`, and the
//     only path to `delivered` demands a host AND an instant. Blank either one and
//     the delivery is REFUSED back to undelivered with a reason, rather than
//     recorded on trust.
//
// The load-bearing negative is the absent-area case. An area nobody supplied must
// match NOTHING — the widest possible audience is exactly the wrong failure for a
// notification path, and it is the one a "sensible default" would produce.
import {
  deriveAffectedAudience,
  routeAffectedNotices,
  recordNoticeDelivered,
  deliveredCount,
  type AffectedScope,
  type ScopeHolder,
} from "@workspace/signalgrid-core";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Affected-audience proof");

const OWNER = "owner:area-ops-7";
const SCOPE: AffectedScope = {
  decisionId: "dec-5150",
  tenantId: "t-northwind",
  deviceId: "cart-14",
  workflowId: "wf-med-admin",
  areaRef: "ward-3b",
  subjectRef: "person:nurse-a",
};

const holder = (over: Partial<ScopeHolder> = {}): ScopeHolder => ({
  principalRef: "person:nurse-b",
  role: "worker",
  scope: "device",
  scopeRef: "cart-14",
  channel: "device_prompt",
  ...over,
});

// ── 1. who is in the blast radius ──────────────────────────────────────────────
const roster: ScopeHolder[] = [
  holder(),
  holder({ principalRef: "person:eng-c", role: "operator", scope: "workflow", scopeRef: "wf-med-admin", channel: "operator_console" }),
  holder({ principalRef: "person:sup-d", role: "admin", scope: "area", scopeRef: "ward-3b", channel: "itsm_ticket" }),
  holder({ principalRef: "person:nurse-a", scope: "device", scopeRef: "cart-14" }), // the SUBJECT
  holder({ principalRef: "person:far-e", scope: "device", scopeRef: "cart-99" }),   // another device
  holder({ principalRef: "person:far-f", scope: "area", scopeRef: "ward-9z" }),     // another area
];
const audience = deriveAffectedAudience(SCOPE, roster);
check("the three in-scope holders are found", audience.length === 3);
check("the SUBJECT of the decision is not notified about their own decision", audience.every((h) => h.principalRef !== "person:nurse-a"));
check("a holder on another device is out of scope", audience.every((h) => h.principalRef !== "person:far-e"));
check("a holder in another area is out of scope", audience.every((h) => h.principalRef !== "person:far-f"));
check("device, workflow and area all bind", JSON.stringify(audience.map((h) => h.scope)) === JSON.stringify(["device", "workflow", "area"]));

// A person bound twice is told once.
const dup = deriveAffectedAudience(SCOPE, [holder(), holder({ scope: "workflow", scopeRef: "wf-med-admin" })]);
check("a person in two scopes is told once, not twice", dup.length === 1);

// ── 2. THE LOAD-BEARING NEGATIVE: an absent area matches nothing ───────────────
for (const areaRef of [null, undefined, ""]) {
  const a = deriveAffectedAudience({ ...SCOPE, areaRef }, [holder({ principalRef: "person:sup-d", scope: "area", scopeRef: "ward-3b" })]);
  check(`an area of ${JSON.stringify(areaRef)} matches NOBODY by area (the widest audience is the wrong failure)`, a.length === 0);
}

// ── 3. silence is never an outcome ────────────────────────────────────────────
const silentShapes: [string, ScopeHolder[]][] = [
  ["an empty roster", []],
  ["a roster matching no scope", [holder({ principalRef: "person:far-e", scopeRef: "cart-99" })]],
  ["a roster of nothing but the subject", [holder({ principalRef: "person:nurse-a" })]],
];
for (const [name, holders] of silentShapes) {
  const notices = routeAffectedNotices(SCOPE, deriveAffectedAudience(SCOPE, holders), OWNER);
  check(
    `${name} routes to the OWNER, never to nobody`,
    notices.length === 1 && notices[0]!.principalRef === OWNER && notices[0]!.channel === "notify_owner" && notices[0]!.backstop === true && notices[0]!.reason === "audience_unresolved",
  );
}

// Affected but unreachable — the state most likely to be quietly dropped.
const unreachable = routeAffectedNotices(SCOPE, deriveAffectedAudience(SCOPE, [holder({ channel: null })]), OWNER);
check("an affected person with NO known channel routes to the owner", unreachable.length === 1 && unreachable[0]!.channel === "notify_owner");
check("...and is marked a backstop, never mistaken for having reached the person", unreachable[0]!.backstop === true);

const routed = routeAffectedNotices(SCOPE, audience, OWNER);
check("a resolved audience routes to the channels those people already use", JSON.stringify(routed.map((n) => n.channel)) === JSON.stringify(["device_prompt", "operator_console", "itsm_ticket"]));
check("no notice in a resolved audience is a backstop", routed.every((n) => n.backstop === false));
check("SignalGrid never routes to a surface of its own — every channel is a pre-existing one", routed.every((n) => n.channel !== "notify_owner"));

// ── 4. silence is never reported as told ──────────────────────────────────────
check("every notice is born undelivered", routed.every((n) => n.delivery.state === "undelivered"));
check("a fresh batch has delivered=0", deliveredCount(routed) === 0);

const told = recordNoticeDelivered(routed[0]!, "host:epic-inbasket", "2026-09-17T15:30:00Z");
check("a host that names itself and an instant CAN record delivery", told.delivery.state === "delivered");
check("the delivered record names the host", told.delivery.state === "delivered" && told.delivery.byHost === "host:epic-inbasket");
check("delivered counts only what was delivered", deliveredCount([told, ...routed.slice(1)]) === 1);

for (const [name, host, at] of [
  ["a blank host", "  ", "2026-09-17T15:30:00Z"],
  ["a blank instant", "host:x", "   "],
  ["both blank", "", ""],
] as const) {
  const refused = recordNoticeDelivered(routed[0]!, host, at);
  check(`delivery claimed with ${name} is REFUSED back to undelivered`, refused.delivery.state === "undelivered");
}

// ── 5. deterministic ──────────────────────────────────────────────────────────
check("the same inputs route byte-identical notices", JSON.stringify(routeAffectedNotices(SCOPE, audience, OWNER)) === JSON.stringify(routed));
check("ids are stable across runs", routeAffectedNotices(SCOPE, audience, OWNER)[0]!.id === routed[0]!.id);
check("a different decision is a different notice id", routeAffectedNotices({ ...SCOPE, decisionId: "dec-OTHER" }, audience, OWNER)[0]!.id !== routed[0]!.id);
check("a different principal is a different notice id", routed[0]!.id !== routed[1]!.id);
check("no notice carries a clock reading of its own", routed.every((n) => n.delivery.state === "undelivered" && !("at" in n.delivery)));

const total = passed + failures.length;
console.log(`figures=inScope=${audience.length},silentShapes=${silentShapes.length},refusedDeliveries=3,channels=${new Set(routed.map((n) => n.channel)).size}`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
