// Freshness divergence gate — ONE rule, one body, and every exemption said out loud.
//
//   node scripts/check-freshness-divergence.mjs
//   node scripts/check-freshness-divergence.mjs --self-test   prove it can fail
//
// WHY THIS EXISTS. The rule is one sentence: a sighting timestamped in the FUTURE,
// beyond an allowed skew, is not evidence of freshness. It resolves to the family's
// RAISING member, never to "fresh". `lib/integrations/src/utils/freshness.ts` holds
// the body. It did not hold all of them.
//
// A survey on 2026-09-02 read every now-comparison in `lib/*/src` and found
// NINETEEN further hand-rolled copies of that sentence — ELEVEN inside
// lib/integrations (pacs-access, access-governance, change-window,
// observability-integrity, credential-rotation x3, local-authority x2,
// benchmark-selection, device-management-health) and EIGHT outside it
// (integration-bridge, signalgrid-core/util, ddm-connector, fleet-connector,
// facility-trust-graph x3, verdict-attestation). The last of those was found only
// after this gate's `now` pattern was widened to accept an `obj.` qualifier — the
// first run's count was eighteen, and the number in a header is worth exactly the
// scan behind it.
//
// TOLERANCES: THREE, not two. This header said TWO (60s and zero) for one day. That
// count was an artifact of this gate's own blind spot: the `now` pattern excluded a
// literal `Date.now()`, so `lib/location/src/validate.ts:8-9` — `Date.now() -
// input.observedAt` guarded at `< -30_000` — was never matched and never counted. The
// pattern now accepts `Date.now()`, the site is matched, and the measured set is:
//
//     60s   lib/integrations/src/utils/freshness.ts  FUTURE_SKEW_TOLERANCE_MS
//     60s   lib/verdict-attestation/src/attest.ts    DEFAULT_MAX_SKEW_MS
//     30s   lib/location/src/validate.ts             hand-rolled, `-30_000`
//     0     every other site (a caller-posed reference has no second clock to skew)
//
// Measured, not remembered. This grep, run against this tree on 2026-09-02, printed
// SIX lines across exactly THREE files — the three tolerance sites plus three further
// uses of the same two constants, and no fourth file:
//
//     $ grep -rnE 'SKEW_MS|SKEW_TOLERANCE_MS|< *-[0-9_]+' lib/*/src --include=*.ts | grep -vE '//'
//     lib/integrations/src/utils/freshness.ts:...:export const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;
//     lib/integrations/src/utils/freshness.ts:...: * `skewToleranceMs` defaults to `FUTURE_SKEW_TOLERANCE_MS`. Pass `0` only with a
//     lib/integrations/src/utils/freshness.ts:...:  skewToleranceMs: number = FUTURE_SKEW_TOLERANCE_MS,
//     lib/location/src/validate.ts:10:  if (ageMs < -30_000) return { ok: false, error: "observedAt is in the future" };
//     lib/verdict-attestation/src/attest.ts:18:const DEFAULT_MAX_SKEW_MS = 60_000;
//     lib/verdict-attestation/src/attest.ts:186:  const maxSkew = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
//
// (freshness.ts's own line numbers are elided: they move whenever this header is
// edited, and a number that rots is worse than no number. Re-run the grep.)
//
// Every one of them already guarded the VERDICT. What one of them did not guard was
// the published AGE: local-authority's `no_grant_policy` branch computed
// `Math.floor((now - issued) / 1000)` with no future check and published
// `grantAgeSeconds: -30` for a grant dated thirty seconds ahead — a negative age
// compares as smaller than every bound and renders as a reading nobody observed.
// Its sibling normalizer, credential-rotation, refuses to emit exactly that, in a
// comment. One copy had the lesson written on it and the copy next door did not.
// That is what a copy is for.
//
// WHAT IS GATED (unambiguous, and only that):
//   A file under `lib/**/src` that performs a hand-rolled future/age comparison —
//   a relational or subtractive comparison against a `now`/reference instant, a
//   relational use of `Date.parse(...)`/`.getTime()`, or a `FUTURE`/`skew`
//   identifier — must EITHER import from `utils/freshness` OR carry
//
//       // freshness: local-by-design — <reason>
//
//   on the offending line or the line above it — with a REASON of at least 10
//   characters containing at least one letter. There is no third option and no
//   silent list: the markers are PRINTED on every run (REPORTED, below), so an
//   exemption is a sentence someone wrote, in the file, that everyone reads.
//
//   The reason floor exists because `— ` followed by two spaces satisfied the old
//   `(.+)$` capture: the site was exempted, the count read zero violations, and the
//   REPORTED line printed a blank. An exemption with no reason is the silent list
//   this gate was written to refuse, wearing the marker's clothes. QUALITY of the
//   reason remains out of scope and always will be — `— because it is` passes. The
//   gate refuses ABSENCE, not weakness; judging prose is not something a regex may
//   pretend to do.
//
//   IMPORTING THE HELPER IS NOT A FILE-WIDE PASS. It was, until 2026-09-02, and that
//   was the largest hole this gate ever had: `findHits` returned early on the import,
//   so every line of the TWELVE importer files was exempt — no marker, no report, no
//   count. `const age = nowMs - t; if (age < 0) return "fresh";` planted in
//   `pacs-access/evaluate.ts` PASSED. Matching is now per LINE: a hit in an importer
//   file is a violation unless that LINE calls `ageMs(` / `deriveFreshness(` (it is
//   using the shared body, which is the point) or carries a marker. Import position
//   is now only REPORTED, and floored, never an exemption.
//
// WHAT IS REPORTED, NOT GATED: the marker set itself, the tolerance each exempted
// site uses, and the lines exempted by calling the shared helper inline. Whether a
// given family's reason is a GOOD reason is a judgement, and this gate does not
// pretend to make it — it only refuses to let the reason be absent.
//
// WHAT THIS GATE DELIBERATELY DOES NOT COVER — said out loud, because an unstated
// boundary reads as a claim of coverage:
//   · `artifacts/**`, including `artifacts/api-server/src`. The walk is `lib/*/src`
//     and nothing else. api-server was read BY HAND on 2026-09-02 with this file's
//     widened pattern (65 matching lines): 63 are `new Date(Date.now() - 12_000)`
//     demo-fixture timestamps in `routes/integrations.ts`, one is the uptime gauge
//     (`lib/metrics.ts:171`), and one is an idempotency TTL
//     (`middlewares/idempotency.ts:87`). No sighting-freshness derivation and no
//     future guard among them. That is a hand scan with a date on it, not a gate,
//     and it stops being true the moment someone adds a connector there.
//   · TTL / EXPIRY sites, whose rule runs the OPPOSITE direction: an unreadable
//     bound must read EXPIRED, where an unreadable SIGHTING must read UNKNOWN. This
//     gate still MATCHES those lines — the shapes are indistinguishable to a regex —
//     so they carry markers saying which family they belong to. It does not check
//     that they fail closed. `scripts/check-nan-fail-open.mjs` does, and only where
//     the value passes through `Date.parse` / `.getTime()`; a marker naming that gate
//     for a plain finite-number bound names a gate with nothing to key on.
//   · Whether a folded call passes the RIGHT tolerance. `ageMs(t, now, 0)` and
//     `ageMs(t, now, 60_000)` are equally green here.
//   · `.swift`, `.kt`, `.mjs`, tests, and fixtures.
//   · Subtraction of a NUMERIC LITERAL from now — `new Date(Date.now() - 86400000)`
//     — which mints a fixed past instant and cannot be an age derived from an
//     observed timestamp. Excluded deliberately (five demo-fixture rows in
//     `deviceRegistry.ts`); the relational rules still fire on any comparison built
//     from such a value, and `cutoff` is itself a `now` token.
//
// COMMENTS ARE STRIPPED before matching, and this is load-bearing. This file, the
// helper's header, and every fix comment quote the defective shapes verbatim while
// explaining them. A gate that matched raw text would fire on the prose describing
// the bug and the fix would be to delete the explanation. The MARKER, by contrast,
// is deliberately read from the RAW line — it lives in a comment by construction.
//
// SELF-TEST: a planted bare comparison must FAIL; the same line with a marker must
// pass AND appear in the reported marker list; an unmarked comparison inside a
// comment must NOT fire; a planted bare comparison INSIDE A FILE THAT IMPORTS THE
// HELPER must FAIL; an empty or whitespace-only marker reason must FAIL. A gate that
// has never failed proves nothing. (The former case "a file that imports the helper
// is exempt" asserted the F1 hole itself; it is not deleted but SPLIT into the two
// cases that state what was actually intended — a folded line passes, a bare line in
// the same file does not.)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = /(^|\/)(node_modules|dist|build|\.git|coverage|third_party|__fixtures__)(\/|$)/;
const SRC = /\.(ts|mts|tsx)$/;

// The canonical body. It IS the rule, so it cannot diverge from itself.
const CANONICAL = "lib/integrations/src/utils/freshness.ts";

const IMPORTS_HELPER = /from\s+["'][^"']*utils\/freshness["']/;
// A LINE that uses the shared body. This — not the file's import list — is what
// exempts a line in an importer file.
const FOLDED_CALL = /\b(?:ageMs|deriveFreshness)\s*\(/;
// Written to match the marker anywhere on the line, with either dash, because a
// gate that insists on one Unicode character teaches people to fight the gate.
const MARKER = /\/\/\s*freshness:\s*local-by-design\s*[—-]\s*(.+)$/;
// A reason must be SAID. Ten characters and at least one letter is the floor: enough
// to exclude `— `, `—  `, `— .` and `— 1`, and far short of judging the sentence.
const MIN_REASON_CHARS = 10;
const hasReason = (r) => r.trim().length >= MIN_REASON_CHARS && /[A-Za-z]/.test(r);

// A `now`-shaped reference. Deliberately narrow: these four spellings are the ones
// the tree actually uses, and a wider pattern (`\w*[Nn]ow\w*`) fired on `knownAt`.
// An optional `obj.` qualifier is part of the token, and leaving it out was a real
// miss: `att.issuedAt > options.now + maxSkew` in verdict-attestation — a THIRD
// hand-rolled skew tolerance, at the same 60s — went unflagged on the first run
// because the pattern demanded a bare `now` on the right of the operator.
// A literal `Date.now()` is part of the token, and leaving THAT out was the second
// miss: `lib/location/src/validate.ts:8` held a third tolerance (30s) and never
// matched. Note the word boundaries live INSIDE the token: `\b` after a `)` is not a
// boundary at all, so the old `\b${NOW}\b` wrapper would have silently refused every
// `Date.now()` match had the alternative simply been dropped in.
const NOW = String.raw`(?:\bDate\.now\s*\(\s*\)|\b(?:\w+\.)?(?:now|nowMs|nowIso|referenceMs|referenceInstant|referenceTime|cutoff)\b)`;
const PARSE = String.raw`(?:Date\.parse\s*\(|\.getTime\s*\(\))`;

const RULES = [
  // `t > nowMs` / `nowMs < t` — the relational future check.
  ["relational-vs-now", new RegExp(String.raw`\b\w+\s*[<>]=?\s*${NOW}|${NOW}\s*[<>]=?\s*\b\w+`)],
  // `nowMs - t` / `t - nowMs` — the age subtraction. `(?!\d)` excludes a NUMERIC
  // LITERAL subtrahend: `new Date(Date.now() - 86400000)` mints a fixed instant in
  // the past (demo fixtures do this), it does not derive an age from a sighting.
  ["age-subtraction", new RegExp(String.raw`${NOW}\s*-\s*(?!\d)\b\w+|\b\w+\s*-\s*${NOW}`)],
  // A parse expression used relationally at all.
  ["parsed-relational", new RegExp(String.raw`${PARSE}[^;\n]*[<>]=?|[<>]=?[^;\n]*${PARSE}`)],
  // A local future/skew notion — a second copy of the tolerance, by any name.
  ["local-skew-notion", /\b(?:FUTURE_SKEW|futureSkew|SKEW_TOLERANCE|skewTolerance|skewMs|FUTURE_DATED_MS)\b/],
];

export function findHits(source) {
  // Whether the file imports the helper is REPORTED and floored, never an exemption.
  const importsHelper = IMPORTS_HELPER.test(source);
  const raw = source.split("\n");
  const clean = sanitize(source).split("\n");
  const hits = [];
  const markers = [];
  const folded = [];
  clean.forEach((line, i) => {
    const rule = RULES.find(([, re]) => re.test(line));
    if (!rule) return;
    const own = MARKER.exec(raw[i] ?? "");
    const above = MARKER.exec(raw[i - 1] ?? "");
    const m = own ?? above;
    if (m) {
      if (hasReason(m[1])) {
        markers.push({ line: i + 1, rule: rule[0], reason: m[1].trim(), text: line.trim() });
      } else {
        hits.push({ line: i + 1, rule: rule[0], text: line.trim(), why: "empty-reason" });
      }
      return;
    }
    // The line itself uses the shared body. This is the ONLY thing an import buys.
    if (FOLDED_CALL.test(line)) {
      folded.push({ line: i + 1, rule: rule[0], text: line.trim() });
      return;
    }
    hits.push({ line: i + 1, rule: rule[0], text: line.trim(), why: importsHelper ? "importer-line" : "bare" });
  });
  return { importsHelper, hits, markers, folded };
}

// ── self-test: the gate must be able to fail, and to exempt ──────────────────
{
  const bare = 'const age = nowMs - Date.parse(s);\nif (age < 0) return "unknown";';
  const marked =
    "// freshness: local-by-design — base package, cannot depend on @workspace/integrations\n" +
    'const age = nowMs - Date.parse(s);';
  const inline = 'const age = nowMs - Date.parse(s); // freshness: local-by-design — same reason';
  const commented = '// the old shape was: const age = nowMs - Date.parse(s);';
  const folded = 'import { ageMs } from "../../utils/freshness";\nconst age = ageMs(s, nowMs, 0);';
  // F1, the hole: a bare comparison planted in a file that IMPORTS the helper. This
  // is the shape that passed until 2026-09-02 — the planted line below is the one
  // actually planted in pacs-access/evaluate.ts to prove it.
  const importerBare =
    'import { ageMs } from "../../utils/freshness";\n' +
    'const age = nowMs - t;\nif (age < 0) return "fresh";';
  const importerMarked =
    'import { ageMs } from "../../utils/freshness";\n' +
    "// freshness: local-by-design — containment in a declared window, not a sighting age\n" +
    "const age = nowMs - t;";
  // F2, the empty reason: `— ` and `—   ` both satisfied `(.+)$`.
  const emptyReason = 'const age = nowMs - t; // freshness: local-by-design —';
  const blankReason = 'const age = nowMs - t; // freshness: local-by-design —      ';
  const shortReason = 'const age = nowMs - t; // freshness: local-by-design — ok';
  const weakReason = 'const age = nowMs - t; // freshness: local-by-design — because it is';
  // F3, the widened token: a literal `Date.now()` on either side.
  const dateNowAge = 'const ageMs2 = Date.now() - input.observedAt;';
  const dateNowRelational = 'if (this.accessToken && Date.now() < this.tokenExpiry) {';
  // ...and the literal-subtrahend exclusion that keeps it honest.
  const literalPast = 'enrolledAt: new Date(Date.now() - 86400000).toISOString(),';
  const cases = [
    ["a bare hand-rolled comparison FAILS", findHits(bare).hits.length > 0],
    ["a marker on the line above exempts it", findHits(marked).hits.length === 0],
    ["...and the marker is REPORTED, not swallowed", findHits(marked).markers.length === 1],
    ["a marker on the line itself exempts it", findHits(inline).hits.length === 0 && findHits(inline).markers.length === 1],
    ["a comparison inside a COMMENT does not fire", findHits(commented).hits.length === 0],
    // Was: "a file that imports the helper is exempt" — the F1 defect, restated as
    // the two things that sentence was meant to mean.
    ["a file that imports the helper is RECOGNISED as an importer", findHits(folded).importsHelper === true],
    ["...and a FOLDED line in it passes, and is reported as folded", findHits(folded).hits.length === 0],
    ["...but a BARE comparison in that same file FAILS (F1)", findHits(importerBare).hits.length > 0],
    ["...and the importer hit says WHY it is a hit", findHits(importerBare).hits[0]?.why === "importer-line"],
    ["...while a MARKED line in an importer file still passes", findHits(importerMarked).hits.length === 0 && findHits(importerMarked).markers.length === 1],
    ["the marker reason is captured, not just its presence", findHits(marked).markers[0]?.reason.includes("base package")],
    ["an EMPTY marker reason FAILS (F2)", findHits(emptyReason).hits.length === 1 && findHits(emptyReason).markers.length === 0],
    ["a WHITESPACE-ONLY marker reason FAILS (F2)", findHits(blankReason).hits.length === 1 && findHits(blankReason).hits[0]?.why === "empty-reason"],
    ["a too-short reason FAILS", findHits(shortReason).hits.length === 1],
    ["a WEAK but present reason PASSES — quality is out of scope", findHits(weakReason).hits.length === 0 && findHits(weakReason).markers.length === 1],
    ["a literal `Date.now()` age subtraction is MATCHED (F3)", findHits(dateNowAge).hits.length === 1],
    ["a literal `Date.now()` relational check is MATCHED (F3)", findHits(dateNowRelational).hits.length === 1],
    ["subtracting a NUMERIC LITERAL from now is not an age", findHits(literalPast).hits.length === 0],
  ];
  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — these cases did not behave as required:\n" +
        failed.map(([n]) => `    · ${n}`).join("\n") +
        "\n  The detector no longer matches the defect it was written for; a gate that\n" +
        "  cannot flag a planted violation is green about nothing.",
    );
    process.exit(1);
  }
  if (process.argv.includes("--self-test")) {
    console.log(`freshness-divergence self-test: ${cases.length}/${cases.length} cases green (planted violation flags, marker exempts and reports)`);
    process.exit(0);
  }
}

// ── the scan ─────────────────────────────────────────────────────────────────
const files = [];
const walk = (d) => {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(d, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (SRC.test(e.name)) files.push(p);
  }
};
for (const pkg of readdirSync(join(repo, "lib"), { withFileTypes: true })) {
  if (pkg.isDirectory()) walk(join("lib", pkg.name, "src"));
}

console.log("Freshness divergence — one rule, one body, every exemption said out loud\n");

let importers = 0;
let problems = 0;
const allMarkers = [];
const allFolded = [];
for (const f of files.sort()) {
  if (f.split("\\").join("/") === CANONICAL) continue;
  let src;
  try {
    src = readFileSync(join(repo, f), "utf8");
  } catch {
    continue;
  }
  const { importsHelper, hits, markers, folded } = findHits(src);
  if (importsHelper) importers += 1;
  for (const m of markers) allMarkers.push({ file: f, ...m });
  for (const g of folded) allFolded.push({ file: f, ...g });
  for (const h of hits) {
    const why =
      h.why === "empty-reason"
        ? "      The marker is present but its REASON is empty or under 10 characters.\n" +
          "      An exemption with no reason is the silent list this gate refuses.\n"
        : h.why === "importer-line"
          ? "      This file imports utils/freshness, and that exempts the LINES THAT CALL IT,\n" +
            "      not the file. This line rolls its own comparison.\n"
          : "";
    console.error(
      `  ✗ ${f}:${h.line} (${h.rule})\n` +
        `      ${h.text}\n` +
        why +
        "      A hand-rolled future/age comparison. Import ageMs/deriveFreshness from\n" +
        "      utils/freshness, or mark the line:  // freshness: local-by-design — <reason>",
    );
    problems += 1;
  }
}

// REPORTED, never gated: what the exemptions are and why. A list nobody prints is
// a list nobody reads, and an exemption nobody reads is a fossil.
console.log(`REPORTED — ${allMarkers.length} local-by-design exemption(s), each with its stated reason:`);
if (allMarkers.length === 0) console.log("    (none)");
for (const m of allMarkers) console.log(`    · ${m.file}:${m.line} (${m.rule})\n        ${m.reason}`);

console.log(`\nREPORTED — ${allFolded.length} line(s) exempted by calling the shared body inline:`);
if (allFolded.length === 0) console.log("    (none)");
for (const g of allFolded) console.log(`    · ${g.file}:${g.line} (${g.rule})  ${g.text}`);

// Bumped DELIBERATELY from 15 to 400 on 2026-09-02. Fifteen was a floor no realistic
// breakage could trip: it would have held green with every package but one dropped
// out of the walk. 400 against a measured 466 trips if a package the size of
// lib/integrations, lib/webauthn or lib/integration-bridge stops being reached.
const FILE_FLOOR = 400;
const IMPORTER_FLOOR = 5;
console.log(
  `\nfreshness-divergence: ${files.length} source files scanned, ${importers} helper importer(s), ` +
    `${allMarkers.length} exemption(s), ${allFolded.length} folded line(s), ${problems} violation(s); self-test green`,
);
if (files.length < FILE_FLOOR) {
  console.error(`✗ Only ${files.length} source files scanned (floor ${FILE_FLOOR}) — the walk is not reaching lib/**/src.`);
  process.exit(1);
}
if (importers < IMPORTER_FLOOR) {
  console.error(
    `✗ Only ${importers} file(s) import utils/freshness (floor ${IMPORTER_FLOOR}) — the fold has been unwound, ` +
      "or the import matcher no longer recognises it. Either way this scan is green about nothing.",
  );
  process.exit(1);
}
if (problems > 0) {
  console.error("\nFreshness divergence gate FAILED — a copy that drifts is how a fail-closed rule becomes fail-open in one family.");
  process.exit(1);
}
console.log("Freshness divergence gate passed — every future/age comparison folds onto the shared body or states why it does not.");
