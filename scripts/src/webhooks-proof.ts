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

import { resolveWebhookDelivery, validateWebhookUrl } from "@workspace/integrations/webhooks";

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

// ── The URL guard reads the SAME resolution as the delivery gate ─────────────
//
// This proof only ever exercised `resolveWebhookDelivery`, and never the URL
// validator — which is why nothing covered the defect it now pins.
//
// `validateWebhookUrl` used to be gated on a MODULE-LOAD constant read from
// NODE_ENV, while the delivery gate read SIGNALGRID_TIER at CALL time. Two gates
// on one outbound path, disagreeing about what "production" means: a deployment
// that set the repo's own tier vocabulary to prod and turned live integrations on
// had done everything this codebase asks, and still got plain-HTTP delivery of an
// HMAC-signed payload to loopback or an internal address whenever NODE_ENV
// happened to be unset. Being read at module load also made it unvariable per
// call — and a gate that cannot be varied per call cannot be proven.
//
// Worse, the block it guarded covered only four loopback spellings. Every RFC1918
// address passed even when the guard DID fire.
//
// Two rules now, deliberately different in kind, and both are asserted in both
// directions so neither can be satisfied by refusing everything.

// 1. THE SSRF BLOCK IS UNCONDITIONAL — asserted in a LIVE tier and a SUPPRESSED
//    one, because "we are not sending anyway" is not a reason to accept an
//    internal target.
for (const [label, isLive] of [["live", true], ["suppressed", false]] as ReadonlyArray<readonly [string, boolean]>) {
  for (const host of [
    "https://127.0.0.1/hook",
    "https://localhost/hook",
    "https://[::1]/hook",
    "https://0.0.0.0/hook",
    "https://10.0.0.7/hook",
    "https://192.168.0.5/hook",
    "https://172.16.0.3/hook",
    "https://169.254.169.254/latest/meta-data",
  ]) {
    check(
      `${label}: ${host} is refused as an internal target`,
      validateWebhookUrl(host, { live: isLive }).valid === false,
    );
  }
  // NON-VACUITY for this loop. Without it, a validator that refused EVERYTHING
  // would satisfy all sixteen assertions above.
  check(
    `${label}: a public HTTPS target is still accepted`,
    validateWebhookUrl("https://hooks.example.test/x", { live: isLive }).valid === true,
  );
}

// 2. THE HTTPS RULE IS GATED ON LIVE DELIVERY, taken from the same resolution the
//    delivery gate returns — not from a separate environment variable.
check(
  "live delivery refuses a plain-HTTP target",
  validateWebhookUrl("http://hooks.example.test/x", { live: true }).valid === false,
);
check(
  "a suppressed tier may still point a fixture at a plain-HTTP mock",
  validateWebhookUrl("http://mock.example.test/x", { live: false }).valid === true,
);
check(
  "the URL guard's live flag comes from resolveWebhookDelivery, so the two cannot disagree",
  validateWebhookUrl("http://hooks.example.test/x", {
    live: resolveWebhookDelivery({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "live",
  }).valid === false,
);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound webhook delivery is gated; dev/alpha never emit and every refusal explains itself.");
