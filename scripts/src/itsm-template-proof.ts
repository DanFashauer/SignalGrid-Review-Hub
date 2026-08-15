// Proof: ITSM template substitution inserts VALUES VERBATIM — no pattern
// expansion, no regex injection via keys.
//
// THE DEFECT THIS PINS (inherited byte-identical from the legacy DEV repo,
// whose own REMEDIATION_ROADMAP flagged it and whose fix was never written):
// `String.replace` treats a STRING replacement as a pattern language. A
// variable value containing `$&`, `$'`, `` $` `` or `$1` was expanded against
// the match instead of inserted literally — so ticket text built from signal
// evidence (device names, raw vendor strings, anything the caller does not
// author) could be silently rewritten on its way into an ITSM ticket. The
// ledger of what an incident SAID is exactly the place silent rewriting is
// unacceptable. Secondarily, the variable KEY was interpolated into a RegExp
// unescaped, so a key with a metacharacter either crashed or matched wrongly.
//
// The fix is a replacer FUNCTION (whose return value is inserted with no
// expansion) plus regex-escaping the key. Each check below fails against the
// pre-fix implementation — verified by running this proof against it.
//
// Run: pnpm --filter @workspace/scripts run proof:itsm-template

// substituteTemplate lives on the store module (ticket templates), exposed as a
// package subpath — the family's index deliberately exports only resolve+adapter.
import { substituteTemplate } from "@workspace/integrations/itsm/store";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("ITSM template-substitution proof");

// ── plain substitution still works ───────────────────────────────────────────
check(
  "a plain value substitutes into its {{slot}}",
  substituteTemplate("Device {{device}} restricted", { device: "CART-07" }) === "Device CART-07 restricted",
);
check(
  "multiple occurrences of one slot all substitute",
  substituteTemplate("{{who}} and {{who}}", { who: "operator" }) === "operator and operator",
);
check(
  "a missing/empty value is marked, not silently blank",
  substituteTemplate("Assignee: {{assignee}}", { assignee: "" }) === "Assignee: [assignee missing]",
);

// ── THE INHERITED DEFECT: $-patterns in VALUES must be inert ────────────────
// Pre-fix, `$&` re-inserted the matched `{{summary}}` — the output contained
// the template's own slot syntax where evidence text should be.
check(
  "a value containing $& is inserted VERBATIM, not expanded to the match",
  substituteTemplate("Note: {{summary}}", { summary: "cost is $100 & rising, $& literally" }) ===
    "Note: cost is $100 & rising, $& literally",
);
check(
  "a value containing $' (after-match) is inserted verbatim",
  substituteTemplate("{{a}} tail", { a: "x$'y" }) === "x$'y tail",
);
check(
  "a value containing $` (before-match) is inserted verbatim",
  substituteTemplate("head {{a}}", { a: "x$`y" }) === "head x$`y",
);
check(
  "a value containing $1 (group ref) is inserted verbatim",
  substituteTemplate("{{amount}}", { amount: "$1 was charged" }) === "$1 was charged",
);
check(
  "a value containing $$ keeps both dollars — string-replacement would collapse them to one",
  substituteTemplate("{{price}}", { price: "$$40" }) === "$$40",
);

// ── regex injection via KEYS is closed ──────────────────────────────────────
check(
  "a key containing regex metacharacters substitutes literally instead of throwing or mis-matching",
  substituteTemplate("v: {{ver(1)}}", { "ver(1)": "2.0" }) === "v: 2.0",
);
check(
  "a dot in a key does not wildcard-match sibling slots",
  substituteTemplate("{{a.b}} {{axb}}", { "a.b": "dotted" }) === "dotted {{axb}}",
);

const total = passed + failures.length;
console.log(`\nITSM template proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Template substitution verified — values verbatim, keys inert, evidence text cannot rewrite itself.");
