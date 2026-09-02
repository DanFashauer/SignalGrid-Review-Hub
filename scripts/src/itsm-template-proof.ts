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
// The generic-webhook template path is a SECOND substituter with its own syntax
// and its own defects; it lives beside the store's one and was never covered here.
import {
  buildTemplateContext,
  substituteVariables,
  UnresolvedTemplateVariableError,
} from "@workspace/integrations/itsm";

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

// ── THE GENERIC-WEBHOOK TEMPLATE PATH ───────────────────────────────────────
//
// A different substituter, `{{var}}` syntax, two defects of its own.

// 1. AN UNRESOLVED PLACEHOLDER IS A REFUSAL, NOT A DEFAULT.
//    It returned the literal `{{assetTag}}` into the outbound JSON body, and the
//    POST then succeeded — so a ticket in a customer's ITSM carried template
//    syntax where evidence belonged, and nothing anywhere reported a problem. The
//    ledger of what an incident SAID is the last place silent placeholder text is
//    acceptable.
{
  const ctx = buildTemplateContext(
    { title: "t", description: "d", severity: "high" } as never,
    "req-1",
    "2026-09-02T00:00:00.000Z",
  );
  check(
    "a resolvable placeholder still substitutes (the refusal is not a wall)",
    substituteVariables('{"t":"{{title}}"}', ctx) === '{"t":"t"}',
  );
  check(
    "a dotted path still resolves through the context",
    substituteVariables("{{requestId}}", ctx) === "req-1",
  );
  let threw: unknown = null;
  try {
    substituteVariables('{"a":"{{assetTag}}"}', ctx);
  } catch (err) {
    threw = err;
  }
  check(
    "an UNRESOLVED placeholder throws instead of emitting the literal ${var} into the body",
    threw instanceof UnresolvedTemplateVariableError,
  );
  check(
    "the refusal NAMES the placeholder it could not resolve",
    threw instanceof UnresolvedTemplateVariableError && threw.unresolved.includes("assetTag"),
  );
  check(
    "every unresolved placeholder is named, not just the first",
    (() => {
      try {
        substituteVariables("{{a}} {{b}}", ctx);
        return false;
      } catch (err) {
        return err instanceof UnresolvedTemplateVariableError && err.unresolved.length === 2;
      }
    })(),
  );
}

// 2. rawEvent CANNOT OVERRIDE A SANCTIONED FIELD.
//    `...request.rawEvent` was spread LAST, so a key in the untrusted vendor event
//    won against the value this adapter derives. The ticket then described the
//    device the raw event named, not the device the decision was about.
{
  const ctx = buildTemplateContext(
    {
      title: "REAL-TITLE",
      description: "d",
      severity: "high",
      deviceId: "REAL-DEVICE",
      rawEvent: { deviceId: "ATTACKER-DEVICE", title: "ATTACKER-TITLE", severity: "low", extra: "passthrough" },
    } as never,
    "req-2",
    "2026-09-02T00:00:00.000Z",
  );
  check("rawEvent cannot override the sanctioned deviceId", ctx.deviceId === "REAL-DEVICE");
  check("rawEvent cannot override the sanctioned title", ctx.title === "REAL-TITLE");
  check("rawEvent cannot override the sanctioned severity", ctx.severity === "high");
  check("rawEvent cannot override the derived requestId", ctx.requestId === "req-2");
  // NON-VACUITY: rawEvent is still passthrough for keys the adapter does not own.
  // Dropping it entirely would satisfy the four assertions above and break the feature.
  check("a rawEvent key the adapter does NOT sanction is still addressable", ctx.extra === "passthrough");
  check(
    "and it substitutes into a template (the passthrough is real, not just present)",
    substituteVariables("{{extra}}", ctx) === "passthrough",
  );
}

const total = passed + failures.length;
console.log(`\nITSM template proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Template substitution verified — values verbatim, keys inert, evidence text cannot rewrite itself.");
