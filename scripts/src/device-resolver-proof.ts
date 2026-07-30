// Device-identity resolver proof — OFFLINE and deterministic.
//
// THIS FILE HAD NO PROOF AT ALL, which is how three defects lived in it undisturbed
// while the connectors around it were being hardened:
//
//   1. `nacAdapters: Map<string, any>` — so the read-only `NACAdapter` interface,
//      narrowed when the quarantine actuators were deleted, was NOT enforced at the
//      one call site that consumes it. The narrowing documented a contract that
//      nothing checked.
//   2. `resolveFromUEM` swallowed every error with a bare `catch { return null }`,
//      and `null` here means "no such device" — so an unreachable UEM rendered as a
//      confident denial of the device's existence.
//   3. `resolveFromNAC` had no catch at all, so identical vendor outages either
//      returned null or crashed the resolver depending on which source ran first.
//
// The adversarial review that found (1) called it out precisely: the interface
// narrowing "is NOT enforced at the one call site that matters". A type that nothing
// tests is a comment with syntax highlighting.

import { adapterTypes as _adapterTypes, deviceResolver } from "@workspace/integrations";
import type { NACAdapter, NACEndpointInfo, UEMAdapter } from "@workspace/integrations/adapters/types";

const { DeviceIdentityResolver, actuatorMethodsOn } = deviceResolver;
void _adapterTypes;

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Device-resolver proof — read-only at the boundary, faults audible\n");

const endpoint: NACEndpointInfo = {
  endpointId: "ep-1", macAddress: "aa:bb:cc:dd:ee:01", status: "unknown",
};
// Matches on the IDENTIFIER, not merely on the lookup kind. An earlier version
// ignored the identifier and returned the endpoint for any `mac` lookup, which made
// the "unmatched identifier returns null" assertion fail — correctly, because the
// stub was answering a question it had not been asked. A stub that always says yes
// cannot test a path that depends on it sometimes saying no.
const reader: NACAdapter = {
  name: "ise", vendor: "cisco",
  lookupEndpoint: async (id, type) =>
    type === "mac" && id === endpoint.macAddress ? endpoint : null,
};

// ── 1. THE BOUNDARY REFUSES AN ACTUATOR ──────────────────────────────────────
//
// TypeScript cannot stop this: structural typing means an object with
// `lookupEndpoint` AND `quarantineEndpoint` satisfies NACAdapter, and excess-property
// checking never applies to a value arriving through a variable — which is how every
// real adapter arrives. So the check has to exist at runtime, at injection.
{
  const withActuator = {
    ...reader,
    quarantineEndpoint: async () => ({ ok: true }),
  } as unknown as NACAdapter;

  check("an adapter carrying a quarantine method is REFUSED at injection",
    (() => {
      try { new DeviceIdentityResolver().addNACAdapter("bad", withActuator); return false; }
      catch (e) { return e instanceof Error && e.message.includes("quarantineEndpoint"); }
    })());
  check("...and the refusal names the offending method, so the fix is obvious",
    (() => {
      try { new DeviceIdentityResolver().addNACAdapter("bad", withActuator); return false; }
      catch (e) { return e instanceof Error && e.message.includes("device-action"); }
    })());
  // TYPE-LEVEL PROOF THAT THE TYPE IS NOT ENOUGH. This object satisfies NACAdapter
  // structurally — it has every member the interface requires — and would have been
  // accepted silently by the old `Map<string, any>` AND by a correctly-typed map.
  check("...and that adapter DOES satisfy NACAdapter structurally — which is the whole point",
    typeof withActuator.lookupEndpoint === "function" &&
    actuatorMethodsOn(withActuator).length === 1);

  // Every actuator name is caught, not just the one that happened to be in the review.
  check("every known device-action method is caught, not merely quarantineEndpoint",
    (["lockDevice", "wipeDevice", "eraseDevice", "sendCommand", "disconnectEndpoint"] as const)
      .every((m) => actuatorMethodsOn({ ...reader, [m]: async () => {} }).length === 1));
  // A non-function property of the same name is NOT an actuator — a normalizer may
  // legitimately carry a string field describing one, and banning vocabulary rather
  // than capability was a false-positive lesson learned twice already in this repo.
  check("a non-function property of the same name is NOT treated as an actuator",
    actuatorMethodsOn({ ...reader, quarantineEndpoint: "described, not callable" }).length === 0);
  check("a non-object is handled without throwing",
    actuatorMethodsOn(null).length === 0 && actuatorMethodsOn("x").length === 0);

  // CONSTRUCTOR INJECTION GOES THROUGH THE SAME GUARD. A check that only one of two
  // entry points performs is a check with a door beside it.
  check("the CONSTRUCTOR path is guarded too, not just addNACAdapter",
    (() => {
      try {
        new DeviceIdentityResolver({ nacAdapters: new Map([["bad", withActuator]]) });
        return false;
      } catch (e) { return e instanceof Error && e.message.includes("quarantineEndpoint"); }
    })());

  // Non-vacuity: a legitimate read-only adapter must still be accepted, or the guard
  // is just "refuse everything" wearing a costume.
  check("a read-only adapter is ACCEPTED — the guard is not refuse-everything",
    (() => { new DeviceIdentityResolver().addNACAdapter("good", reader); return true; })());
  check("an adapter with no lookupEndpoint is refused too — it would fail silently at decision time",
    (() => {
      try {
        new DeviceIdentityResolver().addNACAdapter("useless", { name: "x", vendor: "y" } as unknown as NACAdapter);
        return false;
      } catch (e) { return e instanceof Error && e.message.includes("lookupEndpoint"); }
    })());
}

// ── 2. FAULTS ARE AUDIBLE, AND THE TWO SOURCES AGREE ─────────────────────────
//
// An earlier draft of this section asserted on a function reference rather than
// awaiting it, so the check could not fail. Removed rather than patched: an assertion
// that cannot fail is the exact defect this session has been chasing, and leaving a
// tidied-up version of one in the proof that hunts them would be its own watermelon.
// The real coverage is below, awaited.
await (async () => {
  const faults: string[] = [];
  const throwingUem = {
    name: "intune", vendor: "microsoft",
    getDeviceState: async () => { throw new Error("upstream 503"); },
  } as unknown as UEMAdapter;
  const throwingNac: NACAdapter = {
    name: "ise", vendor: "cisco",
    lookupEndpoint: async () => { throw new Error("ise unreachable"); },
  };

  const uemFaulted = new DeviceIdentityResolver({ uemAdapter: throwingUem, onFault: (m) => faults.push(m) });
  await uemFaulted.resolve("dev-1");
  check("a UEM fault is reported with its cause",
    faults.some((f) => f.includes("503") && f.includes("UEM")));

  faults.length = 0;
  const nacFaulted = new DeviceIdentityResolver({ onFault: (m) => faults.push(m) });
  nacFaulted.addNACAdapter("ise", throwingNac);
  const out = await nacFaulted.resolve("dev-2");
  check("a NAC fault is reported too — the two paths now behave the SAME",
    faults.some((f) => f.includes("unreachable") && f.includes("NAC")));
  check("...and a throwing NAC adapter no longer crashes the resolver",
    out === null || out.source !== undefined);

  faults.length = 0;
  const working = new DeviceIdentityResolver({ onFault: (m) => faults.push(m) });
  working.addNACAdapter("ise", reader);
  const found = await working.resolve("aa:bb:cc:dd:ee:01");
  check("a working NAC lookup still resolves, and reports NO fault",
    found?.macAddress === "aa:bb:cc:dd:ee:01" && found?.source === "nac" && faults.length === 0);
  check("...and an unmatched identifier returns null WITHOUT reporting a fault — absence is not an error",
    (await working.resolve("aa:bb:cc:dd:ee:99")) === null && faults.length === 0);
})();

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
