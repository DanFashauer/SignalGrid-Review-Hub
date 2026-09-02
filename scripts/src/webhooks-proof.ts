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

import { createHmac } from "node:crypto";
import {
  resolveWebhookDelivery,
  validateWebhookUrl,
  dispatchEvent,
  isPermanentDeliveryError,
  signPayload,
  createSignedHeaders,
  WEBHOOK_URL_REFUSALS,
  WEBHOOK_URL_REFUSAL_REASONS,
} from "@workspace/integrations/webhooks";
import { SIGNING_SECRET_MISSING } from "@workspace/integrations/emit-gate/signing";
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

// 5e. A MISSING SIGNING SECRET IS REFUSED, RECORDED, AND FINAL.
//
//     PORTED from tests/security-reference/fail-closed-fallbacks.test.ts — the block
//     'fails webhook dispatch when signing secret is missing'. That spec is a Vitest
//     file no runner in this repository reaches (scripts/check-test-execution.mjs
//     declares the directory unexecuted), so until now the refusal at
//     dispatch.ts:247 was CODE THAT LOOKED RIGHT AND WAS DRIVEN BY NOBODY. The
//     sibling refusals either side of it — the tier gate (5c) and the URL rules
//     (5d) — both got here after a defect; this one simply had not been asked.
//
//     It is reachable on every live dispatch in this tree, not a corner: the store
//     strips `secretHash` from everything `getWebhooksForEvent` returns and never
//     carries a plaintext `_secret`, so the ONLY secret source dispatch has is the
//     `WEBHOOK_SECRET_<id8>` environment variable. Unset, every live delivery must
//     refuse rather than POST a customer payload unsigned — a receiver cannot tell
//     an unsigned event from anybody else's.
//
//     Offline, like the two before it: the refusal returns before any fetch.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedRedis = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  process.env.SIGNALGRID_TIER = "prod";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  try {
    const hook = await createWebhook({
      name: "proof-no-secret",
      url: "https://hooks.example.test/unsigned",
      events: ["session.end"],
    } as never);
    // Guard the premise rather than assume it: if some other path ever starts
    // handing dispatch a secret, this block must say so instead of passing.
    check("no-secret premise: the stored webhook exposes no usable secret to dispatch",
      (hook as unknown as { _secret?: string })._secret === undefined &&
        process.env[`WEBHOOK_SECRET_${hook.id.slice(0, 8)}`] === undefined);

    const summary = await dispatchEvent("session.end", { probe: true });
    check("live tier + no signing secret: counted as failed, not succeeded and not suppressed",
      summary.failed === 1 && summary.succeeded === 0 && summary.suppressed === 0);
    const logs = await getDeliveryLogs(hook.id);
    check(`live tier + no signing secret: the refusal RECORDS a delivery row (found ${logs.length})`,
      logs.length >= 1);
    check("live tier + no signing secret: exactly ONE row — the refusal is permanent, not retried",
      logs.length === 1);
    check("live tier + no signing secret: the row names the missing secret, in the shared wording",
      logs[0]?.error === SIGNING_SECRET_MISSING);
    // The permanence branch itself (dispatch.ts:331). Every OTHER permanent reason
    // is derived from WEBHOOK_URL_REFUSAL_REASONS above; this one is a standalone
    // comparison, and a standalone string comparison going stale is the exact
    // defect 5a exists to remember.
    check("permanent: a missing signing secret is never retried (no retry mints a secret)",
      isPermanentDeliveryError({ success: false, error: SIGNING_SECRET_MISSING }) === true);

    // NON-VACUITY I — the signing refusal is not what a secretless webhook always
    // gets. At a tier that never delivers, the same webhook is refused by the TIER,
    // and the row says so.
    process.env.SIGNALGRID_TIER = "dev";
    delete process.env.SIGNALGRID_LIVE_INTEGRATIONS;
    const devHook = await createWebhook({
      name: "proof-no-secret-dev",
      url: "https://hooks.example.test/unsigned-dev",
      events: ["badge.enroll"],
    } as never);
    await dispatchEvent("badge.enroll", { probe: true });
    const devLogs = await getDeliveryLogs(devHook.id);
    check("non-vacuity: the SAME secretless webhook at a non-delivering tier is refused by the tier, not the secret",
      devLogs.length === 1 && devLogs[0]?.status === "suppressed" &&
        devLogs[0]?.error !== SIGNING_SECRET_MISSING);

    // NON-VACUITY II — ORDER. A plain-http target with no secret must be refused by
    // the URL rule, which runs first. If the secret check ever moved above
    // validateWebhookUrl, this row would read SIGNING_SECRET_MISSING and an operator
    // would be told to configure a secret for a URL that can never be delivered to.
    process.env.SIGNALGRID_TIER = "prod";
    process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
    const orderHook = await createWebhook({
      name: "proof-no-secret-bad-url",
      url: "http://hooks.example.test/unsigned-plain",
      events: ["policy.matched"],
    } as never);
    await dispatchEvent("policy.matched", { probe: true });
    const orderLogs = await getDeliveryLogs(orderHook.id);
    check("non-vacuity: URL validation runs BEFORE the secret check — a bad URL names the URL rule",
      orderLogs.length === 1 && orderLogs[0]?.error === WEBHOOK_URL_REFUSALS.httpsRequired);
  } finally {
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
  }
}

// 5f. THE SECRET PATH, END TO END THROUGH THE TRANSPORT — and still offline.
//
//     5e proves the REFUSAL when no secret exists. On its own that is the weaker
//     half: a dispatcher that refused everything would satisfy it. The other half —
//     that a webhook holding a secret actually reaches the wire, and that what lands
//     on the wire is SIGNED — needs the fetch to happen, and a proof that makes a
//     network call is not offline.
//
//     Resolved with the record-and-throw spy `emit-gate-proof.ts` uses (there, to
//     assert a fetch NEVER happens; here, to assert one does and to read what it
//     carried). `globalThis.fetch` is replaced by a function that records the URL and
//     the init, then throws before any socket is opened. Nothing leaves the process.
//
//     `maxAttempts: 1` is passed deliberately. The spy throws, which is a TRANSIENT
//     error by every rule in retry.ts, so the default six attempts would fire the spy
//     six times over ~63s of backoff — a slow proof whose central assertion ("exactly
//     once") would be about the retry policy rather than about signing.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedRedis = process.env.REDIS_URL;
  const realFetch = globalThis.fetch;
  delete process.env.REDIS_URL;
  process.env.SIGNALGRID_TIER = "prod";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";

  const SECRET = "w".repeat(40);
  const TARGET = "https://hooks.example.test/signed";
  let calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const installSpy = (): void => {
    calls = [];
    globalThis.fetch = ((input: unknown, init?: { headers?: unknown; body?: unknown }): never => {
      calls.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ""),
      });
      throw new Error("FETCH INTERCEPTED — recorded and stopped before the socket");
    }) as unknown as typeof globalThis.fetch;
  };
  // One attempt only: the assertion is about what the FIRST send carried.
  const ONE_SHOT = { timeoutMs: 1000, retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 } };

  try {
    const hook = await createWebhook({ name: "proof-signed", url: TARGET, events: ["siem.event"] } as never);
    // The only secret source dispatch has in this tree (the store strips secretHash
    // and carries no plaintext `_secret`) — so this is the real production seam,
    // not a test-only injection point.
    const ENV_KEY = `WEBHOOK_SECRET_${hook.id.slice(0, 8)}`;
    process.env[ENV_KEY] = SECRET;
    try {
      installSpy();
      await dispatchEvent("siem.event", { probe: true }, ONE_SHOT as never);

      check(`with a secret configured, the delivery REACHES the transport exactly once (spy fired ${calls.length}x)`,
        calls.length === 1);
      const sent = calls[0];
      check("…and it went to the configured target URL",
        sent?.url === TARGET);
      const sig = sent?.headers["X-Webhook-Signature"] ?? "";
      check("the request that left carries the X-Webhook-Signature header",
        /^[0-9a-f]{64}$/.test(sig));
      // THE CENTRAL ASSERTION: the signature on the wire verifies against the BODY on
      // the wire, under the secret the operator configured. This is what a receiver
      // does, done here against the bytes dispatch actually handed to fetch — not
      // against a payload this proof rebuilt and hoped matched.
      check("the signature on the wire VERIFIES against the body on the wire, under the configured secret",
        sig.length > 0 && signPayload(sent?.body ?? "", SECRET) === sig);
      // Cross-checked with an independent HMAC, so this is not signPayload agreeing
      // with itself.
      check("…and verifies under an INDEPENDENT HMAC-SHA256 of the same body and secret",
        sig.length > 0 && createHmac("sha256", SECRET).update(sent?.body ?? "", "utf8").digest("hex") === sig);
      // The signed bytes must be the real event, not an empty or placeholder body.
      check("the signed body is the actual event payload (non-empty, carries the event type)",
        (sent?.body.length ?? 0) > 0 && (sent?.body ?? "").includes("siem.event"));
      // A WRONG secret must not verify — otherwise the check above would pass for a
      // receiver holding any key at all.
      check("a receiver holding the WRONG secret does not verify the same body",
        sig.length > 0 && signPayload(sent?.body ?? "", `${SECRET}x`) !== sig);

      // RETRY RE-SENDS THE IDENTICAL SIGNED BODY. Three attempts, 1ms apart, with the
      // spy recording each. A receiver deduplicates on X-Webhook-Delivery-Id and
      // verifies the signature; if a retry re-signed fresh material — a new
      // timestamp, a nonce, a re-serialised body with different key order — the
      // second delivery would carry a different signature for the same delivery id,
      // and a strict receiver would read that as forgery of an event it had already
      // seen. The payload is built ONCE in dispatchEvent, above the retry loop, and
      // this pins that.
      installSpy();
      await dispatchEvent("siem.event", { probe: true },
        { timeoutMs: 1000, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 } } as never);
      check(`a transient failure is retried to the configured ceiling (3 attempts, spy fired ${calls.length}x)`,
        calls.length === 3);
      const sigs = new Set(calls.map((c) => c.headers["X-Webhook-Signature"]));
      const bodies = new Set(calls.map((c) => c.body));
      check(`every retry re-sends the IDENTICAL signed body — one distinct signature across the attempts (found ${sigs.size})`,
        calls.length === 3 && sigs.size === 1 && bodies.size === 1);
      check("…and that one signature still verifies against that one body",
        bodies.size === 1 && signPayload([...bodies][0] ?? "", SECRET) === ([...sigs][0] ?? ""));
    } finally {
      delete process.env[ENV_KEY];
    }

    // NON-VACUITY, the mirror of 5e: the SAME webhook shape with the secret removed
    // must never reach the transport at all. Together with the block above this pins
    // both directions — secret present, it sends and signs; secret absent, nothing
    // is attempted, which is the only safe failure for an unsigned customer payload.
    const bare = await createWebhook({ name: "proof-signed-nosecret", url: TARGET, events: ["telemetry.sync.completed"] } as never);
    installSpy();
    await dispatchEvent("telemetry.sync.completed", { probe: true }, ONE_SHOT as never);
    check("without the secret the transport is NEVER reached — refused before the socket, not after",
      calls.length === 0);
    const bareLogs = await getDeliveryLogs(bare.id);
    check("…and that untransmitted attempt is still recorded, naming the missing secret",
      bareLogs.length === 1 && bareLogs[0]?.error === SIGNING_SECRET_MISSING);
  } finally {
    globalThis.fetch = realFetch;
    if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
    if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
    if (savedRedis === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = savedRedis;
  }
}

// 6. THE SIGNATURE ITSELF.
//
//    PORTED from tests/security-reference/webhook-signing.test.ts. That spec asserted
//    the invariants against HMACs it computed INLINE with node:crypto — so it would
//    have passed with `signPayload` deleted, and it tested node, not this repository.
//    Rewritten to drive lib/integrations' own `signPayload`/`createSignedHeaders`,
//    which nothing else in the tree exercises: the only caller is dispatch.ts:264,
//    and every dispatch assertion above stops BEFORE reaching it.
//
//    The reference HMAC is kept as an independent oracle — computed here, compared
//    against the library — so this is a cross-check, not `f(x) === f(x)`.
{
  const secret = "s".repeat(32);
  const payload = JSON.stringify({ event: "session.start", data: { sessionId: "sess-123" } });
  const sig = signPayload(payload, secret);

  check("signPayload emits SHA-256 hex: 64 lowercase hex characters", /^[0-9a-f]{64}$/.test(sig));
  check("signPayload agrees with an independent HMAC-SHA256 of the same payload and secret",
    sig === createHmac("sha256", secret).update(payload, "utf8").digest("hex"));
  check("signPayload is deterministic — the same payload and secret sign identically",
    signPayload(payload, secret) === sig);
  check("a DIFFERENT secret produces a different signature (the secret is actually keyed in)",
    signPayload(payload, `${secret}x`) !== sig);
  check("a TAMPERED payload produces a different signature (one byte is enough)",
    signPayload(JSON.stringify({ event: "session.start", data: { sessionId: "sess-124" } }), secret) !== sig);

  const headers = createSignedHeaders(payload, secret, "delivery-1", "event-1");
  check("createSignedHeaders carries the signature under X-Webhook-Signature",
    headers["X-Webhook-Signature"] === sig);
  check("createSignedHeaders carries the delivery and event ids a receiver dedupes on",
    headers["X-Webhook-Delivery-Id"] === "delivery-1" && headers["X-Webhook-Event-Id"] === "event-1");
  // STATED, NOT ASSERTED: `X-Webhook-Timestamp` is emitted (sign.ts:35) but is NOT
  // part of the signed material — the HMAC covers the body alone. So the timestamp is
  // attacker-mutable in transit and cannot carry replay protection, which is the job
  // it looks like it is doing. Left as-is in this batch deliberately: signing it is a
  // WIRE-FORMAT change every existing receiver would have to adopt in lockstep, so it
  // needs its own decision and its own migration, not a quiet edit inside a proof.
  // Tracked separately; this comment exists so the next reader does not mistake the
  // header's presence for freshness coverage.
  // The signature must cover the BODY. Signing the envelope ids instead would let a
  // captured body be replayed under a fresh delivery id with a signature that still
  // verifies — the header set would look correct and protect nothing.
  check("the signature is over the PAYLOAD, not the envelope ids (a new delivery id re-signs the same body identically)",
    createSignedHeaders(payload, secret, "delivery-2", "event-2")["X-Webhook-Signature"] === sig);
  check("…and a changed body changes the header signature, with the ids held fixed",
    createSignedHeaders(`${payload} `, secret, "delivery-1", "event-1")["X-Webhook-Signature"] !== sig);
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound webhook delivery is gated; dev/alpha never emit and every refusal explains itself.");
