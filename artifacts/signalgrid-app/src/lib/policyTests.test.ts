import test from "node:test";
import assert from "node:assert/strict";
import { policyTestSetStatus } from "./policyTests.ts";

test("empty result set is 'empty', never 'passed'", () => {
  assert.equal(policyTestSetStatus([]), "empty");
});

test("all passing results is 'passed'", () => {
  assert.equal(policyTestSetStatus([{ passed: true }, { passed: true }]), "passed");
});

test("any failing result is 'failing'", () => {
  assert.equal(policyTestSetStatus([{ passed: true }, { passed: false }]), "failing");
});
