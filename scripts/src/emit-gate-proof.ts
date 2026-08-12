// Proof: the outbound emitter families cannot send from a non-emitting tier.
//
// SIEM, syslog and telemetry all reach real customer systems — Sentinel/Splunk
// ingest, a syslog collector, and Fleet's live-query endpoint, which POSTs
// arbitrary osquery SQL to real hosts. None of them had a tier gate: an
// operator flag was the only thing standing between a dev process and a
// production SIEM.
//
// Unlike a device actuator (deleted from nac/ and uem/ because "quarantine this
// endpoint" has no read-only form), an emitter has an obviously correct
// disciplined behaviour — send nothing — so these are GATED.
//
// One shared resolver rather than four copies: four copies of a policy is four
// chances for one to drift permissive, and the drifted one is the one that
// ships. This asserts the shared gate AND that each family routes through it.
//
// Pure and offline: the gate is a function of the environment.

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEmission, EMIT_SUPPRESSED } from "@workspace/integrations/emit-gate";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
  const r = resolveEmission(env);
  check(`${label} → suppressed`, r.mode === "suppressed");
  check(`${label} → states a reason`, r.mode === "suppressed" && r.reason.length > 0);
}

// ── 1. Tiers that must never emit ────────────────────────────────────────────
// Each asserted WITH the live flag set to "true", so these pin the TIER check
// rather than passing for the unrelated reason that the flag was unset.
for (const tier of ["dev", "alpha", "test", "staging", "local", ""]) {
  suppressedWithReason(
    { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" },
    `tier "${tier || "(empty)"}" with flag true`,
  );
}
suppressedWithReason({}, "empty environment (defaults to dev)");

// ── 2. Beta/prod still require the explicit flag, matched exactly ────────────
for (const tier of ["beta", "prod"]) {
  suppressedWithReason({ SIGNALGRID_TIER: tier }, `tier "${tier}" without the flag`);
  for (const almost of ["false", "TRUE", "True", "1", "yes", " true", "true "]) {
    suppressedWithReason(
      { SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: almost },
      `tier "${tier}" with flag "${almost}"`,
    );
  }
}

// ── 3. The allow path exists ─────────────────────────────────────────────────
// A gate that can never open is a wall: it would satisfy every assertion above
// while silently breaking every integration in production.
for (const tier of ["beta", "prod", "PROD", "Beta"]) {
  const r = resolveEmission({ SIGNALGRID_TIER: tier, SIGNALGRID_LIVE_INTEGRATIONS: "true" });
  check(`tier "${tier}" + flag true → live`, r.mode === "live");
}

// ── 4. The suppressed status is neither "sent" nor "failed" ─────────────────
// "sent" would be the damaging lie — a compliance reader treats a forwarded
// audit event as delivered. "failed" would invite an operator to chase a
// non-problem. The honest third state says what actually happened.
// Compared through a widened `string`: with the literal type these read as
// tautologies the compiler can discharge, and an assertion that cannot fail
// proves nothing. Widened, they are real runtime guards against someone
// redefining the constant to "sent" — which would restore exactly the lie this
// whole change removes.
const suppressedStatus: string = EMIT_SUPPRESSED;
check("suppressed status is not 'sent'", suppressedStatus !== "sent");
check("suppressed status is not 'failed'", suppressedStatus !== "failed");
check("suppressed status is the literal 'suppressed'", suppressedStatus === "suppressed");

// ── 5. Each family actually ROUTES through the shared gate ──────────────────
// The gate existing proves nothing if a family bypasses it. Asserted against the
// source so a newly-added emitter that forgets the gate is caught here.
const ROUTED: Array<[string, string]> = [
  ["syslog", "lib/integrations/src/integrations/syslog/transport.ts"],
  ["siem/sentinel", "lib/integrations/src/integrations/siem/sentinel.ts"],
  ["siem/splunk", "lib/integrations/src/integrations/siem/splunk.ts"],
  ["siem/webhook", "lib/integrations/src/integrations/siem/webhook.ts"],
  ["telemetry/fleetdm", "lib/integrations/src/integrations/telemetry/fleetdm.ts"],
  ["itsm/adapter", "lib/integrations/src/integrations/itsm/adapter.ts"],
];
for (const [label, rel] of ROUTED) {
  const src = readFileSync(resolve(repo, rel), "utf8");
  check(`${label} imports the shared emit gate`, /from ['"][^'"]*adapters\/emit-gate['"]/.test(src));
  check(`${label} calls resolveEmission()`, /resolveEmission\(/.test(src));
}

// ── 6. syslog no longer claims to have sent what it never sent ──────────────
// It opens no UDP, TCP or TLS socket anywhere; it previously returned
// status 'sent' regardless. That is the single most misleading thing an audit
// forwarder can report. The composed design (both lanes' protections, merged):
// suppressed → the honest `suppressed` status like every other emitter; LIVE —
// where the caller explicitly configured delivery and a quiet status is at its
// most dangerous — the adapter THROWS rather than reporting any status at all.
// proof:emitter-discipline holds the behavioral pin for that throw.
const syslogSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/syslog/transport.ts"), "utf8");
check("syslog opens no socket (still unimplemented)", !/dgram|net\.Socket|tls\.connect/.test(syslogSrc));
check("syslog does not report status 'sent'", !/status:\s*'sent'/.test(syslogSrc));
check("syslog refuses loudly when live: throws rather than reporting a status", /throw new Error\(\s*\n?\s*["']syslog: no transport is implemented/.test(syslogSrc));

// itsm gates at the FACTORY, which every one of its eight vendor adapters passes
// through. Assert the gate runs BEFORE the pre-existing "no credentials" branch:
// placed after it, a fully-configured dev process would still build an adapter.
const itsmSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/itsm/adapter.ts"), "utf8");
const gateAt = itsmSrc.indexOf("resolveEmission(");
const credsAt = itsmSrc.indexOf("const credentials = config.credentials");
check("itsm: the tier gate precedes the credentials branch", gateAt > 0 && credsAt > 0 && gateAt < credsAt);

// ── 7. The four paths that were reaching the network without the gate ───────
// Found by an audit of the boundary in August 2026. Each is asserted the way that
// can actually FAIL: the gate token must appear in the method body BEFORE the
// first outbound call. "The file mentions resolveEmission somewhere" is the
// assertion that let three of these hide — sentinel.ts named the gate in
// sendEvent() while sendEvents() beside it POSTed ungated.
//
// The regex for an outbound call matches any "fetch"-containing callee, because
// the fourth defect here was precisely that: servicenow.ts and jira.ts reach the
// network only through `fetchWithTimeout`, and every check looking for the literal
// `fetch(` skipped them entirely and reported green.
const OUTBOUND_CALL = /(?<![\w$])[\w$]*[Ff]etch[\w$]*\s*\(/;

// Comments are blanked before searching. The first draft of this proof did not do
// that and failed on servicenow.healthCheck() — because the explanatory comment
// ABOVE the gate contains the word "fetch", so the "first outbound call" landed on
// prose. Worth keeping as a note: the failure was in the assertion, not the code,
// and a proof that cannot tell a comment from a call is measuring the wrong thing.
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
          .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/**
 * @param callRe the first OUTBOUND expression for this method. Defaults to a direct
 *   fetch; `nac.lookupEndpoint()` reaches the network by delegating to an adapter it
 *   builds, so it passes the builder instead. Naming the real outbound step per site
 *   keeps each assertion falsifiable rather than approximately true.
 */
function gateBeforeFirstCall(rel: string, methodRe: RegExp, label: string, callRe: RegExp = OUTBOUND_CALL): void {
  const src = stripComments(readFileSync(resolve(repo, rel), "utf8"));
  const m = src.match(methodRe);
  if (!m || m.index === undefined) {
    check(`${label}: method located in source`, false);
    return;
  }
  const body = src.slice(m.index);
  const gateAt = body.search(/resolveEmission\s*\(/);
  // Search AFTER the declaration line, so a method whose own name contains "fetch"
  // does not match itself.
  const afterDecl = body.indexOf("\n");
  const callOffset = body.slice(afterDecl).search(callRe);
  const callAt = callOffset === -1 ? -1 : callOffset + afterDecl;
  check(`${label}: reaches the network at all (assertion is not vacuous)`, callAt > 0);
  check(`${label}: gated BEFORE its first outbound call`, gateAt > 0 && callAt > 0 && gateAt < callAt);
}

gateBeforeFirstCall(
  "lib/integrations/src/integrations/itsm/servicenow.ts",
  /async healthCheck\s*\(/,
  "servicenow.healthCheck()",
);
gateBeforeFirstCall(
  "lib/integrations/src/integrations/itsm/jira.ts",
  /async healthCheck\s*\(/,
  "jira.healthCheck()",
);
gateBeforeFirstCall(
  "lib/integrations/src/integrations/siem/sentinel.ts",
  /async sendEvents\s*\(/,
  "sentinel.sendEvents()",
);
// ── nac: a STRONGER claim than "gated before the call" ─────────────────────
//
// This assertion used to be `gateBeforeFirstCall(nac/store.ts, lookupEndpoint, …,
// getNACAdapter)` — correct for a design where the family owned an HTTP adapter and
// had to decide to be live before constructing it. The launch lane rebuilt nac
// around an INJECTED transport instead, so that assertion no longer describes the
// code: there is no `lookupEndpoint` in the store and no adapter to build.
//
// Rewritten rather than deleted, and rewritten UP. The property now true of nac is
// the one uem already has and the one worth having: the family makes no outbound
// call at all, so there is nothing to gate. Its failure mode is "there is no code",
// which is stronger than "a correctly-ordered flag check".
//
// Kept falsifiable in both directions — a family that reaches the network would
// fail the first check, and a `resolveNacConnector` that stopped refusing an absent
// transport would fail the second.
{
  const NAC_DIR = "lib/integrations/src/integrations/nac";
  const nacFiles = readdirSync(resolve(repo, NAC_DIR)).filter((f) => f.endsWith(".ts"));
  check("nac: the family has source files to check (assertion is not vacuous)", nacFiles.length >= 4);
  const reaching = nacFiles.filter((f) =>
    OUTBOUND_CALL.test(stripComments(readFileSync(resolve(repo, NAC_DIR, f), "utf8"))),
  );
  check(
    `nac: NO file in the family makes an outbound call — nothing to gate (${nacFiles.length} files checked)`,
    reaching.length === 0,
  );
  if (reaching.length) console.error(`    reaching the network: ${reaching.join(", ")}`);

  // And the live path stays unreachable: every condition must hold AND a transport
  // must be injected, which this repository does not ship.
  const idx = stripComments(readFileSync(resolve(repo, NAC_DIR, "index.ts"), "utf8"));
  check(
    "nac: resolveNacConnector refuses live mode without an injected transport",
    /if \(!transportOverride\)/.test(idx) && /mode:\s*"fixture"/.test(idx),
  );
  check(
    "nac: the live path also requires tier + live flag + vendor + token (unanimous, fail-closed)",
    /SIGNALGRID_TIER/.test(idx) &&
      /SIGNALGRID_LIVE_INTEGRATIONS/.test(idx) &&
      /NAC_VENDOR/.test(idx) &&
      /NAC_ACCESS_TOKEN/.test(idx),
  );
}

// mde gates at its single `isEnabled()` choke point, which all five of its outbound
// methods already guard on — so assert the choke point itself, not each caller.
// Asserted as "config flag AND emission gate": returning `config.enabled` alone was
// the defect, and a tenant-controlled value is not a deployment boundary.
const mdeSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/telemetry/mde.ts"), "utf8");
const mdeEnabled = mdeSrc.slice(mdeSrc.indexOf("isEnabled(): boolean"));
const mdeBody = mdeEnabled.slice(0, mdeEnabled.indexOf("\n  }"));
check("mde.isEnabled(): requires the local config flag", /config\?\.enabled/.test(mdeBody));
check("mde.isEnabled(): ALSO requires the emission gate", /resolveEmission\s*\(\)\.mode === ['"]live['"]/.test(mdeBody));
check(
  "mde: every outbound method still routes through isEnabled()",
  (mdeSrc.match(/if \(!this\.isEnabled\(\)\)/g) ?? []).length >= 5,
);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound emitters are gated: dev/alpha never send, every refusal explains itself.");
