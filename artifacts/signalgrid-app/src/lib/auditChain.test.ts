import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChain, chainAlert } from "./auditChain.ts";

test("a whole, intact in-memory chain is verified", () => {
  const c = normalizeChain({ valid: true, brokenAtSeq: null, length: 7, truncated: false, evictedCount: 0 });
  assert.deepEqual(c, { valid: true, partial: false, unverified: null, brokenAtSeq: null, brokenAtLedgerIndex: null, scope: "tenant", length: 7 });
  assert.equal(chainAlert(c), "");
});

test("a truncated in-memory chain is only partially verified, never 'intact'", () => {
  const c = normalizeChain({ valid: true, brokenAtSeq: null, length: 500, truncated: true, evictedCount: 40 });
  assert.equal(c.partial, true);
  assert.equal(c.unverified, "earlier");
  assert.match(chainAlert(c), /earlier events are not verified/);
});

test("an in-memory break names its tenant sequence", () => {
  const c = normalizeChain({ valid: false, brokenAtSeq: 3, length: 7, truncated: false });
  assert.equal(chainAlert(c), "Hash chain broken at sequence 3.");
});

test("a clean durable ledger is verified, not broken at sequence undefined", () => {
  const c = normalizeChain({ ok: true, count: 12, truncated: false, batches: 1 });
  assert.deepEqual(c, { valid: true, partial: false, unverified: null, brokenAtSeq: null, brokenAtLedgerIndex: null, scope: "global-ledger", length: 12 });
});

test("a durable break keeps its zero-based global ledger index apart from audit sequences", () => {
  const c = normalizeChain({ ok: false, count: 12, truncated: false, brokenAtIndex: 0 });
  assert.equal(c.brokenAtSeq, null);
  assert.equal(c.brokenAtLedgerIndex, 0);
  assert.equal(chainAlert(c), "Hash chain broken at global ledger index 0 (zero-based).");
});

test("a truncated durable verification is partial: verified prefix, not a whole chain", () => {
  const c = normalizeChain({ ok: true, count: 10000, truncated: true });
  assert.equal(c.partial, true);
  // The durable verifier reads a PREFIX from offset 0: it is the LATER records that go unverified.
  assert.equal(c.unverified, "later");
  assert.match(chainAlert(c), /later records are not verified/);
  assert.doesNotMatch(chainAlert(c), /earlier/);
});

test("a verdict that does not say whether it covered the whole history is unverified", () => {
  for (const raw of [{ valid: true, brokenAtSeq: null, length: 7 }, { ok: true, count: 7 }]) {
    const c = normalizeChain(raw);
    assert.equal(c.valid, false);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
});

test("an incomplete or contradictory verdict is never 'intact'", () => {
  for (const raw of [
    { valid: true, truncated: false },                     // no length
    { ok: true, truncated: false },                        // no count
    { valid: true, ok: false, length: 7, count: 7, truncated: false }, // both shapes at once
  ]) {
    const c = normalizeChain(raw);
    assert.equal(c.valid, false);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
});

test("a success that also names a break location is unverified, never 'intact'", () => {
  for (const raw of [
    { valid: true, brokenAtSeq: 3, length: 7, truncated: false },
    { ok: true, brokenAtIndex: 4, count: 7, truncated: false },
  ]) {
    const c = normalizeChain(raw);
    assert.equal(c.valid, false);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
});

test("an eviction count that contradicts truncation, or is malformed, is unverified", () => {
  for (const raw of [
    { valid: true, brokenAtSeq: null, length: 500, truncated: false, evictedCount: 40 },
    { valid: true, brokenAtSeq: null, length: 7, truncated: false, evictedCount: -1 },
    { valid: true, brokenAtSeq: null, length: 7, truncated: true, evictedCount: 1.5 },
    { valid: true, brokenAtSeq: null, length: 7, truncated: false, evictedCount: "0" },
  ]) {
    const c = normalizeChain(raw);
    assert.equal(c.valid, false);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
  assert.equal(normalizeChain({ valid: true, brokenAtSeq: null, length: 7, truncated: false, evictedCount: 0 }).valid, true);
});

test("a length or count that is not a non-negative integer is unverified", () => {
  for (const raw of [
    { valid: true, brokenAtSeq: null, length: -1, truncated: false },
    { valid: true, brokenAtSeq: null, length: 2.5, truncated: false },
    { ok: true, count: 1.5, truncated: false },
    { ok: true, count: -3, truncated: false },
  ]) {
    const c = normalizeChain(raw);
    assert.equal(c.valid, false);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
});

test("a break location that is not a real position is unverified, not a confirmed break", () => {
  for (const raw of [
    { valid: false, brokenAtSeq: -1, length: 7, truncated: false },
    { valid: false, brokenAtSeq: 0, length: 7, truncated: false },
    { valid: false, brokenAtSeq: 8, length: 7, truncated: false },
    { ok: false, brokenAtIndex: 1.5, count: 7, truncated: false },
    { ok: false, brokenAtIndex: 7, count: 7, truncated: false },
  ]) {
    const c = normalizeChain(raw);
    assert.equal(c.brokenAtSeq, null);
    assert.equal(c.brokenAtLedgerIndex, null);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
  assert.equal(chainAlert(normalizeChain({ valid: false, brokenAtSeq: 7, length: 7, truncated: false })), "Hash chain broken at sequence 7.");
});

test("an unrecognised shape is unverified", () => {
  for (const raw of [undefined, null, {}, { ok: "yes" }]) {
    const c = normalizeChain(raw);
    assert.equal(chainAlert(c), "Hash chain could not be verified.");
  }
});
