// Emitter-discipline proof — OFFLINE and deterministic, with ONE stated exception.
//
// THE EXCEPTION, named rather than buried: the header-injection assertion (§5b of
// the wire section) uses the REAL `fetch` against `https://collector.invalid`,
// because the behaviour being pinned is UNDICI's — a CR/LF header value is rejected
// while the Headers object is built, before any socket or DNS lookup — and a stubbed
// fetch would be asserting the stub. `.invalid` is the reserved TLD (RFC 2606), so
// even if that rejection ever stopped happening the call resolves nothing.
// Everything else runs against a recording `globalThis.fetch`.
//
// The five outbound emitter families (itsm, siem, syslog, telemetry, webhooks)
// were this repository's longest-standing KNOWN_GAPS: real delivery code with no
// tier gate, listed by the connector-discipline gate as "ungated-emitter" since
// the gate existed. This proof closes the gap by asserting, for EVERY family,
// the same unanimous fail-closed gate every read-only connector already has:
//
//   dev/alpha never emit — regardless of every other env var;
//   beta/prod without SIGNALGRID_LIVE_INTEGRATIONS=true → fixture;
//   ...without the family credential → fixture;
//   ...with EVERYTHING set but no injected transport → fixture, because this
//   repository ships none. The live path's failure mode is "there is no code".
//
// And the half that matters most, given how this family's story started: the
// FIXTURE EMITTER NEVER CLAIMS DELIVERY. syslog once returned status:'sent' for
// events it had silently dropped. The fixture record type carries a literal
// `delivered: false` — the unearned affirmative is unrepresentable, and this
// proof pins it at runtime for every family anyway, because a type assertion
// alone is erased at the boundary the wire crosses.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveItsmEmitter, type ItsmEmitterResolution, GenericWebhookAdapter } from "@workspace/integrations/itsm";
import { WebhookSIEMAdapter } from "@workspace/integrations/siem";
import { SIGNING_SECRET_MISSING } from "@workspace/integrations/emit-gate/signing";
import { credentialAbsentReason } from "@workspace/integrations/emit-gate";
import { resolveSiemEmitter } from "@workspace/integrations/siem";
import { resolveSyslogEmitter, SyslogAdapter } from "@workspace/integrations/syslog";
import { resolveTelemetryEmitter } from "@workspace/integrations/telemetry";
import { resolveWebhooksEmitter } from "@workspace/integrations/webhooks";
import { resolveCaepEmitter } from "@workspace/integrations/caep-events";
import { REDIRECT_REFUSED } from "@workspace/integrations/emit-gate/redirect";
import { WEBHOOK_URL_REFUSALS } from "@workspace/integrations/emit-gate/url-guard";
import { ITSM_WEBHOOK_REFUSALS } from "@workspace/integrations/itsm";
import { verifySignedWebhook } from "@workspace/integrations/webhooks";
import { VENDOR_ERROR_TEXT_LIMIT } from "@workspace/integrations/emit-gate/bounded-text";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Emitter-discipline proof");

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface FamilyUnderTest {
  name: string;
  tokenVar: string;
  resolve: (env: NodeJS.ProcessEnv, transport?: (p: Record<string, unknown>) => Promise<void>) => {
    mode: string;
    reason?: string;
    emitter?: { record(p: Record<string, unknown>): { seq: number; delivered: false; mode: string }; entries(): readonly unknown[] };
    deliver?: unknown;
  };
}

const FAMILIES: FamilyUnderTest[] = [
  { name: "itsm", tokenVar: "ITSM_EMITTER_TOKEN", resolve: resolveItsmEmitter },
  { name: "siem", tokenVar: "SIEM_EMITTER_TOKEN", resolve: resolveSiemEmitter },
  { name: "syslog", tokenVar: "SYSLOG_EMITTER_TOKEN", resolve: resolveSyslogEmitter },
  { name: "telemetry", tokenVar: "TELEMETRY_EMITTER_TOKEN", resolve: resolveTelemetryEmitter },
  { name: "webhooks", tokenVar: "WEBHOOKS_EMITTER_TOKEN", resolve: resolveWebhooksEmitter },
  { name: "caep", tokenVar: "CAEP_EMITTER_TOKEN", resolve: resolveCaepEmitter },
];

// ── F7: the family list is DERIVED, not hand-kept ───────────────────────────
//
// FAMILIES above is a hand-written list, and it has to be: these are STATIC
// IMPORTS of six differently-typed resolve functions, which no directory walk can
// produce. What a walk CAN do is refuse to let the list fall behind — a seventh
// emitter family added tomorrow joins neither this proof nor emit-gate-proof's
// ROUTED_FAMILIES, and both would keep printing green over five-sixths of the
// tree. So the membership is derived and COMPARED, and a mismatch fails here.
//
// The derivation rule is the definition: a directory under integrations/ is an
// emitter family iff its resolve.ts imports createEmitterResolver.
{
  const FAMILY_ROOT = "lib/integrations/src/integrations";
  const derived = readdirSync(resolve(repo, FAMILY_ROOT), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      try {
        return /createEmitterResolver/.test(readFileSync(resolve(repo, FAMILY_ROOT, name, "resolve.ts"), "utf8"));
      } catch {
        return false;
      }
    })
    .sort();
  // FLOOR first: a derivation that matched nothing would agree with an empty
  // asserted list and report the agreement as coverage.
  check(`derived: at least six emitter families exist in the tree (found ${derived.length})`, derived.length >= 6);
  const asserted = FAMILIES.map((f) => (f.name === "caep" ? "caep-events" : f.name)).sort();
  check(
    `derived: the asserted family set EQUALS the derived one (asserted ${asserted.join(",")} / derived ${derived.join(",")})`,
    JSON.stringify(asserted) === JSON.stringify(derived),
  );
  check(
    `derived: the count this proof reports in figures= is the derived count (${FAMILIES.length})`,
    FAMILIES.length === derived.length,
  );
}

const noopTransport = async (): Promise<void> => {};

for (const fam of FAMILIES) {
  const armed: NodeJS.ProcessEnv = {
    SIGNALGRID_TIER: "beta",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    [fam.tokenVar]: "tok",
  };

  // The gate, clause by clause. Each check flips exactly ONE condition off a
  // fully-armed environment, so a pass is attributable to the clause it names.
  const dev = fam.resolve({ ...armed, SIGNALGRID_TIER: "dev" }, noopTransport);
  check(`${fam.name}: dev tier never emits, even fully armed with an injected transport`,
    dev.mode === "fixture" && (dev.reason ?? "").includes("never makes live vendor calls"));
  const noFlag = fam.resolve({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE" }, noopTransport);
  // The REASON, not just the mode. `mode === "fixture"` is satisfied by refusing for
  // ANY of the four clauses — so this assertion passed while proving nothing about
  // the flag it names. Five of the six families would still have satisfied it if the
  // flag check had been deleted and the token check caught the call instead.
  check(`${fam.name}: the live flag is an exact lowercase 'true' — 'TRUE' does not arm it`,
    noFlag.mode === "fixture" && (noFlag.reason ?? "") === "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  const noToken = fam.resolve({ ...armed, [fam.tokenVar]: "   " }, noopTransport);
  check(`${fam.name}: a whitespace-only credential reads as absent → fixture`,
    noToken.mode === "fixture" && (noToken.reason ?? "").includes(fam.tokenVar));
  const noTransport = fam.resolve(armed, undefined);
  check(`${fam.name}: EVERYTHING set but no injected transport → fixture ("this repository ships none")`,
    noTransport.mode === "fixture" && (noTransport.reason ?? "").includes("ships none"));
  const live = fam.resolve(armed, noopTransport);
  check(`${fam.name}: the live mode exists and carries exactly the INJECTED transport — the repo adds nothing to it`,
    live.mode === "live" && live.deliver === noopTransport);

  // The fixture emitter: deterministic recording, and delivery unclaimable.
  const fixture = fam.resolve({}, undefined);
  if (fixture.mode !== "fixture" || !fixture.emitter) {
    check(`${fam.name}: empty env resolves to a fixture emitter`, false);
  } else {
    check(`${fam.name}: empty env resolves to a fixture emitter`, true);
    const a = fixture.emitter.record({ probe: 1 });
    const b = fixture.emitter.record({ probe: 2 });
    check(`${fam.name}: fixture records are sequenced deterministically (no clock, no randomness)`,
      a.seq === 1 && b.seq === 2 && fixture.emitter.entries().length === 2);
    check(`${fam.name}: a fixture record can NEVER claim delivery — delivered:false and mode:'fixture' on every entry`,
      a.delivered === false && b.delivered === false && a.mode === "fixture");
  }
}

// ── family-specific honesty pins ────────────────────────────────────────────────
// syslog is the family whose lie started this: the raw adapter must still THROW
// rather than pretend — the gate stands beside that refusal, it does not soften it.
// The adapter now routes through the shared emit gate first (like siem/telemetry/
// itsm), so the pin is proven where it matters most: with live delivery FULLY
// CONFIGURED (beta tier + the flag exactly "true"), the adapter still refuses
// loudly rather than reporting any status for an event that never left the process.
const adapter = new SyslogAdapter({ host: "collector.local", protocol: "udp", format: "cef" });
const probeEvent = { type: "session.probe", severity: "high", timestamp: "2026-07-30T00:00:00.000Z", details: { probe: true } } as never;
const savedTier = process.env.SIGNALGRID_TIER;
const savedLive = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
process.env.SIGNALGRID_TIER = "beta";
process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
let syslogThrew = false;
try {
  await adapter.sendEvent(probeEvent);
} catch (err) { syslogThrew = err instanceof Error && err.message.includes("no transport is implemented"); }
if (savedTier === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedTier;
if (savedLive === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedLive;
check("syslog: with live delivery fully configured, the raw adapter still THROWS rather than reporting 'sent' for an event that never left the process",
  syslogThrew);
// And when the gate suppresses (this proof's scrubbed env), the adapter reports
// the honest shared `suppressed` status — never 'sent', never a throw the caller
// could mistake for breakage when policy simply forbids emission.
const suppressed = await adapter.sendEvent(probeEvent);
check("syslog: under a suppressing env the adapter reports status 'suppressed', never 'sent'",
  (suppressed as { status?: string }).status === "suppressed");

// ── F1: an absent signing secret REFUSES; it never sends unsigned ────────────
//
// Both adapters wrote `if (this.config.signingSecret) { ...sign... }`, with the
// secret defaulted to '' in the constructor. So on the LIVE path an adapter with
// no secret skipped the signature and POSTed anyway — and siem/webhook.ts returned
// status 'sent' for it. webhooks/dispatch.ts has refused exactly this case, in
// exactly these words, since it was written; the two paths simply disagreed.
//
// Asserted with the boundary FULLY OPEN (beta + flag exactly "true"), because that
// is the only configuration in which the defect could fire — at any other tier the
// emit gate stops the call first and the assertion would pass for the wrong reason.
// Neither call reaches the network: both refuse before the fetch.
{
  const savedT = process.env.SIGNALGRID_TIER;
  const savedL = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  process.env.SIGNALGRID_TIER = "beta";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  try {
    for (const [label, secret] of [["absent", undefined], ["empty", ""], ["whitespace-only", "   "]] as ReadonlyArray<readonly [string, string | undefined]>) {
      const siem = new WebhookSIEMAdapter({ url: "https://collector.invalid/ingest", method: "POST", signingSecret: secret });
      const res = await siem.sendEvent({ type: "session.probe", severity: "high", timestamp: "2026-09-02T00:00:00.000Z" } as never);
      check(`siem/webhook: live boundary open + ${label} signing secret → NOT 'sent'`, res.status !== "sent");
      // WHICH LAYER REFUSES CHANGED ON 2026-09-02, and the assertion follows the code
      // rather than the code following the assertion. The signing secret IS this
      // adapter's gate credential — it is the only secret in WebhookSIEMConfig — so
      // since `resolveEmission` began requiring the caller to name its credential, an
      // absent one is refused by the GATE, one layer earlier, before a URL is resolved.
      // Both refusals name the same field, and neither sends: the claim held here is
      // unchanged (nothing goes out unsigned, and the caller is told which field is
      // missing), so both wordings are accepted and nothing else is.
      const reason = (res as { reason?: string }).reason ?? "";
      check(`siem/webhook: live boundary open + ${label} signing secret → refusal names the missing secret`,
        reason === SIGNING_SECRET_MISSING || reason === credentialAbsentReason("SIEM webhook signingSecret"));
      check(`siem/webhook: live boundary open + ${label} signing secret → the refusal is not silent`,
        reason.length > 0);

      const itsm = new GenericWebhookAdapter({
        url: "https://hooks.invalid/x",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        bodyTemplate: '{"t":"{{title}}"}',
        signingSecret: secret,
      });
      let threw = "";
      try {
        await itsm.createTicket({ title: "t", description: "d", severity: "high" } as never);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      check(`itsm/generic-webhook: live boundary open + ${label} signing secret → refuses rather than POSTing unsigned`,
        threw === SIGNING_SECRET_MISSING);
    }
    // NON-VACUITY: with a secret, the refusal is no longer about signing. Driven with
    // the boundary CLOSED (dev tier) on purpose — with it open this call would reach
    // the network, and a proof that makes a network call is not offline. What it
    // establishes is the same thing either way: the refusal above is about the
    // secret, not something this adapter would have said regardless.
    process.env.SIGNALGRID_TIER = "dev";
    const signed = new GenericWebhookAdapter({
      url: "https://hooks.invalid/x",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      bodyTemplate: '{"t":"{{title}}"}',
      signingSecret: "s".repeat(32),
    });
    let signedErr = "";
    try {
      await signed.createTicket({ title: "t", description: "d", severity: "high" } as never);
    } catch (err) {
      signedErr = err instanceof Error ? err.message : String(err);
    }
    check("itsm/generic-webhook: WITH a secret the refusal is no longer about signing (not always-refuse)",
      signedErr !== SIGNING_SECRET_MISSING);
  } finally {
    if (savedT === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedT;
    if (savedL === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedL;
  }
}

// ── THE WIRE, for the two webhook-shaped emitters ────────────────────────────
//
// Everything above asks whether a call was ALLOWED. This section asks what happens
// on the wire once it is, and every assertion here corresponds to a defect measured
// on this tree on 2026-09-02:
//
//   · a 307 from the configured host delivered the full SIGNED body to whatever
//     origin its `Location` named — `validateWebhookUrl` guards the FIRST hop only,
//     and the adapter reported `sent`;
//   · both families signed with `X-Signature` over the BODY ALONE plus
//     `X-Signing-Algorithm` — scheme v1, which this repository's own
//     `verifySignedWebhook` refuses BY NAME as replayable;
//   · both POSTed to `config.url` with no SSRF guard, while one sat in webhooks/;
//   · a 5 MB vendor error body travelled whole into `SIEMEventResponse.reason`;
//   · `await response.json() as { access_token: string }` produced `Bearer undefined`.
//
// DRIVEN THROUGH A RECORDING `globalThis.fetch`, the same idiom as
// `scripts/src/webhooks-proof.ts`: no socket opens, the adapter's real code runs, and
// the proof observes the request rather than reasoning about it. The `redirect:
// 'manual'` OPTION itself is held lexically by `scripts/check-ungated-fetch.mjs`;
// what is driven here is what the adapter DOES with a 3xx, which is the half a
// lexical scan cannot see.
{
  const realFetch = globalThis.fetch;
  const savedT = process.env.SIGNALGRID_TIER;
  const savedL = process.env.SIGNALGRID_LIVE_INTEGRATIONS;
  process.env.SIGNALGRID_TIER = "beta";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  const SECRET = "s".repeat(32);
  const EVENT_AT = "2026-09-02T00:00:00.000Z";
  try {
    // ---- 1. a 3xx is refused by name, once, and never followed -----------------
    {
      const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
      globalThis.fetch = ((input: unknown, init?: Record<string, unknown>) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Promise.resolve(
          new Response(null, { status: 307, headers: { location: "https://exfil.invalid/collect?q=1" } }),
        );
      }) as unknown as typeof globalThis.fetch;

      const siem = new WebhookSIEMAdapter({ url: "https://collector.invalid/ingest", method: "POST", signingSecret: SECRET });
      const res = await siem.sendEvent({ type: "session.probe", severity: "high", timestamp: EVENT_AT } as never);
      const reason = (res as { reason?: string }).reason ?? "";
      check("siem/webhook: a 307 from the configured collector is NOT reported as sent", res.status === "failed");
      check("siem/webhook: the refusal NAMES the redirect rather than reading as a generic transport error",
        reason.startsWith(REDIRECT_REFUSED) && reason.includes("307"));
      check("siem/webhook: the refusal carries the Location HOST and not the attacker's full URL",
        reason.includes("exfil.invalid") && !reason.includes("/collect?q=1"));
      // PERMANENT BY CONSTRUCTION: one attempt, not three. Retrying re-fetches the
      // same 3xx from the same configured host, and three retries of a redirect is
      // three chances to be re-routed.
      check("siem/webhook: a refused redirect is PERMANENT — exactly one attempt, no retry storm", calls.length === 1);
      check("siem/webhook: the request that was made asked the transport NOT to follow",
        calls[0]?.init.redirect === "manual");
    }

    // ---- 2. scheme v2, and only v2, on both webhook-shaped families ------------
    {
      const seen: Array<{ headers: Record<string, string>; body: string }> = [];
      globalThis.fetch = ((_input: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
        seen.push({ headers: init?.headers ?? {}, body: String(init?.body ?? "") });
        return Promise.resolve(new Response(JSON.stringify({ id: "TCK-1" }), { status: 200 }));
      }) as unknown as typeof globalThis.fetch;

      const siem = new WebhookSIEMAdapter({ url: "https://collector.invalid/ingest", method: "POST", signingSecret: SECRET });
      await siem.sendEvent({ type: "session.probe", severity: "high", timestamp: EVENT_AT } as never);
      const itsm = new GenericWebhookAdapter({
        url: "https://hooks.invalid/x", method: "POST",
        headers: { "Content-Type": "application/json" },
        bodyTemplate: '{"t":"{{title}}"}', signingSecret: SECRET,
      });
      await itsm.createTicket({ title: "t", description: "d", severity: "high" } as never);

      check("both webhook-shaped families reached the wire once each", seen.length === 2);
      for (const [i, label] of [[0, "siem/webhook"], [1, "itsm/generic-webhook"]] as ReadonlyArray<readonly [number, string]>) {
        const h = seen[i]?.headers ?? {};
        check(`${label}: the retired v1 headers are GONE from the wire`,
          h["X-Signature"] === undefined && h["X-Signing-Algorithm"] === undefined);
        check(`${label}: carries a v2-marked signature`, (h["X-Webhook-Signature"] ?? "").startsWith("v2="));
        check(`${label}: carries the timestamp the MAC covers`, /^[0-9]+$/.test(h["X-Webhook-Timestamp"] ?? ""));
        // THE ORACLE, not a re-implementation: this repository's own receiver-side
        // verifier reconstructs `${timestamp}.${body}` and must accept it. A proof
        // that recomputed the HMAC itself would pass against two consistent bugs.
        const v = verifySignedWebhook(h, seen[i]?.body ?? "", SECRET, {
          toleranceMs: 10 * 60 * 1000,
          now: Number(h["X-Webhook-Timestamp"]),
        });
        check(`${label}: the signature VERIFIES under this repository's own v2 verifier`, v.valid === true);
        const tampered = verifySignedWebhook(
          { ...h, "X-Webhook-Timestamp": String(Number(h["X-Webhook-Timestamp"]) + 1) },
          seen[i]?.body ?? "", SECRET, { toleranceMs: 10 * 60 * 1000, now: Number(h["X-Webhook-Timestamp"]) + 1 },
        );
        check(`${label}: moving the timestamp by ONE ms breaks the signature — it is inside the MAC`,
          tampered.valid === false);
      }
      // The SIEM instant is the EVENT's, derived rather than re-minted, so a retry
      // cannot give one delivery two signatures.
      check("siem/webhook: the signed timestamp IS the event's own instant, not a fresh clock read",
        seen[0]?.headers["X-Webhook-Timestamp"] === String(Date.parse(EVENT_AT)));
    }

    // ---- 3. an operator-supplied endpoint is validated -------------------------
    {
      let reached = 0;
      globalThis.fetch = (() => { reached += 1; return Promise.resolve(new Response("", { status: 200 })); }) as unknown as typeof globalThis.fetch;
      const siem = new WebhookSIEMAdapter({ url: "https://169.254.169.254/latest/meta-data/", method: "POST", signingSecret: SECRET });
      const res = await siem.sendEvent({ type: "session.probe", severity: "high", timestamp: EVENT_AT } as never);
      // HTTPS ON PURPOSE, so it is the ADDRESS rule being tested and not the scheme
      // rule. `http://169.254.169.254/...` refuses too — for the earlier reason — and
      // an assertion satisfied by the wrong clause is not holding the clause it names.
      check("siem/webhook: a link-local target is REFUSED, and the refusal names the range",
        res.status === "failed" && (res as { reason?: string }).reason === WEBHOOK_URL_REFUSALS.privateRange);
      check("siem/webhook: nothing reached the transport at all", reached === 0);

      const itsm = new GenericWebhookAdapter({
        url: "https://127.0.0.1:9/x", method: "POST",
        headers: { "Content-Type": "application/json" },
        bodyTemplate: '{"t":"{{title}}"}', signingSecret: SECRET,
      });
      let threw = "";
      try { await itsm.createTicket({ title: "t", description: "d", severity: "high" } as never); }
      catch (err) { threw = err instanceof Error ? err.message : String(err); }
      check("itsm/generic-webhook: a loopback target is REFUSED before the fetch",
        threw.includes(WEBHOOK_URL_REFUSALS.loopback) && reached === 0);

      // SPLUNK HEC, the field the first version of this batch left REPORTED. Measured
      // against a real socket on 2026-09-02: `hecUrl` of `http://127.0.0.1:<port>` at
      // prod + live POSTed the whole event, HEC token in the Authorization header, to
      // loopback and returned `sent`. https:// here so the ADDRESS rule is what fires
      // rather than the scheme rule.
      const { SplunkAdapter } = await import("@workspace/integrations/siem");
      const splunk = new SplunkAdapter({ hecUrl: "https://127.0.0.1:8088", hecToken: "tok-abc" });
      const sres = await splunk.sendEvent({ type: "access.denied", severity: "critical", timestamp: EVENT_AT } as never);
      check("siem/splunk: a loopback hecUrl is REFUSED, naming the loopback rule",
        sres.status === "failed" && (sres as { reason?: string }).reason === WEBHOOK_URL_REFUSALS.loopback);
      check("siem/splunk: …and nothing reached the transport", reached === 0);
      check("siem/splunk: healthCheck refuses the same target rather than probing it",
        (await splunk.healthCheck()) === false && reached === 0);
    }

    // ---- 4. a hostile vendor error body is bounded where it is read ------------
    {
      const HUGE = "A".repeat(5_000_000);
      globalThis.fetch = (() => Promise.resolve(new Response(HUGE, { status: 400 }))) as unknown as typeof globalThis.fetch;
      const siem = new WebhookSIEMAdapter({ url: "https://collector.invalid/ingest", method: "POST", signingSecret: SECRET });
      const res = await siem.sendEvent({ type: "session.probe", severity: "high", timestamp: EVENT_AT } as never);
      const reason = (res as { reason?: string }).reason ?? "";
      check("siem/webhook: a 5 MB vendor error body does not travel whole into the response reason",
        reason.length < VENDOR_ERROR_TEXT_LIMIT + 200);
      check("siem/webhook: …and the truncation is STATED rather than silent", reason.includes("truncated"));
    }

    // ---- 5. a vendor token is checked, not cast --------------------------------
    {
      globalThis.fetch = ((input: unknown) =>
        Promise.resolve(
          String(input).includes("oauth_token.do")
            ? new Response(JSON.stringify({ ok: true }), { status: 200 })
            : new Response(JSON.stringify({ result: { sys_id: "a".repeat(32), number: "INC1", state: "1", sys_created_on: "2026-01-01 00:00:00" } }), { status: 201 }),
        )) as unknown as typeof globalThis.fetch;
      const { ServiceNowAdapter } = await import("@workspace/integrations/itsm");
      const sn = new ServiceNowAdapter({
        instanceUrl: "https://vendor.invalid", table: "incident",
        auth: { type: "oauth", clientId: "cid", clientSecret: "csecret" },
      } as never);
      let threw = "";
      try { await sn.createTicket({ title: "t", description: "d", severity: "high", category: "security" } as never); }
      catch (err) { threw = err instanceof Error ? err.message : String(err); }
      check("servicenow: an OAuth 200 carrying no access_token REFUSES instead of sending `Bearer undefined`",
        threw.includes("access_token"));
    }
    // ---- 5b. a header undici refuses is PERMANENT, not transient -------------
    //
    // A VERIFIED NEGATIVE, PINNED. A CR/LF in a header value is rejected by undici
    // BEFORE the socket opens (`TypeError: Headers.append: … is an invalid header
    // value`) — so header injection was never possible here, and that is worth
    // holding rather than assuming. What WAS wrong is what happened next: both
    // adapters' catch arms retried it, so an unchanged string was re-offered to an
    // unchanged library three times with backoff in between, and the operator was
    // told the vendor was unreachable rather than that the header was malformed.
    //
    // Driven with the REAL fetch on purpose: the rejection is undici's, and a stub
    // would be asserting the stub. No socket opens and no name is resolved — the
    // throw happens while building the Headers object.
    {
      globalThis.fetch = realFetch;
      const siem = new WebhookSIEMAdapter({
        url: "https://collector.invalid/ingest", method: "POST", signingSecret: SECRET,
        retryPolicy: { maxAttempts: 3, initialDelayMs: 5_000, maxDelayMs: 5_000, backoffMultiplier: 1 },
      });
      const startedAt = Date.now();
      const res = await siem.sendEvent({
        type: "session.probe", severity: "high", timestamp: EVENT_AT,
        correlationId: "evt\r\nX-Injected: 1",
      } as never);
      const elapsed = Date.now() - startedAt;
      const reason = (res as { reason?: string }).reason ?? "";
      check("siem/webhook: a CR/LF header value is refused before the socket (undici, not us)",
        res.status === "failed" && /invalid header value/i.test(reason));
      check("siem/webhook: …and it is PERMANENT — no retry, so well under one 5s backoff",
        reason.startsWith("permanent:") && elapsed < 5_000);
    }

    // ---- 5c. a missing vendor instant refuses BY NAME ------------------------
    //
    // `new Date(data.result.sys_created_on).toISOString()` threw a bare
    // `RangeError: Invalid time value` when the vendor omitted the field. It failed
    // CLOSED, which is right, and failed UNNAMED, which is not: the caller learned
    // nothing about which field was absent. The refusal now names it.
    {
      globalThis.fetch = ((input: unknown) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ result: { sys_id: "b".repeat(32), number: "INC9", state: "1" } }),
            { status: 201 },
          ),
        )) as unknown as typeof globalThis.fetch;
      const { ServiceNowAdapter } = await import("@workspace/integrations/itsm");
      const sn = new ServiceNowAdapter({
        instanceUrl: "https://vendor.invalid", table: "incident",
        auth: { type: "api_token", username: "u", apiToken: "tok" },
      } as never);
      let threw = "";
      try { await sn.createTicket({ title: "t", description: "d", severity: "high", category: "security" } as never); }
      catch (err) { threw = err instanceof Error ? err.message : String(err); }
      check("servicenow: a create response missing sys_created_on refuses NAMING the field",
        threw.includes("sys_created_on"));
      check("servicenow: …and not as a bare RangeError", !/^Invalid time value/.test(threw));
    }

    // ---- 6. a vendor id may not choose which resource we write to ------------
    //
    // MEASURED 2026-09-02: `getSysIdByNumber` returned the vendor's `sys_id`
    // unvalidated and `updateTicket` interpolated it into a REST path unencoded, so a
    // response whose id was `../../../../api/now/table/sys_user/<32 hex>` produced a
    // PATCH that NORMALISED — `fetch` resolves `..` before the request leaves — to the
    // user table. The adapter believed it was updating an incident.
    {
      const urls: string[] = [];
      globalThis.fetch = ((input: unknown, init?: { method?: string }) => {
        urls.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input).includes("sysparm_query=number=")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ result: [{ sys_id: `../../../../api/now/table/sys_user/${"6".repeat(32)}` }] }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ result: { sys_id: "a".repeat(32), number: "N", state: "1", sys_updated_on: "2026-01-01 00:00:00" } }), { status: 200 }),
        );
      }) as unknown as typeof globalThis.fetch;
      const { ServiceNowAdapter } = await import("@workspace/integrations/itsm");
      const sn = new ServiceNowAdapter({
        instanceUrl: "https://vendor.invalid", table: "incident",
        auth: { type: "api_token", username: "u", apiToken: "tok" },
      } as never);
      let threw = "";
      try { await sn.updateTicket("INC0001", { description: "note" } as never); }
      catch (err) { threw = err instanceof Error ? err.message : String(err); }
      check("servicenow: a traversal-shaped sys_id from the vendor is REFUSED by name",
        threw.includes("32 hexadecimal"));
      check("servicenow: …and no PATCH was ever issued", urls.every((u) => !u.startsWith("PATCH")));
      check("servicenow: …and sys_user was never addressed", urls.every((u) => !u.includes("sys_user")));
    }

  } finally {
    globalThis.fetch = realFetch;
    if (savedT === undefined) delete process.env.SIGNALGRID_TIER; else process.env.SIGNALGRID_TIER = savedT;
    if (savedL === undefined) delete process.env.SIGNALGRID_LIVE_INTEGRATIONS; else process.env.SIGNALGRID_LIVE_INTEGRATIONS = savedL;
  }
}

// Determinism: two identical resolutions produce identical fixture logs.
const r1 = resolveItsmEmitter({}, undefined);
const r2 = resolveItsmEmitter({}, undefined);
if (r1.mode === "fixture" && r2.mode === "fixture") {
  r1.emitter.record({ x: 1 });
  r2.emitter.record({ x: 1 });
  check("emitters are deterministic: identical inputs yield identical fixture logs",
    JSON.stringify(r1.emitter.entries()) === JSON.stringify(r2.emitter.entries()));
} else {
  check("emitters are deterministic: identical inputs yield identical fixture logs", false);
}

const total = passed + failures.length;
console.log(`figures=families=${FAMILIES.length},gateClausesPerFamily=4,fixtureRecordsNeverDelivered=1`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
