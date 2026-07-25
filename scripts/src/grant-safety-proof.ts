// Self-proof for the shared grant-safety harness — fully OFFLINE and deterministic.
//
// The harness (scripts/src/lib/grant-safety.ts) is the single piece of test
// infrastructure that now guards the fabric's "allow" verdict across connectors,
// so it must itself be proven: a brute-force that silently always passes is worse
// than none. This drives the harness against a TOY evaluator with a known-exact
// clean set and asserts two things:
//   1. a CORRECT clean predicate yields 0 mismatches (it accepts truth); and
//   2. deliberately WRONG predicates / invariants yield mismatches > 0 (it is a
//      real detector — the NEGATIVE CONTROLS that prove the enumeration bites).
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("grant-safety harness self-proof");

// A toy connector: two decisive fields, a known-exact grant rule, plus a "confirmed"
// flag that must be true on every legitimate grant. Grant (action "none") IFF the
// state is positively clean: a === "ok" AND b === true. Everything else raises the
// bar. An unknown/false/null value on either field must never grant.
interface ToyInput { a: unknown; b: unknown; [k: string]: unknown }
interface ToyVerdict { action: string; confirmed: boolean }
const evaluateToy = (input: ToyInput): ToyVerdict => {
  if (input.a === "ok" && input.b === true) return { action: "none", confirmed: true };
  return { action: "step_up", confirmed: false };
};
const domains = { a: ["ok", "bad", "unknown"], b: [true, false, null] };
const clean = (c: Record<string, unknown>): boolean => c.a === "ok" && c.b === true;

// productOf is the product of the domain sizes.
check("productOf multiplies domain sizes", productOf(domains) === 9);
check("productOf of a single field is its length", productOf({ a: ["ok", "bad", "unknown"] }) === 3);

// 1. The CORRECT predicate accepts truth: 0 mismatches, and exactly one grant.
const correct = enumerateGrantSafety<ToyInput, ToyVerdict>({
  domains,
  build: (c) => ({ a: c.a, b: c.b }),
  evaluate: evaluateToy,
  actionOf: (v) => v.action,
  confirmedWhenNone: (v) => v.confirmed === true,
  positivelyClean: clean,
});
check("a correct predicate yields 0 mismatches", correct.mismatches === 0);
check("enumerates the full product", correct.combos === 9 && correct.combos === productOf(domains));
check("counts the single granting state (non-vacuous)", correct.noneCount === 1);
check("a clean pass reports no firstMismatch", correct.firstMismatch === undefined);

// 2a. NEGATIVE CONTROL — a TOO-STRICT predicate (never clean) must flag the real
// grant the evaluator emits. If the harness reported 0 here it would be blind.
const tooStrict = enumerateGrantSafety<ToyInput, ToyVerdict>({
  domains,
  build: (c) => ({ a: c.a, b: c.b }),
  evaluate: evaluateToy,
  actionOf: (v) => v.action,
  positivelyClean: () => false,
});
check("negative control: a too-strict predicate is caught (mismatches>0)", tooStrict.mismatches > 0);
check("negative control: the too-strict mismatch equals the real grant count", tooStrict.mismatches === correct.noneCount);
check("negative control: a mismatch surfaces the offending combination", typeof tooStrict.firstMismatch === "string");

// 2b. NEGATIVE CONTROL — a TOO-LOOSE predicate (everything clean) must flag every
// state the evaluator DENIED. This is the exact bug class the harness exists to
// catch: an unknown/malformed input that "should" be clean but the code denies —
// or, inverted onto real connectors, one the code GRANTS but should deny.
const tooLoose = enumerateGrantSafety<ToyInput, ToyVerdict>({
  domains,
  build: (c) => ({ a: c.a, b: c.b }),
  evaluate: evaluateToy,
  actionOf: (v) => v.action,
  positivelyClean: () => true,
});
check("negative control: a too-loose predicate is caught (mismatches>0)", tooLoose.mismatches > 0);
check("negative control: the too-loose mismatch equals the denied-state count", tooLoose.mismatches === correct.combos - correct.noneCount);

// 2c. NEGATIVE CONTROL — the confirmedWhenNone invariant. A grant that fails the
// extra invariant must be flagged even when the action mapping agrees. Here a
// broken evaluator grants without setting confirmed.
const brokenConfirm = enumerateGrantSafety<ToyInput, ToyVerdict>({
  domains,
  build: (c) => ({ a: c.a, b: c.b }),
  evaluate: (input) => (clean(input) ? { action: "none", confirmed: false } : { action: "step_up", confirmed: false }),
  actionOf: (v) => v.action,
  confirmedWhenNone: (v) => v.confirmed === true,
  positivelyClean: clean,
});
check("negative control: a grant failing confirmedWhenNone is caught", brokenConfirm.mismatches > 0);

// 3. An empty domain would zero the enumeration — the harness refuses it rather
// than silently "passing" over 0 combinations.
let threw = false;
try {
  enumerateGrantSafety<ToyInput, ToyVerdict>({
    domains: { a: ["ok"], b: [] },
    build: (c) => ({ a: c.a, b: c.b }),
    evaluate: evaluateToy,
    actionOf: (v) => v.action,
    positivelyClean: clean,
  });
} catch {
  threw = true;
}
check("an empty domain throws (never a silent zero-combination pass)", threw);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
