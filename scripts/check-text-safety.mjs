#!/usr/bin/env node
// Text safety — no tracked file may contain characters that make it RENDER
// differently from how it EXECUTES.
//
//   node scripts/check-text-safety.mjs
//
// WHY THIS EXISTS. This repo's whole premise is that what you read is what runs:
// deterministic decisions, derived figures, gates that fail loudly. Every existing
// guard checks the MEANING of the text — is the number measured, is the fetch gated,
// is the doc reachable. None of them check that the text IS what it appears to be.
//
// It need not be. Unicode bidirectional control characters (U+202A-U+202E,
// U+2066-U+2069) reorder a line for DISPLAY without changing a single byte the
// compiler sees. That is Trojan Source, CVE-2021-42574: a reviewer reads a guard
// clause and approves it, while the parser sees the comment boundary somewhere else
// entirely and the guard is inert. The same family — zero-width joiners, the word
// joiner, the soft hyphen, the Hangul fillers — hides segments INSIDE identifiers and
// string literals that no eye can separate. Nothing in this repo looked for any of
// it: gitleaks scans for secrets, CodeQL for dataflow, and neither has an opinion
// about text that lies about itself.
//
// PROVENANCE. The idea came from `scripts/check-text-safety.cjs` on the orphan branch
// `codex/add-signalgrid-autopilot-evidence-bot` (docs/BRANCH_HYGIENE.md), which was
// NOT landed as written. It asserted against a hand-typed list of five paths, four of
// which do not exist on the default branch, so it would have failed on its first run
// — and had it passed, a five-path allowlist is the declared-not-derived defect this
// repo keeps removing: a scan whose scope is typed out goes stale the moment someone
// adds a file. Here the scope is `git ls-files`. A new file is covered because it is
// tracked, not because anyone remembered it.
//
// THE VACUOUS-PASS PROBLEM, and what is actually done about it. A scan for characters
// that almost never occur is INDISTINGUISHABLE from a scan that is not looking: both
// print green forever. That is the exact shape of the doc-orphan gate that spent its
// life blind to every subdirectory. So this file does not trust its own silence:
//
//   · SELF-TEST, with INDEPENDENT specimens. Before scanning anything real, the same
//     scanner is run over planted specimens listed in their own right — not read out
//     of the detector. The first draft of this file did read them out of the detector,
//     and a mutation test killed it: deleting one code point from the set also deleted
//     the only test of that code point, and the gate stayed green. Coverage that
//     certifies itself certifies nothing.
//   · DERIVED SCOPE, REPORTED. Tracked / scanned / binary counts print on every run,
//     so a collapse in coverage is visible rather than silent.
//   · ZERO-SCAN REFUSAL. Scanning no files is a failure, not a pass. So is a failed
//     `git ls-files` — an error is not an empty repository.
//
// WHAT THIS DOES NOT COVER, said plainly because the tempting version overclaims:
//
//   · HOMOGLYPHS (CVE-2021-42694) — a Cyrillic character standing in for its Latin
//     twin, and the rest of the confusables table. Catching those means mixed-script
//     identifier analysis; the naive "flag non-ASCII" version would fire on every
//     accented word in the docs. Not attempted. A green run here says NOTHING about it.
//   · Line endings. A lone CR can overwrite a rendered line in some viewers. That is a
//     `.gitattributes` concern with a different failure mode, left alone deliberately
//     rather than bundled in to inflate this gate's apparent reach.
//   · Untracked and ignored files. Scope is what git tracks, because that is what ships.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// THE SET OF "HIDDEN" IS DERIVED FROM UNICODE, NOT TYPED OUT HERE.
//
// General category Cf, "Other, Format" — Unicode's own name for characters that carry
// formatting instructions and render as nothing. That is precisely the class Trojan
// Source exploits: U+202A-U+202E and U+2066-U+2069 are members, as are the zero-width
// joiners, the word joiner, the soft hyphen, the Arabic letter mark and U+FEFF.
// Nobody has to remember them, the set cannot be shortened by deleting a line, and a
// format character introduced by a future Unicode revision is in scope the day the
// runtime implements it.
const FORMAT_CHAR = /\p{Cf}/u;

// The exception the derivation cannot make. These four render as blank but are
// LETTERS to Unicode (category Lo), so `\p{Cf}` does not match them and should not —
// which is exactly what makes them useful for hiding an invisible segment inside an
// identifier. Enumerated because no Unicode property means "letter that looks like
// nothing". The self-test treats them as first-class specimens.
const BLANK_LETTERS = new Set([0x115f, 0x1160, 0x3164, 0xffa0]);

// Labels ONLY. Detection never consults this map: an unnamed character is still a
// finding, reported by code point. It exists so a failure reads "RIGHT-TO-LEFT
// OVERRIDE" instead of sending a reviewer to a Unicode table mid-review, and a gap in
// it degrades the message rather than the gate.
const LABELS = new Map([
  [0x00ad, "SOFT HYPHEN"],
  [0x061c, "ARABIC LETTER MARK"],
  [0x115f, "HANGUL CHOSEONG FILLER"],
  [0x1160, "HANGUL JUNGSEONG FILLER"],
  [0x180e, "MONGOLIAN VOWEL SEPARATOR"],
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"],
  [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2060, "WORD JOINER"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"],
  [0x2069, "POP DIRECTIONAL ISOLATE"],
  [0x3164, "HANGUL FILLER"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE / BOM"],
  [0xffa0, "HALFWIDTH HANGUL FILLER"],
]);

const describe = (cp) => {
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  const label = LABELS.get(cp);
  return label ? `${hex} ${label}` : `${hex} (invisible — Unicode category Cf)`;
};

/**
 * Scan one text blob. Returns one finding per occurrence.
 *
 * Iterates by CODE POINT, not by UTF-16 code unit. Several format characters live
 * above the BMP — the tag block U+E0020-U+E007F among them — and indexing a string by
 * code unit hands the matcher a lone surrogate, which matches no property and is
 * skipped in silence. Columns are therefore code-point offsets, which is what someone
 * counting characters expects anyway.
 *
 * The self-test drives THIS function, not a copy of it: a control that exercises
 * different code from the real run proves nothing about the real run.
 */
function scanText(path, text) {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const chars = [...lines[i]];
    for (let col = 0; col < chars.length; col += 1) {
      const ch = chars[col];
      const cp = ch.codePointAt(0);
      if (!BLANK_LETTERS.has(cp) && !FORMAT_CHAR.test(ch)) continue;
      findings.push({
        path,
        line: i + 1,
        column: col + 1,
        cp,
        name: describe(cp),
        // Shows WHERE without reprinting the character. Echoing the raw byte into a
        // terminal reproduces the deception inside the error message about it.
        context: `${chars.slice(Math.max(0, col - 30), col).join("")}[HERE]${chars
          .slice(col + 1, col + 31)
          .join("")}`,
      });
    }
  }
  return findings;
}

// ── Self-test: the detector is shown to detect before it is believed ──────────
//
// THESE SPECIMENS ARE INDEPENDENT OF THE DETECTOR ON PURPOSE, and must stay that way.
// A control that reads its expectations out of the thing under test moves in lockstep
// with it and can never register a regression — which is not a hypothetical here: the
// first draft looped over the detector's own set, and removing a code point removed
// its only test along with it. Narrowing the detector has to FAIL here, loudly, and it
// only can while these are stated in their own right.
//
// Every entry is a code point a Trojan Source proof-of-concept or an
// invisible-identifier trick actually uses, plus one astral specimen (U+E0061), which
// exists because code-unit iteration would miss it and that mistake is invisible in a
// green run.
const SPECIMENS = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embeddings and overrides
  0x2066, 0x2067, 0x2068, 0x2069, // bidi isolates
  0x200b, 0x200c, 0x200d, 0x2060, // the zero-width family
  0x200e, 0x200f, 0x061c, 0x00ad, 0xfeff, // marks, soft hyphen, BOM
  0x115f, 0x1160, 0x3164, 0xffa0, // blank letters, which are NOT Cf
  0xe0061, // TAG LATIN SMALL LETTER A — above the BMP
];
{
  const missed = [];
  for (const cp of SPECIMENS) {
    // Same shape as a real hit: mid-line, ordinary text on both sides.
    const planted = `const ok = "left${String.fromCodePoint(cp)}right";\n`;
    const found = scanText("<self-test>", planted);
    if (found.length !== 1 || found[0].cp !== cp) missed.push(describe(cp));
  }
  // The converse. A gate that flags everything is as useless as one that flags
  // nothing, and accented letters, arrows and dashes are all over these docs.
  const falsePositives = scanText("<self-test>", 'const ok = "plain ascii, é, ✓, →, —, ·";\n');
  if (missed.length > 0 || falsePositives.length > 0) {
    console.error("✗ text-safety self-test FAILED — the scanner is not scanning.\n");
    for (const m of missed) console.error(`    planted but NOT detected: ${m}`);
    for (const f of falsePositives) console.error(`    false positive on clean text: ${f.name}`);
    console.error(
      "\n  Refusing to report on the repository at all. A detector that cannot flag a\n" +
        "  planted character prints exactly the same green over a real one, so its\n" +
        "  silence about every tracked file would mean nothing.",
    );
    process.exit(1);
  }
}

// ── Scope, derived from what git tracks ───────────────────────────────────────
let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch (err) {
  // A failed listing is not an empty listing. Reporting "0 files, all clean" over a
  // git error is the read-error-swallowing defect this repo has its own gate for.
  console.error(`✗ could not list tracked files: ${err.message}`);
  console.error("  This is a read failure, not a clean repository. Refusing to report a pass.");
  process.exit(1);
}
if (tracked.length === 0) {
  console.error("✗ git reported ZERO tracked files — refusing to call that a clean scan.");
  process.exit(1);
}

console.log("Text safety — no tracked file may hide or reorder its own text\n");

const findings = [];
let scanned = 0;
let binary = 0;
let unreadable = 0;

for (const rel of tracked) {
  let buf;
  try {
    buf = readFileSync(join(repoRoot, rel));
  } catch {
    // Submodule entries, broken symlinks, files staged but absent from the worktree.
    // Counted and printed rather than dropped: an unread file is not a clean file.
    unreadable += 1;
    continue;
  }
  if (buf.includes(0x00)) {
    binary += 1;
    continue;
  }
  scanned += 1;
  findings.push(...scanText(rel, buf.toString("utf8")));
}

console.log(`  specimens detected:  ${SPECIMENS.length}/${SPECIMENS.length}  (self-test)`);
console.log(`  tracked files:       ${tracked.length}`);
console.log(`  scanned as text:     ${scanned}`);
console.log(`  skipped as binary:   ${binary}  (contain a NUL byte)`);
if (unreadable > 0) {
  console.log(`  UNREADABLE:          ${unreadable}  (submodule / symlink / absent — NOT checked)`);
}

if (scanned === 0) {
  console.error(
    "\n✗ zero files were scanned as text. That is a failure, not a pass — every file\n" +
      "  classified binary means the reader broke, not that the repository is clean.",
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✗ ${findings.length} hidden or bidirectional character(s) in tracked files:\n`);
  for (const f of findings) {
    console.error(`    ${f.path}:${f.line}:${f.column}  ${f.name}`);
    console.error(`        ...${f.context}...`);
  }
  console.error(
    "\n  These change how a line RENDERS without changing what it DOES — Trojan Source,\n" +
      "  CVE-2021-42574. Remove them. If one is genuinely required by content (a bidi\n" +
      "  language sample, an emoji sequence needing U+200D), it needs an explicit\n" +
      "  exemption added HERE with a stated reason, so the decision is reviewable rather\n" +
      "  than inferred from this gate's silence.",
  );
  process.exit(1);
}

console.log(
  "\n  NOT established: that no homoglyph substitution exists (CVE-2021-42694 — a\n" +
    "  Cyrillic character standing in for its Latin twin). That needs mixed-script\n" +
    "  identifier analysis, is deliberately not attempted here, and a green run above\n" +
    "  says nothing whatsoever about it.",
);
console.log("\nText-safety gate passed.");
