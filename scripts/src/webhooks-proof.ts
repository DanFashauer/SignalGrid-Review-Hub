// Proof: outbound webhook delivery is gated, and a withheld delivery says so.
//
// Webhooks POST a signed payload to a CUSTOMER-SUPPLIED URL. That is an outbound
// emitter, not a device actuator: unlike "quarantine this endpoint" it has a
// legitimate read-only-disciplined form — send nothing — so the family is gated
// rather than deleted (the taxonomy in scripts/check-connector-discipline.mjs).
//
// Two claims:
//
//   1. dev and alpha NEVER deliver, and beta/prod deliver only with
//      SIGNALGRID_LIVE_INTEGRATIONS explicitly "true". Every refusal carries a
//      reason, so "nothing was sent" is never mistaken for "nothing to send".
//   2. A suppressed delivery is DISTINGUISHABLE from a failed one. Folding the
//      two together would make a tier that is never supposed to emit look like a
//      tier whose webhooks are broken — and teach an operator to ignore failures.
//
// Pure and offline: the gate is a function of the environment, so this asserts it
// without a network, a server, or a fixture endpoint.

import { resolveWebhookDelivery } from "@workspace/integrations/webhooks";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}`);
  }
}

function suppressedWithReason(env: NodeJS.ProcessEnv, label: string): void {
  const r = resolveWebhookDelivery(env);
  check(`${label} → suppressed`, r.mode === "suppressed");
  check(`${label} → states a reason`, r.mode === "suppressed" && r.reason.length > 0);
}

// ── 1. Tiers that must never emit ────────────────────────────────────────────
// Asserted WITH live-integrations set to "true", so this pins the tier check
// itself rather than passing for the unrelated reason that the flag was unset.
for (const tier of ["dev", "alpha", "test", "staging", ""]) {
  suppressedWithReason(
    { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" },
    `tier "${tier || "(empty)"}" with live-integrations true`,
  );
}
suppressedWithReason({}, "empty environment (defaults to dev)");
suppressedWithReason({ SIGNALGRID_LIVE_INTEGRATIONS: "true" }, "live-integrations true but no tier");

// ── 2. Beta/prod still need the explicit flag ────────────────────────────────
for (const tier of ["beta", "prod"]) {
  suppressedWithReason({ SIGNALGRID_TIER: tier }, `tier "${tier}" without the flag`);
  suppressedWithReason(
    { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "false" },
    `tier "${tier}" with flag "false"`,
  );
  // Exact-match only: a truthy-looking value must not open the gate.
  for (const almost of ["TRUE", "True", "1", "yes", " true"]) {
    suppressedWithReason(
      { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: almost },
      `tier "${tier}" with flag "${almost}"`,
    );
  }
}

// ── 3. The allow path exists ─────────────────────────────────────────────────
// A gate that can never open is a wall, and would pass every assertion above
// while silently breaking the product.
for (const tier of ["beta", "prod", "PROD", "Beta"]) {
  const r = resolveWebhookDelivery({ SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" });
  check(`tier "${tier}" + flag true → live`, r.mode === "live");
}

// ── 4. Suppressed is a distinct state, not a flavour of failure ──────────────
const suppressed = resolveWebhookDelivery({ SIGNALGRID_TIER: "dev" });
check(
  "a suppressed resolution names the tier that withheld it",
  suppressed.mode === "suppressed" && /tier/i.test(suppressed.reason),
);
const live = resolveWebhookDelivery({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" });
check("live and suppressed are different modes", live.mode !== suppressed.mode);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound webhook delivery is gated; dev/alpha never emit and every refusal explains itself.");
