// Emitter-discipline proof — fully OFFLINE and deterministic.
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
import { resolveItsmEmitter, type ItsmEmitterResolution } from "@workspace/integrations/itsm";
import { resolveSiemEmitter } from "@workspace/integrations/siem";
import { resolveSyslogEmitter, SyslogAdapter } from "@workspace/integrations/syslog";
import { resolveTelemetryEmitter } from "@workspace/integrations/telemetry";
import { resolveWebhooksEmitter } from "@workspace/integrations/webhooks";
import { resolveCaepEmitter } from "@workspace/integrations/caep-events";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Emitter-discipline proof");

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
  check(`${fam.name}: the live flag is an exact lowercase 'true' — 'TRUE' does not arm it`,
    noFlag.mode === "fixture");
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
