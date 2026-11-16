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

test("the unknown tone is visibly unknown, never the old neutral grey", () => {
  // Pinned on the constant itself: comparing a badge's tone to UNKNOWN_SIGNAL_TONE
  // passes whatever that constant holds, so reverting it to grey stayed green.
  assert.match(UNKNOWN_SIGNAL_TONE, /\bborder-dashed\b/);
  assert.doesNotMatch(UNKNOWN_SIGNAL_TONE, /\b(?:text|bg|border)-(?:zinc|slate|gray|neutral|stone)-/);
});

test("a non-string type renders as unknown instead of throwing", () => {
  for (const v of [undefined, null, 7, {}]) {
    const b = signalBadge(v);
    assert.equal(b.known, false, String(v));
    assert.equal(b.tone, UNKNOWN_SIGNAL_TONE, String(v));
    assert.equal(b.label, "unknown", String(v));
  }
});

test("labels replace every hyphen, not just the first", () => {
  assert.equal(signalBadge("operational-signals").label, "operational signals");
});

test("the exported palette is frozen: a caller cannot replace or delete a known tone", () => {
  assert.equal(Object.isFrozen(SIGNAL_BADGE_TONE), true, "SIGNAL_BADGE_TONE is mutable");
  const before = ALL_SIX.map((t) => signalBadge(t).tone);
  const palette = SIGNAL_BADGE_TONE as Record<string, string>;
  // Under ESM strict mode a write to a frozen object throws; either outcome is fine
  // so long as the map is unchanged afterwards.
  try { palette.identity = UNKNOWN_SIGNAL_TONE; } catch { /* refused */ }
  try { delete palette["device-posture"]; } catch { /* refused */ }
  try { palette["badge-reader"] = "text-red-400"; } catch { /* refused */ }
  assert.deepEqual(ALL_SIX.map((t) => signalBadge(t).tone), before, "a known badge changed after mutation");
  for (const t of ALL_SIX) assert.equal(signalBadge(t).known, true, t);
  const u = signalBadge("badge-reader");
  assert.equal(u.known, false);
  assert.equal(u.tone, UNKNOWN_SIGNAL_TONE);
});
