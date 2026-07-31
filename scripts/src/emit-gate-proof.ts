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

import { readFileSync } from "node:fs";
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
// forwarder can report.
const syslogSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/syslog/transport.ts"), "utf8");
check("syslog opens no socket (still unimplemented)", !/dgram|net\.Socket|tls\.connect/.test(syslogSrc));
check("syslog does not report status 'sent'", !/status:\s*'sent'/.test(syslogSrc));
check("syslog reports not_implemented instead", /not_implemented/.test(syslogSrc));

// itsm gates at the FACTORY, which every one of its eight vendor adapters passes
// through. Assert the gate runs BEFORE the pre-existing "no credentials" branch:
// placed after it, a fully-configured dev process would still build an adapter.
const itsmSrc = readFileSync(resolve(repo, "lib/integrations/src/integrations/itsm/adapter.ts"), "utf8");
const gateAt = itsmSrc.indexOf("resolveEmission(");
const credsAt = itsmSrc.indexOf("const credentials = config.credentials");
check("itsm: the tier gate precedes the credentials branch", gateAt > 0 && credsAt > 0 && gateAt < credsAt);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Outbound emitters are gated: dev/alpha never send, every refusal explains itself.");
