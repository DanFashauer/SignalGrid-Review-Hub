// Classify an unsafe-claim scan hit: is it a CLAIM, or a DISCLAIMER of that claim?
//
// WHY THIS EXISTS. `phase-gate.ts` greps README/docs/review-src for wording the project
// must never publish — "SignalGrid is production-ready", "Imprivata partner", "MFi
// certified", "replaces Jamf". It then printed `unsafeClaims=found` whenever the grep
// returned anything.
//
// THE GREP CANNOT SEE NEGATION. "SignalGrid is an Imprivata partner" and "SignalGrid is
// NOT an Imprivata partner" both contain the substring `Imprivata partner`, so both
// matched, identically. Measured at the time this was written: 64 hits across the
// scanned paths, and after excluding every line carrying a negation, prohibition or
// self-reference marker, ZERO remained. Not one hit was a real claim.
//
// So `unsafeClaims=found` was printed on every run the gate had ever made, and would be
// printed identically by a repository that DID contain a genuine unsafe claim. A signal
// that cannot vary carries no information — it is a constant wearing a check's clothes.
// And the incentive ran backwards: this repository's doctrine is platform honesty, so
// its docs are full of disclaimers, and writing one COST you a lane escalation.
//
// THIS IS NOT A NEW IDEA — IT IS THE OTHER SCANNER'S IDEA, APPLIED HERE.
// `scripts/docs-sanity.mjs` scans the SAME denylist and has been negation-aware for some
// time: its `hasBareClaim` requires a negator to appear BEFORE the phrase, and its own
// comment records why ("The old check exempted any line containing 'no'/'not' ANYWHERE,
// so a real over-claim slipped through if the line also said e.g. 'no setup' after the
// claim"). Two gates shared a denylist and disagreed about how to read it; the phase gate
// was the one still running the naive grep. `docs/CI_AND_VALIDATION.md` likewise already
// described this behaviour. The fix aligns the laggard with the standard already set.
//
// One deliberate divergence: `docs-sanity` scopes the negator to the whole line prefix;
// this scopes it to the CLAUSE, because these docs use markdown tables and a negation in
// one cell must not reach across `|` into the next. Stricter, never looser.
//
// ── THE ASYMMETRY THAT MAKES THIS SAFE ──────────────────────────────────────────
//
// Two marker families, deliberately scoped differently, because they fail differently:
//
//   NEGATION is POSITIONAL — counted in the text BEFORE the match within the same
//   clause, and in exactly one place after it (below). "not", "never", "no" are
//   ordinary words that appear all over honest prose, so a sentence-wide search would
//   let "SignalGrid is production-ready and needs no configuration" launder itself on a
//   trailing "no". Positional scoping makes that impossible: the negation has to
//   actually govern the claim.
//
//   THE ONE POSTPOSED CASE, added 2026-09-06. English puts the negator AFTER the verb
//   when it is the verb's direct object: "SignalGrid replaces no system of record",
//   "…replaces neither Jamf nor Intune", "…replaces nothing", "…replaces none of them".
//   Prefix-only scoping filed all four as AFFIRMATIVE, and the first of them is this
//   repository's own doctrine sentence — quoted in docs/SECURITY_BASELINE_ALIGNMENT.md
//   and again inside docs/agent/CLAIM_INVENTORY.json, where it was the single
//   `affirmative` hit the live gate reported. That is precisely the failure mode this
//   file exists to prevent: a gate punishing an honest sentence. The window is the
//   IMMEDIATELY following token and nothing else — "and needs no configuration" has a
//   conjunction and a verb between the claim and the negator, so it stays affirmative,
//   and "replaces no fewer than three systems" is excluded by name because that idiom
//   is an assertion wearing a negator.
//
//   PROHIBITION is LEXICAL — counted anywhere in the same clause. "avoid", "denylist",
//   "guardrail", "must not say" cannot plausibly co-occur with a sincere claim; a
//   sentence that both asserts a partnership and calls it a denylist entry does not
//   exist. These are wide on purpose, and they are the narrower risk.
//
// Anything not positively identified as disclaimed is AFFIRMATIVE. Fail-closed: the
// unclassifiable hit escalates, exactly as an unknown signal does everywhere else here.

/** The wording the project must never publish. Kept byte-identical to the string in
 *  `phase-gate.ts` / `docs/VALIDATION_COMMANDS.md` — the documented scan command is
 *  checked verbatim by the gate's own required-validation list, so this pattern and
 *  that command must not drift apart. */
export const UNSAFE_CLAIM_SOURCE =
  "SignalGrid is production-ready|SignalGrid replaces|SignalGrid is an Imprivata partner|SignalGrid is MFi certified|autonomous production remediation|replaces ServiceNow|replaces PagerDuty|replaces CrowdStrike|replaces Defender|replaces ControlUp|Imprivata partner|MFi certified|replaces Jamf|replaces Intune|replaces Apple Configurator|replaces GroundControl";

export const UNSAFE_CLAIM_PATTERN = new RegExp(UNSAFE_CLAIM_SOURCE, "i");

/** Files whose PURPOSE is to enumerate the banned wording. Exempted BY NAME, in a
 *  visible set, rather than by a pattern that would quietly grow — the same discipline
 *  the nac network-scan uses for its one exempt file. A registry that may not contain
 *  the strings it registers is not a registry. */
export const CLAIM_REGISTRY_FILES: ReadonlySet<string> = new Set([
  "docs/PUBLIC_MESSAGING_GUARDRAILS.md",
]);

/** The scanner quoting its own command line. Narrow on purpose: it matches the literal
 *  opening of the documented command, not "any line mentioning grep". */
const SELF_REFERENCE_MARKER = 'git grep -nE "SignalGrid is production-ready';

/** Word-bounded so "Nobody" does not read as "no" and "notation" does not read as
 *  "not" — the classic substring trap this whole file exists to fix. */
const NEGATION_MARKERS =
  /\b(?:not|no|never|nothing|none|neither|nor|without|non-|cannot|n't)\b|\bn't\b/i;

/** Negators that can stand as the DIRECT OBJECT of the matched phrase, i.e. the very
 *  next token after it. Deliberately NARROWER than NEGATION_MARKERS (no "never",
 *  "without", "cannot" — those are adverbial and would already have been seen in the
 *  prefix) and required to be a whole word followed by space or punctuation, so
 *  "replaces no-code tooling" is NOT read as a negation. "no fewer/less than" is
 *  excluded because it asserts rather than denies. */
const POSTPOSED_NEGATION =
  /^\s+(no|none|nothing|neither|nobody|not)(?=[\s,.;:|]|$)(?!\s+(?:fewer|less)\b)/i;

/** The text immediately following the match. Used ONLY by POSTPOSED_NEGATION, whose
 *  anchor (`^\s+` then one word) cannot reach past a clause boundary anyway. */
function afterMatch(text: string): string | null {
  const m = UNSAFE_CLAIM_PATTERN.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length);
}

/** Verbs that can only be talking ABOUT the wording, never asserting it. */
const PROHIBITION_MARKERS =
  /\b(?:avoid|avoids|avoiding|block|blocks|blocked|prohibit\w*|forbid\w*|ban|bans|banned|denylist\w*|blocklist\w*|guardrail\w*|disclaimer\w*|disallow\w*|refrain|prevent\w*)\b/i;

/** Clause boundaries. `|` is included because these docs use markdown TABLES, and a
 *  negation in one cell must not disclaim a claim sitting in the next one. */
const CLAUSE_BOUNDARY = /[.;|]/g;

/** `not_a_hit` is its OWN class, not a flavour of `disclaimed`: a line the pattern never
 *  matched was cleared by arithmetic, not by any disclaimer, and folding it into the
 *  `disclaimed` tally made that printed figure a mixed number a reviewer could not use
 *  to sanity-check the classifier's reach. */
export type ClaimClass =
  | "affirmative"
  | "disclaimed"
  | "self_referential"
  | "registry"
  | "not_a_hit";

export interface ClassifiedClaim {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly classification: ClaimClass;
  /** What drove a non-affirmative verdict, so a reviewer can check the reasoning
   *  instead of trusting it. `null` for affirmative. */
  readonly marker: string | null;
}

/** The clause the match sits in: text from the last clause boundary before the match,
 *  up to the match itself. Returns null when the line does not match at all. */
function clauseBefore(text: string): string | null {
  const m = UNSAFE_CLAIM_PATTERN.exec(text);
  if (!m) return null;
  const prefix = text.slice(0, m.index);
  let start = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  for (let b = CLAUSE_BOUNDARY.exec(prefix); b !== null; b = CLAUSE_BOUNDARY.exec(prefix)) {
    start = b.index + 1;
  }
  return prefix.slice(start);
}

/** The whole clause containing the match — used only for PROHIBITION markers, which
 *  may legitimately follow the phrase they prohibit ("...replaces Jamf, which we
 *  avoid claiming"). */
function clauseAround(text: string): string | null {
  const m = UNSAFE_CLAIM_PATTERN.exec(text);
  if (!m) return null;
  const before = clauseBefore(text) ?? "";
  const rest = text.slice(m.index);
  const boundary = rest.search(/[.;|]/);
  return before + (boundary === -1 ? rest : rest.slice(0, boundary));
}

/**
 * Classify one scan hit.
 *
 * `file` is repo-relative, exactly as `git grep` reports it.
 */
export function classifyClaim(file: string, line: number, text: string): ClassifiedClaim {
  const base = { file, line, text };

  if (text.includes(SELF_REFERENCE_MARKER)) {
    return { ...base, classification: "self_referential", marker: "documents the scan command itself" };
  }
  if (CLAIM_REGISTRY_FILES.has(file)) {
    return { ...base, classification: "registry", marker: `registry file: ${file}` };
  }

  const before = clauseBefore(text);
  // No match at all — not a hit. Callers only pass real hits, so this is defensive:
  // returning "affirmative" here would manufacture a finding out of nothing. It is NOT
  // "disclaimed" either — nothing disclaimed it, and counting it there inflated the
  // printed disclaimer figure with lines that never contained a claim.
  if (before === null) return { ...base, classification: "not_a_hit", marker: "no claim pattern in line" };

  const neg = NEGATION_MARKERS.exec(before);
  if (neg) return { ...base, classification: "disclaimed", marker: `negated by "${neg[0]}"` };

  const post = POSTPOSED_NEGATION.exec(afterMatch(text) ?? "");
  if (post) return { ...base, classification: "disclaimed", marker: `negated by postposed "${post[1]}"` };

  const around = clauseAround(text) ?? "";
  const pro = PROHIBITION_MARKERS.exec(around);
  if (pro) return { ...base, classification: "disclaimed", marker: `prohibition wording "${pro[0]}"` };

  return { ...base, classification: "affirmative", marker: null };
}

/** Parse `git grep -n` output (`path:lineno:content`) and classify every hit.
 *  Content may itself contain colons, so only the first two are separators. */
export function classifyScanOutput(output: string): ClassifiedClaim[] {
  return output
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => {
      const first = l.indexOf(":");
      const second = l.indexOf(":", first + 1);
      if (first === -1 || second === -1) {
        // Unparseable — treat as affirmative rather than silently dropping it. A hit we
        // cannot read is not a hit we can clear.
        return { file: l, line: 0, text: l, classification: "affirmative" as ClaimClass, marker: null };
      }
      return classifyClaim(l.slice(0, first), Number(l.slice(first + 1, second)), l.slice(second + 1));
    });
}

export interface ClaimTally {
  readonly affirmative: readonly ClassifiedClaim[];
  readonly disclaimed: number;
  readonly selfReferential: number;
  readonly registry: number;
  /** Lines the claim pattern never matched. Counted separately so `disclaimed` stays a
   *  count of RECOGNISED disclaimers and nothing else. */
  readonly notAHit: number;
  readonly total: number;
}

export function tallyClaims(claims: readonly ClassifiedClaim[]): ClaimTally {
  return {
    affirmative: claims.filter((c) => c.classification === "affirmative"),
    disclaimed: claims.filter((c) => c.classification === "disclaimed").length,
    selfReferential: claims.filter((c) => c.classification === "self_referential").length,
    registry: claims.filter((c) => c.classification === "registry").length,
    notAHit: claims.filter((c) => c.classification === "not_a_hit").length,
    total: claims.length,
  };
}
