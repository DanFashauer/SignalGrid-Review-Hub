// Shared grant-safety harness — the single, deliberately-tiny piece of test
// infrastructure that guards the fabric's most safety-critical output: the
// "allow" verdict (a connector emitting action "none").
//
// The discipline it enforces is the one every connector evaluator is written to:
// a GRANT REQUIRES POSITIVE CONFIRMATION OF EVERY INPUT. A clean/grant path must
// be UNREACHABLE by any unknown, missing, malformed, or self-contradictory input.
//
// Rather than trust that a hand-picked fixture set happens to exercise every hole,
// this brute-forces the ENTIRE normalized input space (the cartesian product of
// each field's candidate values — including the malformed/unknown sentinels the
// normalizer can produce) and asserts that action "none" is emitted for EXACTLY
// the states the caller declares positively-confirmed clean, and for nothing else.
// A single unconfirmed input that reaches a grant is a mismatch.
//
// This makes the proof genuinely CONSTRAIN the evaluator: it is not re-describing
// fixtures, it is quantifying over all inputs. If the evaluator is later changed
// so an unknown value slips through to a grant, the enumeration fails.

/** A field's candidate values. Include every malformed/unknown sentinel the field can hold. */
export type Domain = Record<string, readonly unknown[]>;

export interface GrantSafetyResult {
  /** Total input combinations enumerated (the product of the domain sizes). */
  combos: number;
  /** How many combinations the evaluator granted (action "none"). */
  noneCount: number;
  /** Combinations where grant-ness disagreed with the clean predicate, or a grant
   *  failed the caller's extra "confirmed" invariant. Must be 0. */
  mismatches: number;
  /** The first offending combination (for debugging a non-zero mismatch count). */
  firstMismatch?: string;
}

export interface GrantSafetyOptions<TInput, TVerdict> {
  /** Field → candidate values (incl. malformed/unknown sentinels). No array may be empty. */
  domains: Domain;
  /** Turn one enumerated combination into the connector's normalized input. */
  build: (combo: Record<string, unknown>) => TInput;
  /** Run the pure evaluator. */
  evaluate: (input: TInput) => TVerdict;
  /** Extract the recommended action from a verdict. A grant is action === "none". */
  actionOf: (verdict: TVerdict) => string;
  /** TRUE for exactly the combinations that are positively-confirmed clean (may grant). */
  positivelyClean: (combo: Record<string, unknown>) => boolean;
  /** Optional extra invariant asserted on every GRANT (e.g. a governanceConfirmed/subjectBound flag). */
  confirmedWhenNone?: (verdict: TVerdict) => boolean;
}

/** The number of combinations a domain set enumerates (product of the field sizes). */
export function productOf(domains: Domain): number {
  return Object.values(domains).reduce((n, values) => n * values.length, 1);
}

/**
 * Brute-force the full normalized input space and check the allow-path invariant.
 * Returns counts; the caller asserts `mismatches === 0`, `combos === productOf(domains)`
 * (guards against a mistyped/empty domain silently shrinking coverage), and
 * `noneCount > 0` (guards against a vacuous enumeration that never grants).
 */
export function enumerateGrantSafety<TInput, TVerdict>(
  options: GrantSafetyOptions<TInput, TVerdict>,
): GrantSafetyResult {
  const keys = Object.keys(options.domains);
  for (const key of keys) {
    if (options.domains[key].length === 0) {
      throw new Error(`grant-safety: domain "${key}" is empty — this would zero the enumeration`);
    }
  }

  let combos = 0;
  let noneCount = 0;
  let mismatches = 0;
  let firstMismatch: string | undefined;
  const combo: Record<string, unknown> = {};

  const walk = (depth: number): void => {
    if (depth === keys.length) {
      combos += 1;
      const snapshot = { ...combo };
      const verdict = options.evaluate(options.build(snapshot));
      const isNone = options.actionOf(verdict) === "none";
      const expectedClean = options.positivelyClean(snapshot);
      if (isNone) noneCount += 1;
      let bad = isNone !== expectedClean;
      if (isNone && options.confirmedWhenNone && !options.confirmedWhenNone(verdict)) {
        bad = true;
      }
      if (bad) {
        mismatches += 1;
        if (firstMismatch === undefined) firstMismatch = JSON.stringify(snapshot);
      }
      return;
    }
    const key = keys[depth];
    for (const value of options.domains[key]) {
      combo[key] = value;
      walk(depth + 1);
    }
  };

  walk(0);
  return { combos, noneCount, mismatches, firstMismatch };
}
