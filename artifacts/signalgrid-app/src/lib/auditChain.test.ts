import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChain } from "./auditChain.ts";

test("the in-memory core's verdict passes through unchanged", () => {
  assert.deepEqual(normalizeChain({ valid: true, brokenAtSeq: null, length: 7, truncated: false }), { valid: true, brokenAtSeq: null, length: 7 });
  assert.deepEqual(normalizeChain({ valid: false, brokenAtSeq: 3, length: 7 }), { valid: false, brokenAtSeq: 3, length: 7 });
});

test("a clean durable ledger is verified, not broken at sequence undefined", () => {
  assert.deepEqual(normalizeChain({ ok: true, count: 12, truncated: false, batches: 1 }), { valid: true, brokenAtSeq: null, length: 12 });
});

test("a broken durable ledger names the index it broke at", () => {
  assert.deepEqual(normalizeChain({ ok: false, count: 12, truncated: false, brokenAtIndex: 5 }), { valid: false, brokenAtSeq: 5, length: 12 });
});

test("a truncated durable verification is inconclusive: not valid, and no invented break", () => {
  assert.deepEqual(normalizeChain({ ok: true, count: 10000, truncated: true }), { valid: false, brokenAtSeq: null, length: 10000 });
});

test("an unrecognised shape is unverified", () => {
  for (const raw of [undefined, null, {}, { ok: "yes" }]) assert.deepEqual(normalizeChain(raw), { valid: false, brokenAtSeq: null, length: 0 });
});
