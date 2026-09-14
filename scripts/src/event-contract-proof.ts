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
  type DetectionCode,
  type DetectionSeverity,
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

// Additive optional field: a valid badgeAuthOutcome is PRESERVED through the allowlist
// (a downstream consumer — the break-glass badge→manual fallback — depends on this), and
// an out-of-domain value is rejected fail-closed.
{
  const withOutcome = validateEvent({ ...good, eventType: "badge_access", badgeAuthOutcome: "failure" });
  check(
    "badgeAuthOutcome is validated and preserved through the allowlist",
    withOutcome.ok === true && withOutcome.event.badgeAuthOutcome === "failure",
  );
  const badOutcome = validateEvent({ ...good, eventType: "badge_access", badgeAuthOutcome: "maybe" });
  check("rejects: out-of-domain badgeAuthOutcome", badOutcome.ok === false);
}

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
//
// Every check below pins the WHOLE outcome of a timeline: the exact detections, in
// order, and for each one its severity, correlation id, evidence event ids and
// reason TEXT. Absence is pinned the same way — an expectation of `[]` asserts that
// nothing fires, which is what fails when one clause of an `&&` is deleted.
//
// That shape is deliberate. Two adversarial reviews planted mutants against this
// detector — a clause dropped from an `&&`, a widened event-type match, the
// evidence set gutted to `[events[0].eventId]`, the reason replaced with
// "Everything is fine." — and 10 of 12 SURVIVED a fully green run, because the
// checks only asked whether a code appeared somewhere in the result. A detection's
// reason and its evidence ARE the operator-facing deliverable; a check that never
// reads them cannot fail when they are gutted.

/** The reason strings, verbatim, so a reworded, emptied or reassuring reason fails
 *  this proof instead of passing it. */
const REASONS: Record<DetectionCode, string> = {
  CHECKOUT_WITHOUT_COMPLIANCE: "A device was checked out but no compliant posture was ever observed for it.",
  REMOVED_WITHOUT_BADGE_ACCESS:
    "A device was removed from its bay with no corresponding badge access into an authorized zone.",
  LEFT_PREMISES_WITHOUT_RETURN:
    "The device went offline or its custody lapsed and no return event was ever recorded.",
  DOCK_TAMPER_WITH_NETWORK_LOSS: "Tamper was detected while the device also lost connectivity.",
  INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE:
    "The device is unmanaged/unknown in MDM but is still active on cellular or badging in.",
  // Added during the replay, not when this table was written. `Record<DetectionCode,
  // string>` is a COMPLETE map by type, and #720 landed CUSTODY_STALE_OR_CONTESTED on
  // mainline after this PR was cut — so the table went silently incomplete and
  // expectExactly compared against `undefined`. Copied verbatim from detect.ts rather
  // than paraphrased: a proof that quotes an approximation of the reason string is not
  // pinning the string.
  CUSTODY_STALE_OR_CONTESTED:
    "Custody is stale or contested: the dock, checkout and posture planes disagree on who holds the device or whether it is seated.",
};

const ev = (
  eventId: string,
  over: Partial<SignalGridEvent> & Pick<SignalGridEvent, "eventType">,
): SignalGridEvent => ({
  eventId,
  occurredAt: "2026-07-20T12:00:00.000Z",
  correlationId: "cust-1",
  tenantId: "tenant_northwind",
  ...over,
});

// Kept for the CUSTODY_STALE_OR_CONTESTED block ported from #720 below. The
// expectExactly assertions this PR introduces are stricter and are the right shape
// for new coverage; this set-membership helper stays only so the detection that
// already landed on mainline keeps its proof rather than losing it to a rewrite.
const codes = (ds: Detection[]): Set<string> => new Set(ds.map((d) => d.code));

/** Everything a consumer of a detection actually reads, on one line. */
const render = (d: Detection): string =>
  `${d.code}|${d.severity}|${d.correlationId}|${d.evidenceEventIds.join(",")}|${d.reason}`;

type Expected = [DetectionCode, DetectionSeverity, string[]];

const expectExactly = (
  name: string,
  timeline: SignalGridEvent[],
  want: Expected[],
  correlationId = "cust-1",
): void => {
  const got = detectCrossDomain(timeline).map(render);
  const wanted = want.map(
    ([code, severity, evidence]) => `${code}|${severity}|${correlationId}|${evidence.join(",")}|${REASONS[code]}`,
  );
  const ok = got.length === wanted.length && got.every((line, i) => line === wanted[i]);
  check(name, ok);
  if (!ok) {
    console.log(`      want: ${JSON.stringify(wanted)}`);
    console.log(`      got:  ${JSON.stringify(got)}`);
  }
};

// 1. CHECKOUT_WITHOUT_COMPLIANCE — EVERY grant is evidence and nothing else is; a
//    `noncompliant` posture is not a compliant one.
//
// TWO detections, and the second one is why this assertion changed during the replay.
// As originally written this expected CHECKOUT_WITHOUT_COMPLIANCE alone, and that was
// correct when it was written. #720 then landed CUSTODY_STALE_OR_CONTESTED on
// mainline, which fires on the same shape — a second grant with no clearing return is
// a contested custody — so the timeline now produces both. Measured rather than
// assumed, by driving detectCrossDomain directly on exactly these events:
//
//     CHECKOUT_WITHOUT_COMPLIANCE   high   evidence=[g1,g2]
//     CUSTODY_STALE_OR_CONTESTED    high   evidence=[g1,g2]
//
// Naming both keeps the assertion EXACT. Dropping to a membership check would have
// made it pass while no longer pinning what the fabric emits, which is the whole
// property this rewrite exists to establish.
expectExactly(
  "grants that never became compliant → exactly CHECKOUT_WITHOUT_COMPLIANCE + CUSTODY_STALE_OR_CONTESTED, evidence = both grants",
  [
    ev("g1", { eventType: "checkout_granted" }),
    ev("p1", { eventType: "posture_changed", mdmDeviceState: "noncompliant" }),
    ev("g2", { eventType: "checkout_granted" }),
  ],
  [
    ["CHECKOUT_WITHOUT_COMPLIANCE", "high", ["g1", "g2"]],
    ["CUSTODY_STALE_OR_CONTESTED", "high", ["g1", "g2"]],
  ],
);

// 2. REMOVED_WITHOUT_BADGE_ACCESS — a `dock_unlocked` is not a removal. The
//    correlation id is the timeline's own, not a constant.
expectExactly(
  "removals with no badge-in → exactly REMOVED_WITHOUT_BADGE_ACCESS, evidence = both removals",
  [
    ev("r1", { eventType: "device_removed", correlationId: "cust-9" }),
    ev("u1", { eventType: "dock_unlocked", correlationId: "cust-9" }),
    ev("r2", { eventType: "device_removed", correlationId: "cust-9" }),
  ],
  [["REMOVED_WITHOUT_BADGE_ACCESS", "high", ["r1", "r2"]]],
  "cust-9",
);

// 3. LEFT_PREMISES_WITHOUT_RETURN — offline evidence first, then the custody
//    lapses. `idle` is not offline, and only a reachability_changed event asserts
//    connectivity at all.
expectExactly(
  "offline + non_return + custody_expired, never returned → exactly LEFT_PREMISES_WITHOUT_RETURN",
  [
    ev("o1", { eventType: "reachability_changed", carrierConnectivityState: "offline" }),
    ev("i1", { eventType: "reachability_changed", carrierConnectivityState: "idle" }),
    ev("p9", { eventType: "posture_changed", carrierConnectivityState: "offline" }),
    ev("n1", { eventType: "non_return" }),
    ev("x1", { eventType: "custody_expired" }),
  ],
  [["LEFT_PREMISES_WITHOUT_RETURN", "high", ["o1", "n1", "x1"]]],
);

// 4. DOCK_TAMPER_WITH_NETWORK_LOSS — critical, riding alongside the exit detection
//    the same offline event raises. `tamperState: "none"` is not tamper.
for (const state of ["suspected", "confirmed"] as const) {
  expectExactly(
    `tamper (${state}) + connectivity loss → LEFT_PREMISES_WITHOUT_RETURN, then a CRITICAL DOCK_TAMPER_WITH_NETWORK_LOSS`,
    [
      ev("t1", { eventType: "tamper_detected", tamperState: state }),
      ev("t2", { eventType: "tamper_detected", tamperState: "none" }),
      ev("o1", { eventType: "reachability_changed", carrierConnectivityState: "offline" }),
    ],
    [
      ["LEFT_PREMISES_WITHOUT_RETURN", "high", ["o1"]],
      ["DOCK_TAMPER_WITH_NETWORK_LOSS", "critical", ["t1", "o1"]],
    ],
  );
}

// 5. INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE — dark is unmanaged OR unknown; alive is a
//    badge-in OR online OR idle; `compliant` is neither, and an event that is not a
//    reachability_changed does not become alive by carrying a connectivity state.
expectExactly(
  "unmanaged in MDM while badging in → exactly INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE, evidence = dark then alive",
  [
    ev("d1", { eventType: "posture_changed", mdmDeviceState: "unmanaged" }),
    ev("n1", { eventType: "posture_changed", mdmDeviceState: "noncompliant" }),
    ev("b1", { eventType: "badge_access" }),
    ev("c1", { eventType: "posture_changed", mdmDeviceState: "compliant", carrierConnectivityState: "online" }),
  ],
  [["INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE", "high", ["d1", "b1"]]],
);
for (const alive of ["online", "idle"] as const) {
  expectExactly(
    `unknown in MDM while ${alive} on cellular → exactly INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE`,
    [
      ev("d1", { eventType: "posture_changed", mdmDeviceState: "unknown" }),
      ev("a1", { eventType: "reachability_changed", carrierConnectivityState: alive }),
    ],
    [["INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE", "high", ["d1", "a1"]]],
  );
}

// ── silence: the other half of every conjunction ──────────────────────────────
expectExactly(
  "a clean custody timeline fires NOTHING (grant became compliant; removal carried a badge-in)",
  [
    ev("c1", { eventType: "checkout_granted" }),
    ev("c2", { eventType: "posture_changed", mdmDeviceState: "compliant" }),
    ev("c3", { eventType: "device_removed" }),
    ev("c4", { eventType: "badge_access" }),
    ev("c5", { eventType: "device_returned" }),
  ],
  [],
);
expectExactly(
  "an offline device that WAS returned fires nothing, and offline is not 'active elsewhere'",
  [
    ev("d1", { eventType: "posture_changed", mdmDeviceState: "unmanaged" }),
    ev("o1", { eventType: "reachability_changed", carrierConnectivityState: "offline" }),
    ev("rt", { eventType: "device_returned" }),
  ],
  [],
);
expectExactly(
  "tamper with no loss of connectivity fires nothing",
  [ev("t1", { eventType: "tamper_detected", tamperState: "confirmed" })],
  [],
);

// ── CUSTODY_STALE_OR_CONTESTED (landed on mainline in #720) ──────────────────
// Carried across the falsifiability rewrite rather than dropped. #720's detection
// is ON MAINLINE; taking this PR's side of the conflict wholesale would have left a
// live detection with no proof covering it, which is the failure this file exists to
// prevent. Ported to the explicit-id `ev(id, over)` signature this PR introduces —
// the ids are deliberate here, because evidence event ids are what expectExactly
// asserts on and auto-generated ones cannot be named.
// CUSTODY_STALE_OR_CONTESTED — a custody-state contradiction across the dock / MAM
// (checkout) / posture planes ("phantom custody"). Fires on any of three shapes, and
// stays silent on a legitimately returned-and-racked device.
check(
  "CUSTODY_STALE_OR_CONTESTED fires when a device is granted again with no clearing return (contested)",
  codes(detectCrossDomain([
    ev("cs1", { eventType: "checkout_granted" }),
    ev("cs2", { eventType: "checkout_granted" }),
  ])).has("CUSTODY_STALE_OR_CONTESTED"),
);
check(
  "CUSTODY_STALE_OR_CONTESTED fires when the dock re-locks around a still-checked-out device (stale)",
  codes(detectCrossDomain([
    ev("cs3", { eventType: "checkout_granted" }),
    ev("cs4", { eventType: "dock_relocked" }),
  ])).has("CUSTODY_STALE_OR_CONTESTED"),
);
check(
  "CUSTODY_STALE_OR_CONTESTED fires when a seated device is unpaired/unknown in posture (phantom slot)",
  codes(detectCrossDomain([
    ev("cs5", { eventType: "dock_relocked" }),
    ev("cs6", { eventType: "posture_changed", mdmDeviceState: "unknown" }),
  ])).has("CUSTODY_STALE_OR_CONTESTED"),
);
{
  const contested = detectCrossDomain([
    ev("cs7", { eventType: "checkout_granted" }),
    ev("cs8", { eventType: "checkout_granted" }),
  ]);
  const d = contested.find((x) => x.code === "CUSTODY_STALE_OR_CONTESTED");
  check(
    "CUSTODY_STALE_OR_CONTESTED is high severity and carries evidence (fail-closed: raises assurance)",
    d?.severity === "high" && (d?.evidenceEventIds.length ?? 0) > 0,
  );
}
// Negative control: a legitimately returned-and-racked device must NOT fire it, so an
// always-on detection cannot pass this proof.
check(
  "CUSTODY_STALE_OR_CONTESTED stays silent when the device was properly returned and racked",
  !codes(detectCrossDomain([
    ev("cs9", { eventType: "checkout_granted" }),
    ev("cs10", { eventType: "posture_changed", mdmDeviceState: "compliant" }),
    ev("cs11", { eventType: "device_returned" }),
    ev("cs12", { eventType: "dock_relocked" }),
  ])).has("CUSTODY_STALE_OR_CONTESTED"),
);

// CUSTODY_CAP_BLOCKED_BY_STALE_RETURN — the per-user checkout cap refused a new checkout
// because a PRIOR custody never cleared (surfaced today only as an opaque dock beep). Fires
// on a `checkout_denied` seen against an unresolved prior custody, in each of its shapes, and
// stays silent when there is no stale prior — a bare denial or a properly returned prior.
check(
  "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN fires when a checkout is denied with a prior grant never returned",
  codes(detectCrossDomain([
    ev({ eventType: "checkout_granted" }),
    ev({ eventType: "checkout_denied" }),
  ])).has("CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"),
);
check(
  "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN fires when a checkout is denied with a prior non_return on record",
  codes(detectCrossDomain([
    ev({ eventType: "non_return" }),
    ev({ eventType: "checkout_denied" }),
  ])).has("CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"),
);
check(
  "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN fires when a checkout is denied with a prior custody_expired on record",
  codes(detectCrossDomain([
    ev({ eventType: "custody_expired" }),
    ev({ eventType: "checkout_denied" }),
  ])).has("CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"),
);
{
  const capBlocked = detectCrossDomain([
    ev({ eventType: "checkout_granted" }),
    ev({ eventType: "checkout_denied" }),
  ]);
  const d = capBlocked.find((x) => x.code === "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN");
  check(
    "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN is high severity and carries evidence (fail-closed: raises assurance)",
    d?.severity === "high" && (d?.evidenceEventIds.length ?? 0) > 0,
  );
}
// Fail-closed edge: an ABSENT device_returned must be read as "still out", so the same
// prior-grant timeline WITH a return does NOT fire — proving the return, not its absence,
// is what clears the cap.
check(
  "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN stays silent when the prior custody was properly returned before the denial",
  !codes(detectCrossDomain([
    ev({ eventType: "checkout_granted" }),
    ev({ eventType: "device_returned" }),
    ev({ eventType: "checkout_denied" }),
  ])).has("CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"),
);
// Negative control: a bare denial with NO prior open custody is not attributed to a stale
// return (its cause is unproven), so an always-on detection cannot pass this proof.
check(
  "CUSTODY_CAP_BLOCKED_BY_STALE_RETURN stays silent on a bare denial with no prior open custody",
  !codes(detectCrossDomain([
    ev({ eventType: "checkout_denied" }),
  ])).has("CUSTODY_CAP_BLOCKED_BY_STALE_RETURN"),
);

// A clean, well-behaved custody timeline fires NOTHING.
const clean = detectCrossDomain([
  ev("cs13", { eventType: "checkout_granted" }),
  ev("cs14", { eventType: "posture_changed", mdmDeviceState: "compliant" }),
  ev("cs15", { eventType: "device_removed" }),
  ev("cs16", { eventType: "badge_access" }),
  ev("cs17", { eventType: "device_returned" }),
]);
check("a clean custody timeline yields NO detections", clean.length === 0);


// ── pinned silence: what a per-timeline detector cannot see ──────────────────
// The silences above are the other half of a conjunction — the detector looked and
// found the exonerating event. These two are different: there is nothing to look
// at. Every rule here is set membership over ONE correlation timeline, so no
// userId, deviceId or dock slot ever reaches a predicate.
//
// Stated precisely, because the loose version is false: both a slot axis and a
// per-user cap axis DO exist in this repo —
// `lib/integrations/src/integrations/rtls-custody/custody-ledger.ts` defines
// `SlotState` ("seated" | "absent" | "unknown") and `CapState`, and grades the
// phantom at `ledgerState === "checked_out" && slotState === "seated"` →
// `CUSTODY_STALE_RETURN_OWN`/`_OTHER`. What does not exist is any path from a
// SignalGridEvent[] to that judgement: `evaluateCustodyLedger` grades a supplied
// snapshot, nothing derives such a snapshot from a timeline, and `detect.ts` has
// no equivalent of either axis. The gap is the wiring, not the idea.
//
// Pinned as [] so the day either axis reaches the event fabric it lands as a
// failing check and a diff to this file rather than as behaviour that moved
// quietly. If you are here because one went red: that is the intended signal —
// update the fixture to the detections you now expect, do not revert the detector.
//
// Each event is validated first: a silence caused by malformed input would be a
// false finding, not a gap.

// The device is physically back in its bay (device_removed, then dock_relocked)
// but no device_returned ever closed the grant, so the fabric still believes u1
// holds dev-a while the next request is denied. This is the "phantom custody"
// shape docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md calls the most-cited
// operational pain. Nothing fires: rule 1 saw a compliant posture, rule 2 saw the
// badge-in, and rules 3-5 need an offline, a lapse, a tamper or a dark MDM state,
// none of which a phantom produces.
const PHANTOM_CHECKOUT: SignalGridEvent[] = [
  ev("p1", { eventType: "posture_changed", mdmDeviceState: "compliant", deviceId: "dev-a" }),
  ev("g1", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-a" }),
  ev("rm1", { eventType: "device_removed", deviceId: "dev-a" }),
  ev("b1", { eventType: "badge_access", userId: "u1" }),
  ev("rl1", { eventType: "dock_relocked", deviceId: "dev-a" }),
  ev("d1", { eventType: "checkout_denied", userId: "u1", deviceId: "dev-b" }),
];

// Three devices granted, ONE compliant posture, and that posture names no device.
// Rule 1 asks whether the timeline contains any compliant posture at all, so this
// single event exonerates dev-a, dev-b and dev-c alike — yet only one device was
// ever observed compliant. The detector stays silent on the two that were not, and
// had it fired, its own reason ("no compliant posture was ever observed for it")
// could not have been true of all three. Per-device posture coverage is the axis
// missing here; a cap is NOT: `cap_reached` is graded `restrict` in custody-ledger
// as the policy working, and detect.ts firing on a grant count would be inventing
// a tenant cap the event contract does not carry.
const POSTURE_COVERS_EVERY_DEVICE: SignalGridEvent[] = [
  ev("p1", { eventType: "posture_changed", mdmDeviceState: "compliant" }),
  ev("g1", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-a" }),
  ev("g2", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-b" }),
  ev("g3", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-c" }),
];

check(
  "both gap timelines are well-formed events (the silence is a gap, not a rejection)",
  [...PHANTOM_CHECKOUT, ...POSTURE_COVERS_EVERY_DEVICE].every((e) => validateEvent(e).ok),
);
// UPDATED DURING THE REPLAY, exactly as the block above instructs: "update the
// fixture to the detections you now expect, do not revert the detector." #720 landed
// CUSTODY_STALE_OR_CONTESTED on mainline after this PR was cut, and it fires on
// precisely this shape — a dock re-lock around a still-open grant. The silence this
// pinned is PARTLY CLOSED, which is the good outcome the pin existed to notice.
//
// What is still open, and why the surrounding prose stands: the detection fires from
// the dock/checkout disagreement on ONE correlation timeline. It still carries no
// slot axis and no per-device posture axis, which is what the two fixtures below
// demonstrate — they fire the same single detection whether the devices were each
// observed compliant or not. The gap narrowed; it did not close.
expectExactly(
  "a grant left open while the device sits back in its bay now fires CUSTODY_STALE_OR_CONTESTED (#720 closed this one)",
  PHANTOM_CHECKOUT,
  [["CUSTODY_STALE_OR_CONTESTED", "high", ["rl1", "g1"]]],
);
expectExactly(
  "one undirected compliant posture still exonerates three granted devices — no per-device posture axis",
  POSTURE_COVERS_EVERY_DEVICE,
  [["CUSTODY_STALE_OR_CONTESTED", "high", ["g1", "g2", "g3"]]],
);
// And the tell that the silence carries no information: a timeline where each
// granted device really was observed compliant is byte-identical in outcome. The
// detector cannot distinguish the sound case from the unsound one.
expectExactly(
  "per-device compliant postures yield the SAME single detection — the two cases are still indistinguishable",
  [
    ev("p1", { eventType: "posture_changed", mdmDeviceState: "compliant", deviceId: "dev-a" }),
    ev("p2", { eventType: "posture_changed", mdmDeviceState: "compliant", deviceId: "dev-b" }),
    ev("p3", { eventType: "posture_changed", mdmDeviceState: "compliant", deviceId: "dev-c" }),
    ev("g1", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-a" }),
    ev("g2", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-b" }),
    ev("g3", { eventType: "checkout_granted", userId: "u1", deviceId: "dev-c" }),
  ],
  [["CUSTODY_STALE_OR_CONTESTED", "high", ["g1", "g2", "g3"]]],
);

// Determinism: identical timeline ⇒ identical detections.
const t = [
  ev("t1", { eventType: "tamper_detected", tamperState: "confirmed" }),
  ev("o1", { eventType: "reachability_changed", carrierConnectivityState: "offline" }),
];
check(
  "detector is deterministic (identical detections for identical input)",
  JSON.stringify(detectCrossDomain(t)) === JSON.stringify(detectCrossDomain(t)),
);
expectExactly("empty timeline yields no detections", [], []);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
