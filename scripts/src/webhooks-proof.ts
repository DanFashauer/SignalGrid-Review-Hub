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
  signedMaterial,
  signTimestampedPayload,
  payloadTimestampMs,
  createSignedHeaders,
  verifySignedWebhook,
  WebhookTimestampUnresolvable,
  WebhookPayloadSchema,
  WEBHOOK_SIGNING_REFUSED,
  WEBHOOK_SIGNATURE_SCHEME,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
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
      const sig = sent?.headers[WEBHOOK_SIGNATURE_HEADER] ?? "";
      const tsHeader = sent?.headers[WEBHOOK_TIMESTAMP_HEADER] ?? "";
      const wireBody = sent?.body ?? "";
      check("the request that left carries a v2-schemed X-Webhook-Signature header",
        /^v2=[0-9a-f]{64}$/.test(sig));
      const wireSig = sig.slice(`${WEBHOOK_SIGNATURE_SCHEME}=`.length);
      check("…and carries X-Webhook-Timestamp as integer epoch milliseconds",
        /^[0-9]{13}$/.test(tsHeader));

      // THE CENTRAL ASSERTION: the signature on the wire verifies against
      // `${timestamp}.${body}` reconstructed FROM THE HEADERS ON THE WIRE, under the
      // secret the operator configured. This is exactly what a receiver does, done
      // against the bytes dispatch handed to fetch — not against a payload this proof
      // rebuilt and hoped matched. The oracle is an INDEPENDENT HMAC computed here,
      // so this is a cross-check rather than signPayload agreeing with itself.
      check("the signature on the wire VERIFIES under an INDEPENDENT HMAC of `${timestamp}.${body}` and the configured secret",
        wireSig.length > 0 &&
          createHmac("sha256", SECRET).update(`${tsHeader}.${wireBody}`, "utf8").digest("hex") === wireSig);
      // (a), the non-vacuous half: the v1 material must NOT verify. If it did, the
      // timestamp is decorative again and a replayer rewrites it freely.
      check("…and does NOT verify under the BODY ALONE — the retired v1 material (the timestamp is inside the MAC)",
        wireSig.length > 0 && createHmac("sha256", SECRET).update(wireBody, "utf8").digest("hex") !== wireSig);
      // (b) ONE MILLISECOND is enough. A replayer who re-POSTs the captured body with
      // a freshened timestamp gets a signature mismatch, which is the whole point of
      // the change.
      check("altering X-Webhook-Timestamp by ONE millisecond breaks verification",
        wireSig.length > 0 &&
          createHmac("sha256", SECRET).update(`${Number(tsHeader) + 1}.${wireBody}`, "utf8").digest("hex") !== wireSig);
      // The header on the wire is DERIVED from the payload's own delivery instant, not
      // minted at signing time. This is what makes the retry assertion below hold
      // without threading a value through dispatch.ts.
      check("the timestamp on the wire is the payload's own delivery instant (derived, not a fresh clock read)",
        tsHeader.length > 0 && Number(tsHeader) === payloadTimestampMs(wireBody));
      // The signed bytes must be the real event, not an empty or placeholder body.
      check("the signed body is the actual event payload (non-empty, carries the event type)",
        wireBody.length > 0 && wireBody.includes("siem.event"));
      // A WRONG secret must not verify — otherwise the check above would pass for a
      // receiver holding any key at all.
      check("a receiver holding the WRONG secret does not verify the same material",
        wireSig.length > 0 && signTimestampedPayload(wireBody, `${SECRET}x`, Number(tsHeader)) !== wireSig);
      // END TO END THROUGH THE RECEIVER: the exported helper accepts the real capture,
      // driven at a `now` one second after the delivery instant. Nothing here reads a
      // clock — the window is entirely the caller's.
      check("the receiver helper ACCEPTS the real wire capture within tolerance",
        verifySignedWebhook(sent?.headers ?? {}, wireBody, SECRET,
          { toleranceMs: 300_000, now: Number(tsHeader) + 1_000 }).valid === true);

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
      const sigs = new Set(calls.map((c) => c.headers[WEBHOOK_SIGNATURE_HEADER]));
      const bodies = new Set(calls.map((c) => c.body));
      const stamps = new Set(calls.map((c) => c.headers[WEBHOOK_TIMESTAMP_HEADER]));
      check(`every retry re-sends the IDENTICAL signed body — one distinct signature across the attempts (found ${sigs.size})`,
        calls.length === 3 && sigs.size === 1 && bodies.size === 1);
      // (c) THE TIMESTAMP IS MINTED ONCE PER DELIVERY, NOT PER ATTEMPT. This is the
      // measurement that named the v1 defect inverted: three attempts previously
      // carried 2+ distinct timestamps under one signature, proving the header was
      // outside the MAC. One timestamp across three attempts is what makes the single
      // signature above meaningful under v2 — if the stamp moved, the signature would
      // have had to move with it.
      check(`three retries carry ONE timestamp as well as one signature (distinct stamps found ${stamps.size})`,
        calls.length === 3 && stamps.size === 1);
      const oneStamp = [...stamps][0] ?? "";
      const oneBody = [...bodies][0] ?? "";
      check("…and that one signature still verifies against `${thatTimestamp}.${thatBody}`",
        bodies.size === 1 && stamps.size === 1 &&
          `${WEBHOOK_SIGNATURE_SCHEME}=${signTimestampedPayload(oneBody, SECRET, Number(oneStamp))}` === ([...sigs][0] ?? ""));
      check("…and the receiver helper accepts EVERY one of the three attempts",
        calls.length === 3 && calls.every((c) =>
          verifySignedWebhook(c.headers, c.body, SECRET,
            { toleranceMs: 300_000, now: Number(oneStamp) + 5_000 }).valid === true));
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

// 5g. A SIGNING REFUSAL LEAVES AN AUDIT ROW — the one refusal in this family that
//     used to leave NONE.
//
//     THE SEAM. `createSignedHeaders` throws `WebhookTimestampUnresolvable` when no
//     delivery instant resolves. That call sat in `dispatchToEndpoint`'s scope but
//     OUTSIDE its try, so the throw walked out of `dispatchWithRetry`, rejected that
//     webhook's `Promise.allSettled` entry in `dispatchEvent`, was counted `failed`
//     — and wrote no `recordDelivery` row. Suppression, a bad URL and a missing
//     secret each record one (5c/5d/5e above); this was the only refusal in the
//     family with no trace, which is the worst kind: indistinguishable from an event
//     that was never raised.
//
//     HOW THE INSTANT IS MADE UNRESOLVABLE, said plainly. NO production injection
//     point was added and none exists — this is a test-only stub of
//     `Date.prototype.toISOString`, the narrowest hook available, installed for the
//     duration of ONE dispatchEvent call and restored in a `finally`. `buildPayload`
//     is the only place a webhook body is constructed and it mints
//     `timestamp: new Date().toISOString()`, so stubbing that method is the whole
//     reach needed. The stub returns a REAL instant the envelope schema accepts:
//     `0000-01-01T00:00:00Z` satisfies `z.string().datetime()` and parses to a
//     NEGATIVE epoch-ms, which `payloadTimestampMs` refuses. Both halves are asserted
//     as premises below, because that is what separates this from the ENVELOPE
//     refusal in dispatchEvent — if the schema rejected the plant, this block would
//     be re-proving `WEBHOOK_ENVELOPE_INVALID` and claiming to prove signing.
//
//     UNREACHABLE FROM PRODUCTION CONFIG TODAY. `buildPayload` always mints a
//     current, readable instant, so nothing an operator can set reaches this. It is
//     a LATENT no-row refusal, and it is driven rather than reasoned about.
{
  const savedTier = process.env.SIGNALGRID_TIER;
  const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  const savedRedis = process.env.REDIS_URL;
  const realFetch = globalThis.fetch;
  const realToISOString = Date.prototype.toISOString;
  delete process.env.REDIS_URL;
  process.env.SIGNALGRID_TIER = "prod";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";

  // A pre-epoch instant: schema-valid, and NOT resolvable to a non-negative stamp.
  const PRE_EPOCH = "0000-01-01T00:00:00Z";
  const SECRET = "u".repeat(40);
  const TARGET = "https://hooks.example.test/unsignable";
  const calls: string[] = [];
  let summary: Awaited<ReturnType<typeof dispatchEvent>> | undefined;
  let threw: unknown;
  let hookId = "";

  try {
    // PREMISES FIRST, so a plant that stopped planting cannot pass as a green gate.
    check("premise: the planted instant is one the ENVELOPE schema ACCEPTS — this is the signing seam, not the envelope refusal",
      WebhookPayloadSchema.shape.timestamp.safeParse(PRE_EPOCH).success === true);
    check("premise: …and one payloadTimestampMs REFUSES, so createSignedHeaders throws at the seam",
      payloadTimestampMs(JSON.stringify({ timestamp: PRE_EPOCH })) === null);

    const hook = await createWebhook({
      name: "proof-unsignable",
      url: TARGET,
      events: ["policy.action.executed"],
    } as never);
    hookId = hook.id;
    const ENV_KEY = `WEBHOOK_SECRET_${hook.id.slice(0, 8)}`;
    process.env[ENV_KEY] = SECRET;
    try {
      // Record-and-throw: if the transport is reached at all, this fires and says so.
      globalThis.fetch = ((input: unknown): never => {
        calls.push(String(input));
        throw new Error("FETCH INTERCEPTED — recorded and stopped before the socket");
      }) as unknown as typeof globalThis.fetch;

      // THREE attempts configured on purpose. The refusal must be permanent, so the
      // row count below is an assertion about the retry loop as well as about the
      // recording: one row, not one per attempt.
      Date.prototype.toISOString = function (this: Date): string { return PRE_EPOCH; };
      try {
        summary = await dispatchEvent("policy.action.executed", { probe: true },
          { timeoutMs: 1000, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitterFactor: 0 } } as never);
      } catch (error) {
        threw = error;
      } finally {
        Date.prototype.toISOString = realToISOString;
      }
    } finally {
      delete process.env[ENV_KEY];
    }

    // SAID EXACTLY, because this one does NOT discriminate against the defect.
    // `Promise.allSettled` never rejects, so `dispatchEvent` resolved even with the
    // seam unwrapped — measured on 2026-09-02 by removing the wrap: this line stayed
    // green while the six row assertions below went red. It is a guard on
    // dispatchEvent's contract, not evidence the wrap is present. The ROWS are the
    // evidence.
    check("an unsignable delivery does NOT throw out of dispatchEvent — it resolves with a summary",
      threw === undefined && summary !== undefined);
    check("…and the transport is NEVER reached — refused before the socket, not after (spy fired " + calls.length + "x)",
      calls.length === 0);
    check("the summary counts it failed, not suppressed and not succeeded",
      summary?.failed === 1 && summary?.suppressed === 0 && summary?.succeeded === 0);
    check("…and still counts it dispatched — it was attempted",
      summary?.dispatched === 1);

    const logs = await getDeliveryLogs(hookId);
    check(`the signing refusal RECORDS a delivery row (found ${logs.length}) — this is the row that did not exist`,
      logs.length >= 1);
    check(`exactly ONE row per subscribed webhook — the refusal is permanent, not retried (found ${logs.length})`,
      logs.length === 1);
    check("the row is recorded as failed",
      logs[0]?.status === "failed");
    check("the row NAMES WebhookTimestampUnresolvable — the class, so an operator reads what refused",
      (logs[0]?.error ?? "").includes("WebhookTimestampUnresolvable"));
    check("…in the shared wording, not a copy retyped at the call site",
      (logs[0]?.error ?? "").startsWith(WEBHOOK_SIGNING_REFUSED));
    check("…and carries the error's own message, so the reason is diagnosable",
      (logs[0]?.error ?? "").includes("cannot resolve a delivery timestamp to sign"));
    check("NON-VACUITY: the row is NOT the envelope refusal wearing a different name",
      !(logs[0]?.error ?? "").includes("WebhookPayloadSchema"));

    // The permanence is STRUCTURAL — a flag set by the site that knows, not a match
    // on the message text. Driven directly, in both directions.
    check("isPermanentDeliveryError stops the retry loop on a result flagged permanent",
      isPermanentDeliveryError({ success: false, error: "anything", permanent: true }) === true);
    check("NON-VACUITY: the SAME result without the flag is not permanent (the flag is doing the work, not the text)",
      isPermanentDeliveryError({ success: false, error: "anything" }) === false);
  } finally {
    Date.prototype.toISOString = realToISOString;
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

  // ── the v2 scheme, unit-level ──────────────────────────────────────────────
  //
  // WHAT CHANGED AND WHY THIS BLOCK IS NOT WHAT IT WAS. Until 2026-09-02 the header
  // signature was `signPayload(body)` and `X-Webhook-Timestamp` sat OUTSIDE the MAC.
  // The assertions here said so honestly in a comment and asserted nothing about it,
  // which is exactly the shape of an unproven claim: a receiver reading the header
  // would build a replay window on a value an attacker rewrites for free. Measured
  // before the change: 2 distinct timestamps under 1 distinct signature across 3
  // attempts. Both halves are now GATED, not narrated.
  const TS = 1_756_771_200_000; // 2026-09-02T00:00:00.000Z, fixed — nothing here reads a clock.
  const v2 = signTimestampedPayload(payload, secret, TS);

  check("signedMaterial is exactly `${timestampMs}.${body}` — one definition, shared by signer and verifier",
    signedMaterial(TS, payload) === `${TS}.${payload}`);
  check("the v2 signature agrees with an INDEPENDENT HMAC-SHA256 over `${timestamp}.${body}`",
    v2 === createHmac("sha256", secret).update(`${TS}.${payload}`, "utf8").digest("hex"));
  check("…and DIFFERS from the retired v1 signature over the body alone",
    v2 !== signPayload(payload, secret));
  check("moving the timestamp by ONE millisecond changes the signature",
    signTimestampedPayload(payload, secret, TS + 1) !== v2);

  const headers = createSignedHeaders(payload, secret, "delivery-1", "event-1", { timestampMs: TS });
  check(`createSignedHeaders marks the scheme on the wire: ${WEBHOOK_SIGNATURE_SCHEME}=<hex>`,
    headers[WEBHOOK_SIGNATURE_HEADER] === `${WEBHOOK_SIGNATURE_SCHEME}=${v2}`);
  check("…and emits the SAME timestamp it signed, in integer epoch milliseconds",
    headers[WEBHOOK_TIMESTAMP_HEADER] === String(TS));
  check("createSignedHeaders carries the delivery and event ids a receiver dedupes on",
    headers["X-Webhook-Delivery-Id"] === "delivery-1" && headers["X-Webhook-Event-Id"] === "event-1");
  // The signature must cover the BODY and the TIMESTAMP, never the envelope ids.
  // Signing the ids instead would let a captured body be replayed under a fresh
  // delivery id with a signature that still verifies.
  check("the signature is over the timestamp+payload, not the envelope ids (a new delivery id re-signs identically)",
    createSignedHeaders(payload, secret, "delivery-2", "event-2", { timestampMs: TS })[WEBHOOK_SIGNATURE_HEADER]
      === headers[WEBHOOK_SIGNATURE_HEADER]);
  check("…and a changed body changes the header signature, with the ids and timestamp held fixed",
    createSignedHeaders(`${payload} `, secret, "delivery-1", "event-1", { timestampMs: TS })[WEBHOOK_SIGNATURE_HEADER]
      !== headers[WEBHOOK_SIGNATURE_HEADER]);

  // The delivery instant is DERIVED from the payload when no option is threaded —
  // the dispatch path, where buildPayload mints `timestamp` once above the retry loop.
  const stamped = JSON.stringify({ id: "evt-1", timestamp: new Date(TS).toISOString(), data: {} });
  check("payloadTimestampMs reads the payload's own ISO-8601 delivery instant",
    payloadTimestampMs(stamped) === TS);
  check("…and createSignedHeaders uses it when no timestampMs is threaded (stable across calls, no clock read)",
    createSignedHeaders(stamped, secret, "d", "e")[WEBHOOK_TIMESTAMP_HEADER] === String(TS) &&
      createSignedHeaders(stamped, secret, "d", "e")[WEBHOOK_SIGNATURE_HEADER]
        === createSignedHeaders(stamped, secret, "d", "e")[WEBHOOK_SIGNATURE_HEADER]);
  check("payloadTimestampMs returns null for a body with no readable instant (the CALLER decides, it is not 'use now')",
    payloadTimestampMs("not json") === null && payloadTimestampMs(JSON.stringify({ id: "x" })) === null &&
      payloadTimestampMs(JSON.stringify({ timestamp: "never" })) === null &&
      payloadTimestampMs(JSON.stringify([1, 2])) === null);

  // ── NO CLOCK FALLBACK: unresolvable REFUSES ────────────────────────────────
  //
  // Until 2026-09-02 this arm was `?? Date.now()`, and it was the defect this whole
  // scheme closes, reintroduced through the fix's own error path: a payload with an
  // unreadable `timestamp` minted a FRESH instant on every call, and
  // createSignedHeaders is called once per ATTEMPT — so retries diverged again.
  // Nothing watched it: replacing the arm with a constant still passed 164/164.
  // Now it throws, and the refusal is asserted BY NAME rather than by "it threw".
  const refuses = (label: string, run: () => unknown, wanted: string): void => {
    let err: unknown;
    try { run(); } catch (e) { err = e; }
    check(`${label} → refuses with WebhookTimestampUnresolvable`,
      err instanceof WebhookTimestampUnresolvable);
    check(`  …and the reason names ${wanted}`,
      err instanceof Error && err.message.includes(wanted));
  };
  for (const body of ["not json", JSON.stringify({ id: "x" }),
                      JSON.stringify({ timestamp: "not-an-instant" }),
                      JSON.stringify({ timestamp: 12345 })]) {
    refuses(`an UNREADABLE payload instant ${JSON.stringify(body).slice(0, 34)}`,
      () => createSignedHeaders(body, secret, "d", "e"), "no readable ISO-8601");
  }
  // A THREADED-BUT-GARBLED instant refuses too, rather than quietly signing at the
  // payload's instant instead — a caller that names an instant and gets it wrong must
  // hear about it, not receive a valid signature over some other moment.
  for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1756771200000" as never]) {
    refuses(`a GARBLED options.timestampMs ${JSON.stringify(bad) ?? String(bad)}`,
      () => createSignedHeaders(stamped, secret, "d", "e", { timestampMs: bad as number }),
      "options.timestampMs");
  }
  check("…and the garbled-option refusal does NOT quietly fall through to the payload instant",
    (() => { try { createSignedHeaders(stamped, secret, "d", "e", { timestampMs: -1 }); return false; }
             catch { return true; } })());
}

// 7. THE RECEIVER: verifySignedWebhook.
//
//    The reference implementation a receiver ports, driven here as an oracle. `now` is
//    INJECTED at every call — the helper reads no clock, so the entire replay window
//    is exercised deterministically rather than by sleeping.
//
//    NOT WIRED TO ANY INBOUND ROUTE, and this proof is not a claim that it is. Nothing
//    in this repository receives webhooks. What is proven is that the helper refuses
//    every degenerate input, in both directions.
{
  const secret = "r".repeat(32);
  const body = JSON.stringify({ id: "evt-9", type: "siem.event", timestamp: "2026-09-02T00:00:00.000Z" });
  const NOW = 1_756_771_200_000;
  const good = createSignedHeaders(body, secret, "d-9", "e-9", { timestampMs: NOW });
  const TOL = 300_000; // five minutes — must exceed the sender's whole retry envelope.
  const verify = (
    h: Record<string, string | string[] | undefined>,
    b: string,
    now: number,
    extra: { futureSkewMs?: number } = {},
  ) => verifySignedWebhook(h, b, secret, { toleranceMs: TOL, now, ...extra });

  // ACCEPTS — the non-vacuity anchor. Without this every refusal below is satisfied
  // by a helper that returns false unconditionally.
  check("accepts a well-formed delivery at the delivery instant", verify(good, body, NOW).valid === true);
  check("accepts one millisecond inside the tolerance window", verify(good, body, NOW + TOL - 1).valid === true);
  check("accepts exactly AT the tolerance boundary (the window is inclusive, and says so)",
    verify(good, body, NOW + TOL).valid === true);
  check("accepts header names in any case — a receiver reads lowercased headers",
    verify({ "x-webhook-signature": good[WEBHOOK_SIGNATURE_HEADER], "x-webhook-timestamp": good[WEBHOOK_TIMESTAMP_HEADER] },
      body, NOW).valid === true);

  // TOO OLD — the replay window doing its job.
  const stale = verify(good, body, NOW + TOL + 1);
  check("REFUSES a signature one millisecond past the tolerance (the replay window)", stale.valid === false);
  check("…and names the age and the tolerance in the reason",
    stale.reason?.includes("beyond") === true && stale.reason?.includes(String(TOL)) === true);

  // FUTURE — skew defaults to zero, the strictest reading.
  const future = verify(good, body, NOW - 1);
  check("REFUSES a timestamp in the future by default (futureSkewMs defaults to 0)", future.valid === false);
  check("…and accepts it only when the receiver DELIBERATELY allows skew",
    verify(good, body, NOW - 1, { futureSkewMs: 5_000 }).valid === true);

  // ABSENT AND MALFORMED — absent must TIGHTEN, never loosen. A verifier that shrugs
  // at a missing timestamp reproduces the v1 defect exactly: no freshness at all,
  // while reporting success.
  const noTs = verify({ [WEBHOOK_SIGNATURE_HEADER]: good[WEBHOOK_SIGNATURE_HEADER] }, body, NOW);
  check("REFUSES an ABSENT X-Webhook-Timestamp — absence tightens, never loosens", noTs.valid === false);
  check("…and names the missing header", noTs.reason?.includes(WEBHOOK_TIMESTAMP_HEADER) === true);
  check("REFUSES an EMPTY timestamp header",
    verify({ ...good, [WEBHOOK_TIMESTAMP_HEADER]: "" }, body, NOW).valid === false);
  for (const bad of ["not-a-number", "17567712000.5", "-1756771200000", "1756771200000abc", " 1756771200000", "1e12"]) {
    check(`REFUSES a MALFORMED timestamp header ${JSON.stringify(bad)}`,
      verify({ ...good, [WEBHOOK_TIMESTAMP_HEADER]: bad }, body, NOW).valid === false);
  }
  check("REFUSES an ABSENT signature header",
    verify({ [WEBHOOK_TIMESTAMP_HEADER]: good[WEBHOOK_TIMESTAMP_HEADER] }, body, NOW).valid === false);

  // REPEATED headers get their OWN reason. Both spellings previously returned the
  // same null as an absent header, so this assertion was riding the absent branch
  // and pinning a path it was not testing — it passed with the repeat handling
  // deleted. Asserting the DISTINCT reason is what makes it its own path.
  const repTs = verify({ ...good, [WEBHOOK_TIMESTAMP_HEADER]: [String(NOW), String(NOW)] }, body, NOW);
  check("REFUSES a REPEATED timestamp header rather than picking one", repTs.valid === false);
  check("…and says REPEATED, not 'missing' — a distinct reason for a distinct fault",
    repTs.reason === `repeated ${WEBHOOK_TIMESTAMP_HEADER} header`);
  const repSig = verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: [good[WEBHOOK_SIGNATURE_HEADER] ?? "", "v2=x"] }, body, NOW);
  check("REFUSES a REPEATED signature header, with its own reason",
    repSig.valid === false && repSig.reason === `repeated ${WEBHOOK_SIGNATURE_HEADER} header`);
  check("…and 'repeated' is genuinely distinct from 'missing' on the same header",
    verify({ [WEBHOOK_TIMESTAMP_HEADER]: good[WEBHOOK_TIMESTAMP_HEADER] }, body, NOW).reason
      !== repSig.reason);

  // TAMPERED — the MAC doing its job.
  check("REFUSES a timestamp altered by ONE millisecond, signature held fixed",
    verify({ ...good, [WEBHOOK_TIMESTAMP_HEADER]: String(NOW + 1) }, body, NOW + 1).valid === false);
  check("REFUSES a tampered body under a valid timestamp and signature",
    verify(good, `${body} `, NOW).valid === false);
  check("REFUSES a valid delivery under the WRONG secret",
    verifySignedWebhook(good, body, `${secret}x`, { toleranceMs: TOL, now: NOW }).valid === false);
  check("REFUSES when no secret is configured — never accepts by default",
    verifySignedWebhook(good, body, "", { toleranceMs: TOL, now: NOW }).valid === false);

  // NO DUAL-ACCEPT. The retired v1 signature — the body alone, unprefixed — must be
  // refused BY NAME. Accepting both schemes would leave every receiver with no replay
  // protection while reporting success, which is the defect this change closes.
  const v1 = verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: signPayload(body, secret) }, body, NOW);
  check("REFUSES a retired v1 (body-only, unprefixed) signature — no dual-accept", v1.valid === false);
  check("…and names v1 in the reason so an operator upgrades the sender, not the key",
    v1.reason?.includes("v1") === true);
  check("REFUSES a correct v2 hex carrying no scheme marker",
    verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: signTimestampedPayload(body, secret, NOW) }, body, NOW).valid === false);
  check("REFUSES an unrecognised scheme marker",
    verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: `v3=${signTimestampedPayload(body, secret, NOW)}` }, body, NOW).valid === false);
  check("REFUSES a non-hex or wrong-length signature body",
    verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: "v2=deadbeef" }, body, NOW).valid === false &&
      verify({ ...good, [WEBHOOK_SIGNATURE_HEADER]: `v2=${"Z".repeat(64)}` }, body, NOW).valid === false);

  // THE INJECTED CLOCK IS REQUIRED, not defaulted. A helper that fell back to
  // Date.now() would be untestable at the boundary and would read a clock inside a
  // verification path.
  check("REFUSES a caller that supplies no `now` — the clock is injected, never read inside",
    verifySignedWebhook(good, body, secret, { toleranceMs: TOL } as never).valid === false);
  check("REFUSES a negative or non-integer tolerance rather than coercing it",
    verifySignedWebhook(good, body, secret, { toleranceMs: -1, now: NOW }).valid === false &&
      verifySignedWebhook(good, body, secret, { toleranceMs: 1.5, now: NOW }).valid === false);
  check("every refusal states a reason; the acceptance states none",
    verify(good, body, NOW).reason === undefined && stale.reason !== undefined && noTs.reason !== undefined);
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound webhook delivery is gated; dev/alpha never emit and every refusal explains itself.");
