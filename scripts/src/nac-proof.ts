// Proof: NAC (network access control) is read-only and gated.
//
// Two claims, each of which was FALSE before #150's discipline reached this
// family and would silently become false again without a proof:
//
//   1. The NAC surface cannot act on a device. The adapters previously drove
//      Cisco ISE ANC / ClearPass enforcement to cut an endpoint off the network.
//      Those actuators are deleted — from the adapters, the store, and the
//      NACAdapter contract — so no caller can reach one and no new vendor adapter
//      can be written against one.
//   2. A live vendor call is refused unless the tier allows it AND
//      SIGNALGRID_LIVE_INTEGRATIONS is explicitly "true" AND a provider is fully
//      configured. Every other path resolves to fixture WITH A REASON, so
//      "not configured" is never mistaken for "checked and clean".
//
// Pure and offline: resolution is a function of the environment, so this asserts
// the gate itself without contacting any appliance.

import { resolveNacAdapter } from "@workspace/integrations/nac";
import { CiscoISEAdapter } from "@workspace/integrations/nac";
import { ArubaClearPassAdapter } from "@workspace/integrations/nac";

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

// ── 1. No device action is reachable ─────────────────────────────────────────
// Asserted against the prototypes, not the source text: a method that came back
// under a new name would still be caught by "the surface is exactly these".
const REMOVED = [
  "quarantineEndpoint",
  "clearQuarantine",
  "quarantineDevice",
  "unquarantineEndpoint",
  "reauthenticate",
  "disconnectEndpoint",
];
for (const cls of [CiscoISEAdapter, ArubaClearPassAdapter] as const) {
  for (const method of REMOVED) {
    check(
      `${cls.name} has no ${method}() — a device action has no read-only form`,
      typeof (cls.prototype as unknown as Record<string, unknown>)[method] !== "function",
    );
  }
  // Not an allowlist of names — private helpers (ensureAuthenticated, mapStatus)
  // stay on the prototype and are harmless. What must not exist is a method whose
  // NAME denotes acting on a device, so a renamed actuator is caught too.
  // Anchored to the START of the method name. An unanchored substring test
  // false-positives on innocent helpers — `ensureAuthenticated` contains
  // "reAuth" — which would make this assertion fail for the wrong reason and
  // teach the next reader to loosen it.
  const ACTION_SHAPED = /^(quarantine|unquarantine|clearQuarantine|lock|remoteLock|wipe|erase|disconnect|reauthenticate|enforce|isolate)/i;
  const surface = Object.getOwnPropertyNames(cls.prototype)
    .filter((m) => m !== "constructor")
    .filter((m) => typeof (cls.prototype as unknown as Record<string, unknown>)[m] === "function")
    .sort();
  const actionShaped = surface.filter((m) => ACTION_SHAPED.test(m));
  check(
    `${cls.name} exposes no action-shaped method (surface: ${surface.join(", ")})`,
    actionShaped.length === 0,
  );
}

// ── 2. The live path is gated, and every refusal explains itself ─────────────
const LIVE_BASE = {
  SIGNALGRID_TIER: "prod",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  NAC_BASE_URL: "https://nac.example.test",
} as NodeJS.ProcessEnv;

// A fixture resolution must always carry a reason — silence would let a caller
// read "no adapter" as "nothing to report" rather than "we did not look".
function fixtureWithReason(env: NodeJS.ProcessEnv, label: string): void {
  const r = resolveNacAdapter(env);
  check(`${label} → fixture`, r.mode === "fixture");
  check(`${label} → states a reason`, r.mode === "fixture" && r.reason.length > 0);
}

fixtureWithReason({}, "empty environment");
fixtureWithReason({ SIGNALGRID_TIER: "dev", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_PROVIDER: "ise", NAC_BASE_URL: "https://x", NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "tier dev (never live)");
fixtureWithReason({ SIGNALGRID_TIER: "alpha", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_PROVIDER: "ise", NAC_BASE_URL: "https://x", NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "tier alpha (never live)");
fixtureWithReason({ ...LIVE_BASE, SIGNALGRID_LIVE_INTEGRATIONS: "false", NAC_PROVIDER: "ise", NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "live-integrations not 'true'");
fixtureWithReason({ ...LIVE_BASE, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE", NAC_PROVIDER: "ise", NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "live-integrations 'TRUE' (exact match required)");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "ise", NAC_USERNAME: "u", NAC_PASSWORD: "p", NAC_BASE_URL: "" }, "no base URL");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "ise" }, "ISE without credentials");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "ise", NAC_USERNAME: "u" }, "ISE with only a username");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "clearpass" }, "ClearPass without credentials");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "clearpass", NAC_CLIENT_ID: "id" }, "ClearPass with only a client id");
fixtureWithReason({ ...LIVE_BASE, NAC_PROVIDER: "nope", NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "unsupported provider");
fixtureWithReason({ ...LIVE_BASE, NAC_USERNAME: "u", NAC_PASSWORD: "p" }, "no provider named");

// The allow path exists — a gate that can never open is not a gate, it is a wall,
// and this must fail if the resolver stops honoring a fully-configured live env.
const ise = resolveNacAdapter({ ...LIVE_BASE, NAC_PROVIDER: "ise", NAC_USERNAME: "u", NAC_PASSWORD: "p" });
check("fully-configured ISE → live", ise.mode === "live" && ise.provider === "ise");
const cp = resolveNacAdapter({ ...LIVE_BASE, NAC_PROVIDER: "clearpass", NAC_CLIENT_ID: "id", NAC_CLIENT_SECRET: "s" });
check("fully-configured ClearPass → live", cp.mode === "live" && cp.provider === "clearpass");

// …and even a LIVE adapter cannot act on a device.
if (ise.mode === "live") {
  check(
    "a live ISE adapter still exposes no device action",
    REMOVED.every((m) => typeof (ise.adapter as unknown as Record<string, unknown>)[m] !== "function"),
  );
}
if (cp.mode === "live") {
  check(
    "a live ClearPass adapter still exposes no device action",
    REMOVED.every((m) => typeof (cp.adapter as unknown as Record<string, unknown>)[m] !== "function"),
  );
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("failed:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("NAC is read-only (no device action reachable) and its live path is gated.");
