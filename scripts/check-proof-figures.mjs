// Docs↔proof FIGURE guard — the numbers, not just the check counts.
//
// `check-proof-counts.mjs` already guards one number per proof: the `(N checks)` a doc
// advertises. That caught real drift and it is not enough, because the numbers that
// actually carry the argument are the other ones — how large a space was enumerated, and
// how many states grant. Those went stale three separate times in one working session:
//
//   1. `INTEGRATION_CATALOG` quoted "eight" reason-code changes and "1,788" unknownSignals
//      as measurements "over the full raw space", two lines below a sentence declaring
//      that space to be 1,037,232. They were the PRE-SPLIT figures, correct against a
//      space 64x smaller. Nothing noticed; an adversarial reviewer re-derived them.
//   2. A PR body advertised "141 checks" and "1,037,232 raw reports" after both had moved.
//   3. `SELF_REVIEW` said `link-usability` pins "exactly six" granting shapes — true when
//      written, false two commits later when review found three of the six were
//      self-contradictory. It went stale INSIDE the pull request that made it false.
//
// The common shape: a number stated as a measurement, and then the thing it measured
// changed. A reader has no way to tell a live figure from a fossil, and the fossil is
// more persuasive than it deserves to be because it looks precise.
//
// HOW THIS WORKS. Each participating proof emits one machine-readable line:
//
//     figures=normalized=21600,raw=1354752,grants=3
//
// The guard runs the proof, reads that line, and then scans the docs. In any SCOPE that
// names the proof — a `##`/`###` section, or a single table row that names a proof of its
// own — every comma-formatted number >= 1,000 must be one of that proof's live figures,
// unless it is marked historical. See `scopesMentioning` for why a table row is its own
// unit: the intake ledger is one section holding fifty-plus rows about fifty-plus
// unrelated inputs, and section scope judged each row against every other row's proof.
//
// HISTORICAL NUMBERS ARE LEGITIMATE and the repo uses them deliberately ("proof 96 -> 162
// checks", "down from six once the roam contradiction was modelled"). They are recognised
// by the words around them rather than by an allowlist, because an allowlist of numbers
// would itself go stale — which is the whole failure being guarded against. A number
// introduced by was/were/from/previously/originally/earlier/before/until/rather than is
// read as a deliberate comparison to a past state and left alone.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True only when this file is the entrypoint, so another script can import its
 *  registry without running the gate. */
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
const docsDir = join(repoRoot, "docs");

/** Proofs that emit a `figures=` line. A proof that does not is simply not checked here —
 *  this guard never invents a figure it was not given. */
export const PROOFS = ["proof:device-management-health", "proof:link-usability", "proof:task-exception", "proof:verdict-attestation", "proof:work-context", "proof:handoff-sim", "proof:adaptive-proposals", "proof:self-audit", "proof:reliability", "proof:iac", "proof:agent-behavior", "proof:dual-control", "proof:custody-beacon", "proof:app-update", "proof:platform-sso", "proof:passkey-assurance", "proof:benchmark-selection", "proof:shift-context", "proof:change-window", "proof:bootstrap-credential", "proof:caep-events", "proof:facility-trust-graph", "proof:emitter-discipline", "proof:policy-binding", "proof:isolation-scope", "proof:mcp-answer-discipline", "proof:decision-continuity", "proof:service-lifecycle", "proof:session-readiness", "proof:evidence-coverage", "proof:break-glass", "proof:signalgrid-core", "proof:credential-rotation", "proof:observability-integrity", "proof:local-authority", "proof:launch-profile", "proof:launch-seam", "proof:operating-method", "proof:evidence-adapter", "proof:mobile-app-catalog"];

/** Words marking a number as a deliberate reference to a PAST value or a counterfactual.
 *
 *  Checked on BOTH sides. The first version looked only behind the number, and missed
 *  "…read eight and 1,788 UNTIL a review re-derived them" — where the marker follows what
 *  it qualifies, which is ordinary English. A one-directional check would have forced that
 *  sentence to be rewritten to suit the tool rather than the reader.
 *
 *  TWO EXEMPTION HOLES, both found by a negative control that did NOT fire, both fixed
 *  here, and each verified in BOTH directions against a figure first proven to be checked:
 *
 *  1. THE WINDOW CROSSED NEWLINES. `[^.]{0,60}` stops at a period but not at a line break,
 *     so a marker on the PREVIOUS line silently exempted a number on this one. Breaking a
 *     real checked figure PASSED with an innocent "before" at the end of the line above,
 *     and FAILED once the window was bounded. Now `[^.\n]{0,60}`.
 *
 *  2. THREE MARKERS WERE ORDINARY PROSE. `from`, `rather than` and `would` appear
 *     constantly in normal sentences and carry no past-tense intent — "stated plainly
 *     RATHER THAN buried" exempted the figure that followed it. Removed, and controlled the
 *     same way: the break is caught without them and passes with them restored.
 *
 *  `before` was tested for removal and KEPT. INTEGRATION_CATALOG's "measured it, **before
 *  this fix**, at 21,168 reports" is exactly the deliberate historical usage this list
 *  exists to honour; dropping it would turn a correct sentence into a failure, which is how
 *  a gate earns a reputation for crying wolf and gets switched off.
 *
 *  Neither narrowing breaks a single currently-passing figure — measured, not assumed. */
const MARKER =
  "was|were|previously|originally|earlier|before|until|had|used to|instead of|down to|up to|counterfactual|no longer|→|->";
const HISTORICAL_BEFORE = new RegExp(`\\b(?:${MARKER})\\b[^.\\n]{0,60}$`, "i");
const HISTORICAL_AFTER = new RegExp(`^[^.\\n]{0,60}\\b(?:${MARKER})\\b`, "i");

/** Comma-formatted integers of four digits or more — the shape a measured figure takes in
 *  this repo's prose. Plain four-digit numbers without separators are skipped: they are
 *  far more often years or identifiers than figures. */
const FIGURE_RE = /\b\d{1,3}(?:,\d{3})+\b/g;

function liveFigures(proof) {
  const run = spawnSync("pnpm", ["run", proof], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const line = out.match(/^figures=(.+)$/m);
  if (!line) return null;
  const values = new Set();
  for (const pair of line[1].split(",")) {
    const [, v] = pair.split("=");
    const n = Number(v);
    if (Number.isFinite(n)) {
      values.add(n);
      values.add(n.toLocaleString("en-US"));
    }
  }
  // Both readers share ONE spawn. An earlier draft called a second function that ran
  // every proof again, doubling a multi-minute gate — the kind of cost that gets a
  // check moved out of preflight, which is the same outcome as deleting it.
  values.named = namedFiguresFrom(out);
  return values;
}

/**
 * The same `figures=` line, keyed — `assertions` → 209, `categories` → 15.
 *
 * WHY A SECOND READER. `liveFigures` above throws the KEY away and keeps only values,
 * which is right for `FIGURE_RE`: that regex matches comma-formatted numbers, and a
 * bare "1,788" in prose has no key attached to compare against.
 *
 * But `FIGURE_RE` is `\d{1,3}(?:,\d{3})+` — it matches ONLY numbers with a thousands
 * separator. Every figure under 1,000 has always been invisible to this guard, and that
 * is where the drift actually lives: `docs/WHAT_SIGNALGRID_DOES_TODAY.md` claimed "13
 * normalized signal categories" against a real 15, and "206 assertions" against a real
 * 209 — the second having ALREADY been hand-corrected once, from 188. A figure that goes
 * stale twice is not a documentation slip, it is a missing check.
 *
 * Widening `FIGURE_RE` to bare integers was the obvious move and is the wrong one: it
 * would match years, versions, ports, percentages and every "13" in ordinary prose. This
 * file argues twice over that a gate which cries wolf gets switched off, and it is right.
 *
 * So this reader is NAMED and therefore narrow. A number is only checked when the
 * document writes it immediately before the figure's own key — "209 assertions",
 * "15 evidence fields". The key word must be present, so prose numbers never match, and
 * the check is exact rather than heuristic.
 */
function namedFiguresFrom(out) {
  const line = out.match(/^figures=(.+)$/m);
  if (!line) return null;
  const named = new Map();
  for (const pair of line[1].split(",")) {
    const [k, v] = pair.split("=");
    const n = Number(v);
    if (k && Number.isFinite(n)) named.set(k.trim(), n);
  }
  return named;
}

/**
 * The nouns a proof's own figure keys use — `assertions`, `categories`, `pairs`.
 *
 * These are a TRIGGER, not a binding. A number is checked when it sits just before one
 * of this proof's figure nouns; it is then tested against the proof's whole value set,
 * exactly as `FIGURE_RE` numbers are.
 *
 * BINDING THE PHRASE TO ONE KEY WAS THE FIRST DESIGN AND IT CRIED WOLF. Anchoring
 * "3,744 compromised-frontier pairs" to the key `pairs` reported it stale against
 * `pairs=9216` — but the document was right: that figure is `veto=3744`, and
 * "288 clean-authority pairs" is `unstick=288`. Four of ten reported problems were the
 * guard's own error. This file argues twice that a gate which cries wolf gets switched
 * off; a gate that invents failures in correct documentation earns that fate fastest.
 *
 * Testing against the value SET keeps the precision that matters — a bare number must
 * still sit beside a figure noun, so years, ports and versions never match — while
 * making it impossible to fail a document for describing a real measurement in its own
 * words.
 */
function figureNouns(named) {
  const nouns = new Set();
  for (const key of named?.keys() ?? []) {
    const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/);
    nouns.add(words[words.length - 1].replace(/s$/, ""));
  }
  return nouns;
}

function nounPhrase(noun) {
  return new RegExp(`\\b(\\d[\\d,]*)\\s+(?:[A-Za-z-]+\\s+){0,3}${noun}s?\\b`, "gi");
}

/** Any registered-or-not `proof:<name>` mention. Used to decide whether a table row
 *  carries its own scope — see `scopesMentioning`. Deliberately NOT limited to the
 *  PROOFS registry: a row naming a proof that emits no `figures=` line is still a row
 *  about that proof, and inheriting the section's scope would be wrong for it too. */
const PROOF_MENTION_RE = /\bproof:[a-z0-9-]+/;
const PROOF_MENTION_ALL = /\bproof:[a-z0-9-]+/g;

/**
 * Character ranges holding an INLINE code span — a single-backtick pair on one line.
 *
 * A number inside inline backticks is being EXHIBITED, not asserted. `INTAKE_LEDGER.md`
 * row 64 narrates this guard's own development and quotes two figures from other
 * contexts to do it: "value-set membership let `15 evidence fields` pass by colliding
 * with `categories=15`" and "(`3,744 compromised-frontier pairs` is `veto=3744`, not
 * `pairs=9216`)". The first quotes a string that WRONGLY passed an earlier design; the
 * second quotes a correct sentence this guard once cried wolf over. Read as claims they
 * are both false, and the guard failed on both — demanding that a document describing a
 * measurement error be unable to write the erroneous number down.
 *
 * FENCED BLOCKS ARE DELIBERATELY NOT EXEMPT, and that is not a judgement call — the
 * first version of this function exempted them and the pair-set difference immediately
 * showed what it cost:
 *
 *     LOST: proof:signalgrid-core | PRODUCT_CORE_FOUNDATION.md:167 |
 *           "209 deterministic invariant assertions"
 *
 * which is the comment in `pnpm run proof:signalgrid-core   # 209 deterministic
 * invariant assertions` — a live claim about what that command prints, and precisely the
 * kind of figure this guard exists to keep honest. A ```bash block in these docs is a
 * runnable instruction annotated with measurements; an inline span is a quotation. Same
 * character, opposite meaning.
 *
 * THE HOLE THIS STILL OPENS, stated rather than glossed: an author can exempt a live
 * claim by wrapping it in backticks. That is why the count is PRINTED every run beside
 * the out-of-SCOPE and out-of-SHAPE totals — an exemption whose size is visible is a
 * different thing from one that is not — and why the pairing is tight: an inline span
 * may not cross a newline, so a stray backtick cannot silently exempt a region.
 */
function codeSpans(text) {
  const spans = [];
  for (const m of text.matchAll(/`[^`\n]*`/g)) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

/**
 * Which proof a figure is ABOUT, when its scope names more than one.
 *
 * The scope rules above decide what text is about a proof. They do not decide what a
 * figure inside that text is about, and when a scope names several proofs the guard
 * checked every number against every registered one of them. `VALIDATION_EVIDENCE.md`
 * has the row that shows why that is wrong:
 *
 *     | Real-life simulator | `proof:signalgrid-simulator` (11 scenarios / 43
 *       assertions), `proof:room-sim`, `proof:signalgrid-core`, … | PASS |
 *
 * "43 assertions" is bound to the simulator by the parenthetical it sits in — as plainly
 * as English binds anything. The guard read it as a claim about `proof:signalgrid-core`,
 * the only REGISTERED proof in the row, and failed a correct document. Which proof a
 * number gets judged against was decided by which proofs happen to publish figures.
 *
 * So: a figure binds to the nearest PRECEDING proof mention, falling back to the first
 * following one when nothing precedes it. If that proof is not the one being checked,
 * this pass skips the figure — it is checked when its own proof comes round, or
 * announced as unchecked if that proof publishes no figures.
 *
 * PRECEDING, NOT NEAREST-BY-DISTANCE, and a control is why. The first version took the
 * smallest |mentionStart - figureStart|, which sounds neutral and is not: it measures
 * from the START of the mention, so a preceding proof is penalised by the length of its
 * own name. Dropping a deliberately wrong "(9,999 assertions)" immediately after
 * `proof:signalgrid-core` in a four-proof row, the guard PASSED — 9,999 had been
 * attributed to `proof:signalgrid-grid`, four characters further on in the other
 * direction. A rule that systematically prefers the FOLLOWING proof would have shipped
 * looking symmetric. English binds a parenthetical to what precedes it, and so does this.
 *
 * THIS CANNOT NARROW A SINGLE-PROOF SCOPE, which is the property that makes it safe: if
 * a scope names one distinct proof, every figure binds to that proof whichever side it
 * falls on. It changes behaviour only where the old rule had to guess.
 */
function nearestProof(mentions, at) {
  let before = null;
  let after = null;
  for (const m of mentions) {
    if (m.index <= at) {
      if (before === null || m.index > before.index) before = m;
    } else if (after === null || m.index < after.index) {
      after = m;
    }
  }
  return (before ?? after)?.name ?? null;
}

/** Scope by SECTION — except for a table row that names its own proof.
 *
 *  SECTION, not paragraph, because paragraph scope was the first attempt and it was too
 *  narrow to catch the drift that actually happened: the stale "eight" and "1,788" sat
 *  in a paragraph about a REMOVED guard, several paragraphs from the one naming the
 *  proof. A doc section is the unit a reader treats as being about one thing.
 *
 *  THE TABLE-ROW EXCEPTION, and the measurement that forced it. `docs/INTAKE_LEDGER.md`
 *  is one `## Ledger` section holding fifty-plus rows about fifty-plus unrelated inputs.
 *  Under pure section scope every comma-formatted number anywhere in that table was
 *  checked against every proof named anywhere in that table — so a row stating its OWN
 *  proof's live figures failed against five other proofs it merely shares a table with.
 *  That is not drift detection; it is a scope that cannot express what the document is.
 *
 *  The rule: a table row that names a proof is SELF-SCOPING; a row that names none
 *  inherits its section's scope. That keeps the coverage that matters — a laws table
 *  whose figures sit under a heading paragraph naming the proof is still checked against
 *  it, because those rows name no proof of their own — while stopping one row from being
 *  judged against another row's proof. It can only ever remove (proof, figure) pairs that
 *  were never about each other; it cannot hide a number from the proof it belongs to,
 *  because the row that names that proof is exactly the row that stays scoped to it.
 *
 *  THE SAME UNIT IN THE OTHER SYNTAX: a top-level LIST ITEM. `INTEGRATION_CATALOG`'s
 *  "Endpoint-management, NAC, entitlement and provisioning proofs" section is a bulleted
 *  list of one entry per proof — structurally identical to the ledger table, written with
 *  `-` instead of `|`. It went unnoticed only because none of the proofs it named were
 *  registered here; the moment one was, every OTHER bullet's figures (1,200 for
 *  entitlement-binding, 3,600 and 14,400 for response-accountability) were judged against
 *  that one proof. The table-row rule was the right rule attached to the wrong syntax.
 *
 *  A list item is its `- `/`* ` line plus the indented lines continuing it, so the block
 *  is reconstructed rather than assumed to be one line — a multi-line bullet is one
 *  bullet. Nested bullets stay with their parent: they are continuation, not a new
 *  subject.
 *
 *  NARROWING A GUARD NEEDS EVIDENCE, NOT AN ARGUMENT, so this one was measured rather
 *  than reasoned about: the (proof, figure) pair sets were computed under both the old
 *  and new scoping and differenced. Exactly five pairs are lost and none is gained, and
 *  every lost pair is `proof:service-lifecycle` against a number belonging to a
 *  different bullet — 1,200 (entitlement-binding), 1,440 (uem), 3,600 and 14,400
 *  (response-accountability), and 1,128, which is a character-length allowlist bound and
 *  never was a figure. No other proof loses a pair; no proof loses one of its own. */
function scopesMentioning(text, needle) {
  const lines = text.split("\n");
  const bounds = [];
  lines.forEach((l, i) => {
    if (/^#{2,3} /.test(l)) bounds.push(i);
  });
  bounds.push(lines.length);
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    sections.push({ start: bounds[i], lines: lines.slice(bounds[i], bounds[i + 1]) });
  }
  // A doc with no headings is one section.
  if (sections.length === 0) sections.push({ start: 0, lines });

  const scopes = [];
  for (const section of sections) {
    // Self-scoped units are BLANKED rather than removed, so a match's line offset inside
    // the inherited scope still maps back to its real line number in the file.
    const inherited = [...section.lines];

    for (let i = 0; i < inherited.length; i += 1) {
      const line = inherited[i];
      // A table row: one line, self-scoping when it names a proof.
      if (/^\s*\|/.test(line) && PROOF_MENTION_RE.test(line)) {
        if (line.includes(needle)) scopes.push({ p: line, startLine: section.start + i });
        inherited[i] = "";
        continue;
      }
      // A top-level list item: this line plus its indented continuations.
      if (/^[-*] /.test(line)) {
        let end = i + 1;
        while (end < inherited.length && /^\s+\S/.test(inherited[end])) end += 1;
        const block = inherited.slice(i, end).join("\n");
        if (PROOF_MENTION_RE.test(block)) {
          if (block.includes(needle)) scopes.push({ p: block, startLine: section.start + i });
          for (let k = i; k < end; k += 1) inherited[k] = "";
        }
        i = end - 1;
      }
    }

    const joined = inherited.join("\n");
    if (joined.includes(needle)) scopes.push({ p: joined, startLine: section.start });
  }
  return scopes;
}

function main() {
  console.log("Docs↔proof FIGURE guard — a number stated as a measurement must still be one\n");

  let failures = 0;
  let checked = 0;
  /** DISTINCT figures reached, keyed by file + line + value.
   *
   *  `checked` counts (proof, figure) PAIRS, and one figure can be paired with several
   *  proofs that share a scope — so subtracting it from the document's total to report
   *  "not checked" understates the gap, and with enough multi-proof sections would go
   *  negative. The coverage line this guard prints is itself a measurement; it gets the
   *  same treatment as the ones it polices. */
  const reached = new Set();
  const pairLog = [];
  /** Figures deliberately NOT judged, keyed by file+line+offset so a figure skipped for
   *  several proofs is counted once. Printed every run — see the coverage block below. */
  const quoted = new Set();
  const attributedElsewhere = new Set();
  // RECURSIVE on purpose (D3): a doc moved into docs/research/ must stay inside
  // guard scope — a non-recursive scan let a move silently un-check a figure.
  const docFiles = readdirSync(docsDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md"));

  for (const proof of PROOFS) {
    const figures = liveFigures(proof);
    if (figures === null) {
      console.error(`✗ ${proof} — emitted no \`figures=\` line. Add one, or remove it from PROOFS.`);
      failures += 1;
      continue;
    }
    const live = [...figures].filter((v) => typeof v === "string").sort();
    console.log(`  ${proof} — live figures: ${live.join(", ")}`);

    for (const file of docFiles) {
      const text = readFileSync(join(docsDir, file), "utf8");
      for (const { p, startLine } of scopesMentioning(text, proof)) {
        const mentions = [...p.matchAll(PROOF_MENTION_ALL)].map((x) => ({ name: x[0], index: x.index }));
        const spans = codeSpans(p);
        /** Shared by both passes: is this figure an exhibit, or about another proof?
         *  Returns true when the figure should not be judged against `proof`. */
        const skip = (at, key) => {
          if (spans.some(([a, b]) => at >= a && at < b)) {
            quoted.add(key);
            return true;
          }
          const owner = nearestProof(mentions, at);
          if (owner !== null && owner !== proof) {
            attributedElsewhere.add(key);
            return true;
          }
          return false;
        };
        // ── NOUN-ADJACENT pass — see figureNouns. Catches figures under 1,000,
        // which `FIGURE_RE` (comma-formatted only) has never been able to see.
        for (const noun of figureNouns(figures.named)) {
          for (const m of p.matchAll(nounPhrase(noun))) {
            const stated = Number(m[1].replace(/,/g, ""));
            if (!Number.isFinite(stated)) continue;
            const lineNo = startLine + p.slice(0, m.index).split("\n").length - 1;
            if (skip(m.index, `${file}:${lineNo}:${m.index}`)) continue;
            checked += 1;
            reached.add(`${file}:${lineNo}:${m.index}:noun:${m[0]}`);
            pairLog.push(`${proof} | ${file}:${lineNo} | noun | ${m[0].trim()}`);
            // A MULTI-WORD key binds exactly when the phrase contains all its words:
            // "15 evidence fields" is unambiguously `evidenceFields`, so it is checked
            // against 18 rather than against the value set — where it would have passed
            // by colliding with `categories=15`, a different measurement entirely.
            //
            // Single-word keys deliberately do NOT bind. "3,744 compromised-frontier
            // pairs" contains "pairs", but its real key is `veto`; binding on one word
            // is what produced four false failures against correct documentation.
            const phrase = m[0].toLowerCase();
            let bound = null;
            for (const [key, value] of figures.named ?? []) {
              const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/);
              if (words.length < 2) continue;
              if (words.every((w) => phrase.includes(w.replace(/s$/, "")))) bound = { key, value };
            }
            if (bound) {
              if (stated === bound.value) continue;
              const b4 = p.slice(0, m.index);
              const af = p.slice(m.index + m[0].length);
              if (HISTORICAL_BEFORE.test(b4) || HISTORICAL_AFTER.test(af)) continue;
              console.error(`\n✗ docs/${file} — "${m[0].trim()}" in a section about ${proof},`);
              console.error(`  but that proof measures ${bound.key}=${bound.value}.`);
              failures += 1;
              continue;
            }
            if (figures.has(stated)) continue;
            const before = p.slice(0, m.index);
            const after = p.slice(m.index + m[0].length);
            if (HISTORICAL_BEFORE.test(before) || HISTORICAL_AFTER.test(after)) continue;
            console.error(`\n✗ docs/${file} — "${m[0].trim()}" in a section about ${proof},`);
            console.error(`  but that proof's live figures are: ${live.join(", ")}`);
            failures += 1;
          }
        }

        for (const m of p.matchAll(FIGURE_RE)) {
          const lineNo = startLine + p.slice(0, m.index).split("\n").length - 1;
          if (skip(m.index, `${file}:${lineNo}:${m.index}`)) continue;
          checked += 1;
          reached.add(`${file}:${lineNo}:${m.index}:${m[0]}`);
          pairLog.push(`${proof} | ${file}:${lineNo} | comma | ${m[0]}`);
          if (figures.has(m[0])) continue;
          // A deliberate comparison to a past value or a counterfactual, in either
          // direction. Judged by the words around the number rather than by an allowlist of
          // numbers — an allowlist of numbers would itself go stale, which is the exact
          // failure being guarded against.
          const before = p.slice(0, m.index);
          const after = p.slice(m.index + m[0].length);
          if (HISTORICAL_BEFORE.test(before) || HISTORICAL_AFTER.test(after)) continue;
          console.error(`\n✗ docs/${file} — "${m[0]}" is stated in a ${p.includes("\n") ? "section" : "table row"} about ${proof},`);
          console.error(`  but that proof's live figures are: ${live.join(", ")}`);
          const line = p.split("\n").find((l) => l.includes(m[0])) ?? "";
          console.error(`  ${line.trim().slice(0, 160)}`);
          failures += 1;
        }
      }
    }
  }

  // ANNOUNCE WHAT THIS GUARD CANNOT SEE, every run. `checked` on its own reads as
  // coverage, and it is not: two independent filters keep most doc figures out of
  // reach, and an audit found 11 stale claims living in the gap — including a copy
  // of a fossil that had just been corrected 40 lines away in another file.
  //
  //   SCOPE filter  — only `docs/*.md`, and only inside a `##`/`###` section whose
  //                   text contains a registered `proof:<name>`. A section naming a
  //                   GUARD, a script, a suite, or the `proof:*` glob matches nothing,
  //                   and `####` does not open a section.
  //   SHAPE filter  — FIGURE_RE sees only comma-formatted numbers >= 1,000. Every
  //                   bare number is invisible even inside a perfectly scoped section.
  //
  // Both are stated as live measurements rather than prose so they cannot quietly rot
  // the way the numbers they describe did.
  const allCommaFigures = docFiles.reduce(
    (n, f) => n + [...readFileSync(join(docsDir, f), "utf8").matchAll(FIGURE_RE)].length,
    0,
  );
  const bareMeasurementRe =
    /\b\d{2,3}\b(?=[^.\n]{0,24}\b(?:checks?|assertions?|gates?|mutations?|proofs?|scripts?|states?|combos?|categories|tests?|survivors?|killed|scenarios?|dimensions?|connectors?|targets?)\b)/gi;
  const bareMeasurements = docFiles.reduce(
    (n, f) => n + [...readFileSync(join(docsDir, f), "utf8").matchAll(bareMeasurementRe)].length,
    0,
  );

  // FIGURE_GUARD_DUMP=<path> writes every (proof, file:line, figure) pair this run
  // judged. It exists to make the rule stated in `scopesMentioning` — "NARROWING A GUARD
  // NEEDS EVIDENCE, NOT AN ARGUMENT" — something you can execute rather than promise:
  // dump before the change, dump after, `comm` the two, and read what coverage moved.
  //
  // Both narrowings below were accepted on that evidence, 68 pairs → 64, none gained:
  //
  //     LOST  INTAKE_LEDGER.md:43     1,000               (FIGURE_RE's own bound)
  //     LOST  INTAKE_LEDGER.md:43     3,744               (a quoted example)
  //     LOST  INTAKE_LEDGER.md:43     15 evidence fields  (a quoted WRONG example)
  //     LOST  VALIDATION_EVIDENCE.md:24  43 assertions    (the simulator's, not core's)
  //
  // The same procedure rejected a third: exempting FENCED blocks alongside inline spans
  // cost `209 deterministic invariant assertions` in PRODUCT_CORE_FOUNDATION.md, a live
  // claim, so fenced blocks stayed in scope. The argument for it had sounded identical.
  if (process.env.FIGURE_GUARD_DUMP) {
    writeFileSync(process.env.FIGURE_GUARD_DUMP, pairLog.sort().join("\n"));
  }
  console.log(`\nfigures checked in docs: ${reached.size} distinct (${checked} proof×figure pairs)`);
  console.log(
    `NOT checked — out of SCOPE: ${allCommaFigures - reached.size} of ${allCommaFigures} comma-formatted figures ` +
      `sit outside any proof-named scope`,
  );
  console.log(
    `NOT checked — out of SHAPE: ~${bareMeasurements} bare measurement-adjacent numbers ` +
      `(FIGURE_RE only matches comma-formatted values >= 1,000)`,
  );
  console.log(
    `NOT checked — QUOTED: ${quoted.size} figures sit inside backticks (exhibits a document ` +
      "writes down, not claims it makes)",
  );
  console.log(
    `NOT checked — ATTRIBUTED ELSEWHERE: ${attributedElsewhere.size} figures in multi-proof ` +
      "scopes bind to a nearer proof than the one being checked",
  );
  console.log(
    "  Partial coverage announced every run is a very different thing from partial\n" +
      "  coverage that looks complete. Widening either filter is tracked work, not a waiver.",
  );

  if (failures > 0) {
    console.error(
      `\nFigure guard FAILED: ${failures} problem${failures === 1 ? "" : "s"}.\n\n` +
        "A number presented as a measurement has to still be one. Either re-measure and update\n" +
        "the doc, or — if the number is a deliberate reference to a past value — write it that\n" +
        'way ("was 1,037,232", "down from 21,168"), which is both clearer and recognised here.\n',
    );
    process.exit(1);
  }

  console.log("Figure guard passed — every measured figure in the docs matches a live proof run.");

}

if (IS_MAIN) main();
