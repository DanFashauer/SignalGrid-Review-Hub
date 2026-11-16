import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatTimeAgo } from "./format.ts";

// #2190: a truthy non-string runtime value is unparseable, never coerced into a date or a throw.
const malformed = JSON.parse('{"valueOf":null,"toString":null}');
const bad: unknown[] = [malformed, 1, true, ["2026-01-01"], { at: "2026-01-01" }];

for (const [name, fn] of [["formatDate", formatDate], ["formatTimeAgo", formatTimeAgo]] as const) {
  test(`${name}: a truthy non-string value is an unparseable timestamp`, () => {
    for (const v of bad) assert.equal(fn(v as string), "unparseable timestamp", JSON.stringify(v));
  });

  test(`${name}: missing, invalid and valid strings keep their existing behaviour`, () => {
    for (const v of [undefined, null, "", 0, false]) assert.equal(fn(v as string), "N/A");
    assert.equal(fn("not a date"), "unparseable timestamp");
    const out = fn("2026-01-02T03:04:05Z");
    assert.notEqual(out, "unparseable timestamp");
    assert.notEqual(out, "N/A");
  });
}
