import test from "node:test";
import assert from "node:assert/strict";
import { SIGNAL_BADGE_TONE, UNKNOWN_SIGNAL_TONE, signalBadge } from "./signal-tone.ts";

// Spelled out rather than imported: the generated enum is not loadable under
// plain node, and a list typed here is the assertion that the map covers it.
const ALL_SIX = ["identity", "device-posture", "session-context", "operational-signals", "physical-access", "network-posture"];

test("every signal type the Signals page filters on has its own tone", () => {
  for (const t of ALL_SIX) {
    const b = signalBadge(t);
    assert.equal(b.known, true, `${t} fell through to the unknown tone`);
    assert.notEqual(b.tone, UNKNOWN_SIGNAL_TONE, t);
  }
  assert.equal(new Set(Object.values(SIGNAL_BADGE_TONE)).size, ALL_SIX.length, "two types share a tone");
});

test("an unrecognised type renders AS unknown, never as an ordinary signal", () => {
  for (const t of ["badge-reader", "physical_access", "", "toString", "__proto__"]) {
    const b = signalBadge(t);
    assert.equal(b.known, false, t);
    assert.equal(b.tone, UNKNOWN_SIGNAL_TONE, t);
    assert.match(b.label, /^unknown/, t);
    assert.ok(!Object.values(SIGNAL_BADGE_TONE).includes(b.tone), t);
  }
});

test("labels replace every hyphen, not just the first", () => {
  assert.equal(signalBadge("operational-signals").label, "operational signals");
});
