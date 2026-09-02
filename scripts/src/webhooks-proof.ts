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

import {
  resolveWebhookDelivery,
  validateWebhookUrl,
  dispatchEvent,
  isPermanentDeliveryError,
  WEBHOOK_URL_REFUSALS,
  WEBHOOK_URL_REFUSAL_REASONS,
} from "@workspace/integrations/webhooks";
import { createWebhook, getDeliveryLogs } from "@workspace/integrations/webhooks/store";

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

// ── 5. A REFUSAL IS PERMANENT, AND SUPPRESSION IS NOT A FAILURE ─────────────
//
// THE BEFORE-STATE, reproduced by the author at caabfdd and quoted here so the
// assertions below have something to be about:
//
//   · dev tier, one enabled webhook → THREE suppressed delivery rows for one
//     event, and `dispatchEvent` returned `failed: 1`. The retry loop treated a
//     tier decision as a transient error and re-asked it twice, ~3s apart, then
//     dead-lettered an event that was never supposed to leave the process.
//   · live tier, a plain-http target → NO delivery rows at all. The URL refusal
//     returned without recording, so the per-webhook delivery log — the thing an
//     operator opens to ask what happened — showed nothing, while the event sat
//     in the DLQ.
//
// Both came from the same root: `isPermanentError` compared `result.error`
// against 'HTTPS required in production' and 'Localhost not allowed in
// production', two strings validateWebhookUrl STOPPED RETURNING when its rules
// were rewritten. A dead string comparison does not fail. It just never matches.

// 5a. DERIVED permanence. Every string the validator can return, taken from the
//     validator's own source of truth rather than retyped here — the retyped copy
//     is precisely what went stale.
check(
  `the validator's refusal set is non-empty (${WEBHOOK_URL_REFUSAL_REASONS.length} reasons) — the loop below is not vacuous`,
  WEBHOOK_URL_REFUSAL_REASONS.length >= 4,
);
for (const reason of WEBHOOK_URL_REFUSAL_REASONS) {
  check(
    `permanent: "${reason}" is never retried`,
    isPermanentDeliveryError({ success: false, error: reason }) === true,
  );
}
// And the set really is the one the validator returns — asserted from the other
// side, so a constant added to the object but never returned cannot pad it.
for (const [label, url, live] of [
  ["plain http at a live tier", "http://hooks.example.test/x", true],
  ["loopback", "https://127.0.0.1/hook", true],
  ["private range", "https://10.0.0.7/hook", true],
  ["unparseable", "not-a-url", true],
] as ReadonlyArray<readonly [string, string, boolean]>) {
  const r = validateWebhookUrl(url, { live });
  check(
    `derived: the ${label} refusal is one of the exported reasons`,
    r.valid === false && r.error !== undefined && WEBHOOK_URL_REFUSAL_REASONS.includes(r.error),
  );
}
check(
  "derived: the exported constants are the strings the validator returns (https rule)",
  validateWebhookUrl("http://hooks.example.test/x", { live: true }).error === WEBHOOK_URL_REFUSALS.httpsRequired,
);

// 5b. SUPPRESSION IS PERMANENT, and it is not a failure.
check(
  "permanent: a suppressed result is never retried — a tier does not change between attempts",
  isPermanentDeliveryError({ success: false, suppressed: true, error: 'tier "dev" never delivers live webhooks' }) === true,
);
// NON-VACUITY for the whole permanence block: a retryable 5xx must still retry,
// or "everything is permanent" would satisfy every assertion above.
check(
  "not permanent: a 503 is still retried (the predicate is not always-true)",
  isPermanentDeliveryError({ success: false, statusCode: 503 }) === false,
);

// 5c. END TO END at dev tier, against the real in-memory store. This is the
//     before-state above, measured.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL; // in-memory store; no network, no database
  process.env.SIGNALGRID_TIER = "dev";
  delete process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  try {
    const hook = await createWebhook({
      name: "proof-suppressed",
      url: "https://hooks.example.test/suppressed",
      events: ["session.start"],
    } as never);
    const summary = await dispatchEvent("session.start", { probe: true });
    check("dev tier: dispatchEvent reports the suppression as suppressed, not failed",
      summary.suppressed === 1 && summary.failed === 0);
    check("dev tier: the event is still counted as dispatched (it was attempted)", summary.dispatched === 1);
    check("dev tier: nothing is reported as succeeded", summary.succeeded === 0);
    const logs = await getDeliveryLogs(hook.id);
    check(`dev tier: ONE suppressed delivery row, not one per retry attempt (found ${logs.length})`,
      logs.length === 1 && logs[0]?.status === "suppressed");
    check("dev tier: the suppressed row carries the reason the tier gave",
      /tier "dev"/.test(logs[0]?.error ?? ""));
  } finally {
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
  }
}

// 5d. A URL REFUSAL LEAVES AN AUDIT ROW, like the two refusals either side of it.
//     Driven at a LIVE tier with a plain-http target: the validator refuses before
//     any fetch, so this reaches no network.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  process.env.SIGNALGRID_TIER = "prod";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  try {
    const hook = await createWebhook({
      name: "proof-bad-url",
      url: "http://hooks.example.test/plain",
      events: ["auth.failure"],
    } as never);
    const summary = await dispatchEvent("auth.failure", { probe: true });
    check("live tier + plain-http target: counted as failed, not suppressed",
      summary.failed === 1 && summary.suppressed === 0);
    const logs = await getDeliveryLogs(hook.id);
    check(`live tier + plain-http target: the refusal RECORDS a delivery row (found ${logs.length})`,
      logs.length >= 1);
    check("live tier + plain-http target: exactly ONE row — the refusal is permanent, not retried",
      logs.length === 1);
    check("live tier + plain-http target: the row names the URL rule that refused it",
      logs[0]?.error === WEBHOOK_URL_REFUSALS.httpsRequired);
  } finally {
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
  }
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound webhook delivery is gated; dev/alpha never emit and every refusal explains itself.");
