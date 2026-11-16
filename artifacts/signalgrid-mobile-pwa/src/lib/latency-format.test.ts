import test from "node:test";
import assert from "node:assert/strict";
import { formatLatency } from "./format.ts";

// A duration below zero is not a measurement. Clock skew between the device and
// the decision API can mint one, and "-3ms" on a phone reads as a real (and
// impossible) latency. Below zero renders the same dash as an absent value.
const ABSENT = "–";

test("every finite value below zero renders as absent", () => {
  for (const ms of [-1, -3, -0.4, -0.5, -0.6, -1e-9, -Number.MIN_VALUE, -1234.56, -Number.MAX_VALUE]) {
    assert.equal(formatLatency(ms), ABSENT, `formatLatency(${ms})`);
  }
});

test("zero and negative zero are a measured 0ms", () => {
  assert.equal(formatLatency(0), "0ms");
  assert.equal(formatLatency(-0), "0ms");
});

test("finite non-negative values keep their rounding", () => {
  assert.equal(formatLatency(0.4), "0ms");
  assert.equal(formatLatency(12), "12ms");
  assert.equal(formatLatency(12.5), "13ms");
  assert.equal(formatLatency(999.49), "999ms");
});

test("absent, NaN and infinite values stay absent", () => {
  for (const ms of [undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatLatency(ms), ABSENT, `formatLatency(${ms})`);
  }
});
