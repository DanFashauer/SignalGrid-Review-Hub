// Canonical event-contract proof — fully deterministic, no I/O.
//
// Proves the integration keystone: (1) the fail-closed validator admits a
// well-formed event and REJECTS every malformed variant (missing anchors, bad
// enum/domain, out-of-range battery, bad timestamp, unsafe id, proto pollution),
// dropping unknown fields; and (2) the cross-domain detector fires exactly the
// right detections over a shared-fabric timeline and stays silent on a clean one,
// deterministically.
import {
  detectCrossDomain,
  validateEvent,
  type Detection,
  type SignalGridEvent,
} from "@workspace/event-contract";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

console.log("Canonical event-contract proof");

// ── validator: accept the well-formed ─────────────────────────────────────────
const good = {
  eventType: "checkout_granted",
  eventId: "evt-1",
  occurredAt: "2026-07-20T12:00:00.000Z",
  correlationId: "cust-1",
  tenantId: "tenant_northwind",
  userId: "nurse.compliant",
  deviceId: "ipad-ward-01",
  mdmDeviceState: "compliant",
  batteryPercent: 82,
  chargeState: "charging",
  extraHackerField: { __proto__: { polluted: true } }, // must be dropped
};
const okRes = validateEvent(good);
check("a well-formed event validates", okRes.ok === true);
check(
  "unknown fields are dropped (not copied onto the event)",
  okRes.ok === true && !("extraHackerField" in okRes.event),
);
check("prototype is not polluted", ({} as Record<string, unknown>).polluted === undefined);

// ── validator: reject the malformed ───────────────────────────────────────────
const rejects: Array<[string, unknown]> = [
  ["missing required anchors", { eventType: "badge_access" }],
  ["unknown eventType", { ...good, eventType: "teleport" }],
  ["bad mdmDeviceState", { ...good, mdmDeviceState: "sorta-compliant" }],
  ["battery > 100", { ...good, batteryPercent: 150 }],
  ["battery < 0", { ...good, batteryPercent: -1 }],
  ["non-ISO occurredAt", { ...good, occurredAt: "yesterday" }],
  ["unsafe id (whitespace/newline)", { ...good, userId: "a b\nc" }],
  ["non-object input", "not-an-event"],
];
for (const [name, input] of rejects) {
  const r = validateEvent(input);
  check(`rejects: ${name}`, r.ok === false && r.errors.length > 0);
}

// ── detector: cross-domain detections over one timeline ────────────────────────
let seq = 0;
const ev = (over: Partial<SignalGridEvent> & Pick<SignalGridEvent, "eventType">): SignalGridEvent => ({
  eventId: `e${(seq += 1)}`,
  occurredAt: "2026-07-20T12:00:00.000Z",
  correlationId: "cust-1",
  tenantId: "tenant_northwind",
  ...over,
});
const codes = (ds: Detection[]): Set<string> => new Set(ds.map((d) => d.code));

// Each malformed-fabric timeline fires its detection:
check(
  "CHECKOUT_WITHOUT_COMPLIANCE fires when a grant never becomes compliant",
  codes(detectCrossDomain([ev({ eventType: "checkout_granted" })])).has("CHECKOUT_WITHOUT_COMPLIANCE"),
);
check(
  "REMOVED_WITHOUT_BADGE_ACCESS fires on removal with no badge-in",
  codes(detectCrossDomain([ev({ eventType: "device_removed" })])).has("REMOVED_WITHOUT_BADGE_ACCESS"),
);
check(
  "LEFT_PREMISES_WITHOUT_RETURN fires when a device goes offline and never returns",
  codes(detectCrossDomain([ev({ eventType: "reachability_changed", carrierConnectivityState: "offline" })])).has("LEFT_PREMISES_WITHOUT_RETURN"),
);
const tamperTimeline = detectCrossDomain([
  ev({ eventType: "tamper_detected", tamperState: "confirmed" }),
  ev({ eventType: "reachability_changed", carrierConnectivityState: "offline" }),
]);
check(
  "DOCK_TAMPER_WITH_NETWORK_LOSS fires (critical) on tamper + connectivity loss",
  codes(tamperTimeline).has("DOCK_TAMPER_WITH_NETWORK_LOSS") &&
    tamperTimeline.find((d) => d.code === "DOCK_TAMPER_WITH_NETWORK_LOSS")?.severity === "critical",
);
check(
  "INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE fires when unmanaged in MDM but badging in",
  codes(detectCrossDomain([
    ev({ eventType: "posture_changed", mdmDeviceState: "unmanaged" }),
    ev({ eventType: "badge_access" }),
  ])).has("INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE"),
);

// A clean, well-behaved custody timeline fires NOTHING.
const clean = detectCrossDomain([
  ev({ eventType: "checkout_granted" }),
  ev({ eventType: "posture_changed", mdmDeviceState: "compliant" }),
  ev({ eventType: "device_removed" }),
  ev({ eventType: "badge_access" }),
  ev({ eventType: "device_returned" }),
]);
check("a clean custody timeline yields NO detections", clean.length === 0);

// Determinism: identical timeline ⇒ identical detections.
const t = [
  ev({ eventType: "checkout_granted" }),
  ev({ eventType: "reachability_changed", carrierConnectivityState: "offline" }),
];
check(
  "detector is deterministic (identical detections for identical input)",
  JSON.stringify(detectCrossDomain(t)) === JSON.stringify(detectCrossDomain(t)),
);
check("empty timeline yields no detections", detectCrossDomain([]).length === 0);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
