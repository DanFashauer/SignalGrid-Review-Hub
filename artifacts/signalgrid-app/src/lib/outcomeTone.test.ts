import test from "node:test";
import assert from "node:assert/strict";
import { outcomeTone } from "./outcomeTone.ts";

test("the four /v1 outcomes keep their own labels", () => {
  assert.equal(outcomeTone("allow").label, "ALLOW");
  assert.equal(outcomeTone("step_up").label, "STEP-UP");
  assert.equal(outcomeTone("restrict").label, "RESTRICT");
  assert.equal(outcomeTone("deny").label, "DENY");
});

test("an out-of-union outcome renders in the restrictive tone with its raw name", () => {
  const t = outcomeTone("step-up");
  assert.equal(t.text, outcomeTone("deny").text);
  assert.equal(t.label, "UNKNOWN: STEP-UP");
});

test("a missing, empty or prototype-key outcome is never undefined and never allow", () => {
  for (const v of [undefined, null, "", "  ", 7, "toString", "__proto__"]) {
    const t = outcomeTone(v);
    assert.ok(t, `tone for ${String(v)}`);
    assert.equal(t.text, "text-status-deny", `tone for ${String(v)}`);
    assert.match(t.label, /^UNKNOWN: /);
  }
});
