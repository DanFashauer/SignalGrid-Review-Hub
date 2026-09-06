// Unsafe-claim classifier proof — OFFLINE, deterministic, no git required.
//
// THE DEFECT THIS PINS. `phase-gate.ts` printed `unsafeClaims=found` whenever its grep
// returned anything, and the grep cannot see negation: "SignalGrid is an Imprivata
// partner" and "SignalGrid is NOT an Imprivata partner" both contain `Imprivata
// partner`. Measured across README/docs/review-src at the time of the fix: 64 hits,
// ZERO of them affirmative. The gate had therefore printed the same answer on every run
// it had ever made, and would print it identically on a repo that DID carry a real
// claim.
//
// THE FAILURE MODE OF THE FIX IS THE SAME DEFECT MIRRORED. Exempt too much and the gate
// says "clean" forever — equally constant, equally uninformative, and now dangerous
// rather than merely noisy. So the assertions below are deliberately weighted toward
// NON-VACUITY: the affirmative cases outnumber the disclaimed ones, and the adversarial
// section exists specifically to prove a real claim cannot launder itself through the
// new exemptions.

import {
  CLAIM_REGISTRY_FILES,
  classifyClaim,
  classifyScanOutput,
  tallyClaims,
  UNSAFE_CLAIM_PATTERN,
} from "./unsafe-claim-classifier";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Unsafe-claim classifier proof — a disclaimer is not a claim\n");

const cls = (text: string, file = "docs/SOME_DOC.md") => classifyClaim(file, 1, text).classification;

// ── 1. AFFIRMATIVE CLAIMS ARE CAUGHT ─────────────────────────────────────────
//
// First and largest, because "stops flagging things" is the easy half and the
// dangerous one. Every line here MUST escalate.
{
  const MUST_FLAG = [
    "SignalGrid is production-ready today and shipping to customers.",
    "SignalGrid is an Imprivata partner.",
    "SignalGrid is MFi certified.",
    "SignalGrid replaces Jamf across the estate.",
    "Our roadmap: SignalGrid replaces Intune by Q3.",
    "The platform performs autonomous production remediation.",
    "SignalGrid replaces ServiceNow for incident intake.",
    "It replaces CrowdStrike on every endpoint.",
  ];
  for (const line of MUST_FLAG) {
    check(`AFFIRMATIVE caught: "${line.slice(0, 52)}"`, cls(line) === "affirmative");
  }
}

// ── 2. HONEST DISCLAIMERS ARE NOT CLAIMS ─────────────────────────────────────
{
  const MUST_CLEAR: Array<readonly [string, string]> = [
    ["plain not", "SignalGrid is not an Imprivata partner."],
    ["not + certified", "SignalGrid is not MFi certified."],
    ["never", "SignalGrid never replaces Jamf; it sits beside it."],
    ["leading No", "No autonomous production remediation is performed."],
    ["does not", "SignalGrid does not perform autonomous production remediation."],
    ["do not say", "Do not say SignalGrid replaces Jamf, Cisco, IAM, UEM/MDM, or ITSM."],
    ["nothing", "Nothing here is MFi certified."],
    ["avoid (prohibition)", "Avoid claiming SignalGrid replaces IAM, MDM, UEM, ITSM, or SIEM."],
    ["avoid, mid-sentence", "Preserve systems of record and avoid claims that SignalGrid replaces IAM."],
    ["guardrail wording", "The denylist checks for `replaces Jamf`, while allowing guardrail wording and disclaimers."],
    ["without", "Delivered without any Imprivata partner relationship."],
    // POSTPOSED NEGATION — the negator is the direct object of the matched verb, so it
    // sits AFTER the phrase. Prefix-only scoping filed all four as affirmative until
    // 2026-09-06, and the first is the repository's own doctrine sentence (quoted in
    // docs/SECURITY_BASELINE_ALIGNMENT.md:125-126, and again inside
    // docs/agent/CLAIM_INVENTORY.json where it was the live gate's ONE affirmative hit).
    ["postposed no", "SignalGrid replaces no system of record."],
    ["postposed neither/nor", "SignalGrid replaces neither Jamf nor Intune."],
    ["postposed nothing", "SignalGrid replaces nothing."],
    ["postposed none", "SignalGrid replaces none of them."],
    // The live line, verbatim from the claim inventory record that made the gate report
    // an asserted unsafe claim. Kept as bytes rather than paraphrased, because the
    // paraphrase is what a reviewer would have checked instead.
    ["the live CLAIM_INVENTORY.json:4694 sentence",
     "   \"evidence\": \"CLAUDE.md golden rule 3 (embedded UX law \u2014 domain enforcement belongs to the host/system of record); docs/SECURITY_BASELINE_ALIGNMENT.md:125-126 (SignalGrid replaces no system of record)\","],
  ];
  for (const [why, line] of MUST_CLEAR) {
    check(`disclaimer cleared (${why})`, cls(line) === "disclaimed");
  }
}

// ── 3. THE ADVERSARIAL SECTION ───────────────────────────────────────────────
//
// Can a REAL claim launder itself through the new exemptions? Each of these is a
// genuine assertion that also contains a marker, placed where it must NOT rescue it.
{
  // THE CENTRAL CASE. A trailing "no" must not disclaim a leading claim. This is
  // exactly why negation is scoped to the text BEFORE the match rather than the whole
  // line — a sentence-wide search would clear this, and it is a real claim.
  check("a TRAILING negation does not launder a leading claim",
    cls("SignalGrid is production-ready and needs no configuration.") === "affirmative");
  check("...nor does a negation in a LATER sentence",
    cls("SignalGrid is an Imprivata partner. There is no doubt about it.") === "affirmative");
  // Markdown tables: a negation in one cell must not reach across into the next.
  check("a negation in a PREVIOUS TABLE CELL does not cross the cell boundary",
    cls("| not applicable | SignalGrid is MFi certified |") === "affirmative");
  check("a negation after a semicolon does not reach backwards",
    cls("SignalGrid replaces Jamf; no exceptions apply.") === "affirmative");
  // Word-boundary traps — the substring bug that caused the original defect.
  check('"Nobody" is not the negation "no"',
    cls("Nobody disputes that SignalGrid replaces Jamf.") === "affirmative");
  check('"notation" is not the negation "not"',
    cls("Using shorthand notation, SignalGrid is MFi certified.") === "affirmative");
  // The self-reference exemption must be narrow: merely mentioning grep earns nothing.
  check("a line that merely mentions grep is NOT self-referential",
    cls("We grep for this: SignalGrid is an Imprivata partner.") === "affirmative");
  // The postposed window is ONE token wide. These four are the boundary of the
  // 2026-09-06 widening: each puts a negator after the claim where it does NOT govern
  // it, and each must stay affirmative or the widening has reopened the central hole.
  check("postposed window is one token: a negator two words later does not launder",
    cls("SignalGrid replaces Jamf and no one disputes it.") === "affirmative");
  check('"no fewer than" asserts rather than denies',
    cls("SignalGrid replaces no fewer than three systems of record.") === "affirmative");
  check('a hyphenated "no-" prefix is not the negator "no"',
    cls("SignalGrid replaces no-code tooling across the estate.") === "affirmative");
  check("the trailing-negation case still holds after the postposed widening",
    cls("SignalGrid is production-ready and needs no configuration.") === "affirmative");
}

// ── 4. THE NAMED EXEMPTIONS ──────────────────────────────────────────────────
{
  const scanCmd =
    'git grep -nE "SignalGrid is production-ready|SignalGrid replaces|Imprivata partner" -- README.md docs || true';
  check("the scanner quoting its own command is self-referential, not a claim",
    cls(scanCmd) === "self_referential");
  check("...and that holds in ANY file — it is the shape, not the location",
    classifyClaim("docs/ANYWHERE.md", 9, scanCmd).classification === "self_referential");

  check("the guardrails registry may list the banned wording it registers",
    cls("- replaces Intune", "docs/PUBLIC_MESSAGING_GUARDRAILS.md") === "registry");
  check("...and the registry exemption is exactly ONE named file, not a pattern",
    CLAIM_REGISTRY_FILES.size === 1 && CLAIM_REGISTRY_FILES.has("docs/PUBLIC_MESSAGING_GUARDRAILS.md"));
  // NON-VACUITY ON THE EXEMPTION. The same text in a NON-registry doc must still flag,
  // or "registry" is just a global off-switch.
  check("...and the SAME text outside the registry file still flags",
    cls("- replaces Intune", "docs/MARKETING.md") === "affirmative");

  // KNOWN HOLE, asserted rather than left implicit. A sincere claim written INSIDE the
  // registry file is exempt — the exemption is per-file, so it cannot tell a listed
  // banned phrase from a sentence asserting one. Reproduced against the live gate: the
  // printed `registry:` count moves (8 → 9) but the lane does not.
  //
  // NOT CLOSED, deliberately. The alternative is shape heuristics ("bullets and table
  // rows are exempt, prose is not") which would themselves be guesses about how that one
  // document may be written, and a guard that fails on legitimate edits gets switched
  // off. One named file, whose entire purpose is to enumerate forbidden wording, whose
  // exempted count is printed on every run, is a smaller risk than a heuristic nobody
  // can predict. Pinned here so the limitation is a decision, not a surprise.
  check("KNOWN HOLE: a sincere claim inside the registry file IS exempt — documented and counted",
    cls("SignalGrid is MFi certified.", "docs/PUBLIC_MESSAGING_GUARDRAILS.md") === "registry");

  // Every exemption must name its reason, so a reviewer can check the reasoning rather
  // than trust the verdict.
  check("every non-affirmative verdict states WHY, and affirmative states no excuse",
    classifyClaim("docs/X.md", 1, "SignalGrid is not MFi certified.").marker !== null &&
    classifyClaim("docs/X.md", 1, "SignalGrid is MFi certified.").marker === null);
}

// ── 5. PARSING AND TALLY ─────────────────────────────────────────────────────
{
  const out = [
    'docs/A.md:12:SignalGrid is not an Imprivata partner.',
    'docs/B.md:3:SignalGrid is MFi certified.',
    'docs/PUBLIC_MESSAGING_GUARDRAILS.md:14:- replaces Intune',
    'docs/C.md:7:git grep -nE "SignalGrid is production-ready|x" -- docs || true',
  ].join("\n");
  const tally = tallyClaims(classifyScanOutput(out));
  check("the tally splits four hits into 1 affirmative / 1 disclaimed / 1 registry / 1 self-ref",
    tally.total === 4 && tally.affirmative.length === 1 && tally.disclaimed === 1 &&
    tally.registry === 1 && tally.selfReferential === 1);
  check("...and the affirmative hit is reported with file and line so it can be found",
    tally.affirmative[0]?.file === "docs/B.md" && tally.affirmative[0]?.line === 3);
  // Content containing colons must not break the path:line:content split.
  check("a content field containing colons parses correctly",
    classifyScanOutput('docs/D.md:5:note: SignalGrid is MFi certified: really')[0]?.line === 5);
  // An unparseable line must NOT be silently cleared.
  check("an unparseable scan line is treated as AFFIRMATIVE, never dropped",
    classifyScanOutput("garbage-with-no-colons")[0]?.classification === "affirmative");
  // A line the pattern never matched is `not_a_hit`, NOT `disclaimed`. It used to be
  // counted in the disclaimed figure phase-gate prints, which made that number a mix of
  // "recognised a disclaimer" and "recognised nothing" — unusable for judging reach.
  check("a line with no claim pattern is not_a_hit, and is NOT counted as disclaimed",
    cls("SignalGrid does not replace any system of record.") === "not_a_hit" &&
    tallyClaims(classifyScanOutput("docs/E.md:2:SignalGrid does not replace any system of record."))
      .notAHit === 1 &&
    tallyClaims(classifyScanOutput("docs/E.md:2:SignalGrid does not replace any system of record."))
      .disclaimed === 0);
  check("empty scan output yields an empty tally, not a phantom finding",
    tallyClaims(classifyScanOutput("")).total === 0);
}

// ── 6. THE PATTERN ITSELF STILL MATCHES WHAT IT CLAIMS TO ────────────────────
//
// If the shared source string were ever emptied or broken, every section above would
// pass by matching nothing. This is the floor under the whole file.
{
  check("the shared pattern still matches each protected phrase",
    ["SignalGrid is production-ready", "Imprivata partner", "MFi certified",
     "replaces Jamf", "replaces Intune", "autonomous production remediation"]
      .every((p) => UNSAFE_CLAIM_PATTERN.test(`prefix ${p} suffix`)));
  check("...and does NOT match innocuous prose",
    !UNSAFE_CLAIM_PATTERN.test("SignalGrid is a deterministic access-decision fabric."));
}

console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length) {
  console.error("\nFAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
