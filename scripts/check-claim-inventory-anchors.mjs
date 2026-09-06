#!/usr/bin/env node
// Claim-inventory anchors — a quoted claim must still be a quotation.
//
//   node scripts/check-claim-inventory-anchors.mjs              check (writes nothing)
//   node scripts/check-claim-inventory-anchors.mjs --write      re-anchor drifted lines + regenerate the ratchet (the ONLY writer)
//   node scripts/check-claim-inventory-anchors.mjs --self-test  prove the check can fail
//
// WHY THIS EXISTS. docs/agent/CLAIM_INVENTORY.json holds 1,000-odd rows, each a
// buyer-facing sentence quoted from a surface at a file:line, classified against
// the launch profile. Its own preamble says a row stays as evidence after the
// copy changes — marked RESOLVED — and that the source↔inventory synchronisation
// gate "is backlog row 6's launch-claims gate … until it exists, regeneration is
// manual and marked". Nothing ever checked the quotations. Measured on 2026-09-06:
// 57 of the 58 README rows quoted a README rebuilt on 2026-09-01 (#370) and not
// one carried a resolution; across the whole inventory 391 quoted claims were
// absent from their file and 76 sat more than ten lines from the cited line. A
// markdown-link repair had also rewritten two quotations IN the JSON on
// 2026-09-06, and only a reader noticed. An inventory whose quotations are not
// checked is a hand-maintained record that says it is evidence.
//
// WHAT IS GATED (unambiguous only):
//   moved   — the quotation is in the file but not within ±10 lines of the cited
//             line. FATAL: `--write` re-anchors the `line` field to where the
//             quotation actually is (the nearest occurrence to the old citation),
//             and nothing else about the row.
//   absent  — the quotation is nowhere in the file and the row carries no
//             `resolution`. RATCHETED: the count may not RISE. A quotation that
//             vanishes must take a resolution with it (the row is the record of
//             the correction), and a lower count is blessed by `--write`.
//   remove-actioned rows whose quotation is still present — RATCHETED the same
//             way: copy the inventory said must go, still on the surface, may
//             not grow.
//   evidence citations (added 2026-09-06, the same day, after the README
//   re-extraction found WHAT_SIGNALGRID_DOES_TODAY.md citations that no longer
//   held the text attributed to them) — every `path:line` in an unresolved
//   row's `evidence` whose path starts at a repository root must exist and lie
//   within the file (FATAL: a citation that points nowhere reads as evidence and
//   is not); when a quoted fragment follows the citation within forty
//   characters, the fragment must occur within ±10 lines of it — a fragment
//   found elsewhere is line drift (FATAL until `--write` re-anchors the citation
//   inside the evidence text), a fragment found nowhere is RATCHETED like an
//   absent claim. Measured before the rule existed: 1,066 citations in
//   unresolved rows, 217 carrying a fragment, 53 drifted, 67 absent.
//   A fragment that is the row's OWN claim wording — `scripts/x.mjs:246-259).
//   Future-tense framing ("being designed")` quotes the surface, not the cited
//   file — is a CLAIM ECHO and is never held against the citation (nine of the
//   eleven "absent" fragments left on 2026-09-06 were this shape).
//   launch-profile membership (added 2026-09-06, Batch S) — a citation into
//   scripts/launch-profile.mjs almost always asserts an ARM ("graph is launch",
//   "custody-beacon … deferred"), and the line number is the weakest possible
//   proof of it: 28 such citations in the remove-actioned rows landed on
//   unrelated lines while every membership claim they made was still true, and
//   a line number goes on being "right" after the profile moves the id to
//   another arm. So the arm is tested by IMPORTING the profile: each profile id
//   named in the citation's clause is paired with the status word that GOVERNS
//   it — the nearest one after it with only link material between ("X and Y
//   are deferred"), else the nearest one before it the same way ("defers X, Y",
//   "three launch families — X, Y") — and looked up in SURFACES; never a line
//   number. Nearest-word pairing was tried first and produced 29 false
//   mismatches on the live inventory ("no alert-routing surface at launch:
//   /v1/webhooks … are deferred" paired the path with "launch"); the citations
//   are masked too, because the word "launch" inside "launch-profile.mjs" is a
//   path, not an arm (four more false mismatches in the first survey); and a
//   bare dictionary word that is also an id ("network", "identity", "graph")
//   counts only when the evidence marks it as one — backticked, quoted, or the
//   subject of is/are. An id with no governing status word is REPORTED as
//   unasserted, never judged. Mismatches are RATCHETED (first measurement is
//   the ceiling); the import itself is floored — fewer than 40 ids or fewer than
//   four arms means the profile's shape changed under the check, FATAL.
//   The ratchet file is a regenerate-and-diff artifact (same pattern as
//   role-coverage-ratchet.json): check mode recomputes it and fails on any byte
//   difference, naming the direction; only `--write` writes it.
//
// WHAT IS NOT GATED, said out loud: rows whose `claim` carries no quoted segment
// of twelve or more characters (paraphrases, figure descriptions) are REPORTED
// as unquoted and never counted; a quotation is matched after collapsing
// whitespace and stripping `**`, so a re-flow does not count as a change but a
// one-word rewrite does — that is the point. Whether the classification is still
// right is check-launch-claims' question, not this file's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SURFACES, STATUSES } from "./launch-profile.mjs";

const JSON_PATH = "docs/agent/CLAIM_INVENTORY.json";
const RATCHET = "docs/agent/claim-inventory-anchors-ratchet.json";
const WINDOW = 10;
const MIN_QUOTE = 12;

const WRITE = process.argv.includes("--write");
const SELF_TEST = process.argv.includes("--self-test");

const RATCHET_NOTE =
  "Claim-inventory anchor ratchet: quoted claims absent from their surface without a resolution, " +
  "remove-actioned claims still present, launch-profile arms asserted against the imported profile that it contradicts, and evidence citations whose quoted fragment is no longer at " +
  "the cited file. DERIVED by scripts/check-claim-inventory-anchors.mjs; never hand-edit. No figure " +
  "may rise; a fall is recorded with `--write` and committed.";

// Markup that is not a change of wording: bold markers, escaped quotes, the
// HTML entities a .tsx/.html surface must use for `&`/`<`/`>`/quotes, and curly
// quotes a copy-edit may have straightened. 22 of the first 334 "absent" rows
// differed from their surface by `&amp;` alone (measured 2026-09-06).
const ENTITIES = [
  [/&amp;/g, "&"], [/&lt;/g, "<"], [/&gt;/g, ">"], [/&quot;/g, '"'], [/&#39;|&apos;/g, "'"], [/&nbsp;/g, " "],
  [/[‘’]/g, "'"], [/[“”]/g, '"'],
];
// Source-file seams are markup too: a JavaScript string continued with `" +`
// on the next line, and a `//` comment prefix at the start of a continued
// line, both split one sentence the reader sees whole. Each substitution keeps
// its newline, so the offset→line map stays true.
const SEAMS = [
  [/"\s*\+\s*(\r?\n)\s*"/g, "$1"],
  [/(\r?\n)[ \t]*\/\/ ?/g, "$1"],
];
const demarkup = (s) =>
  [...ENTITIES, ...SEAMS].reduce((t, [re, to]) => t.replace(re, to), s.replace(/\*\*/g, "").replace(/\\"/g, '"'));
const norm = (s) => demarkup(s).replace(/\s+/g, " ").trim();

/** The longest quoted, ellipsis-free segment of a claim (≥ MIN_QUOTE chars), or null. */
export function quotedSegment(claim) {
  const m = /"(.+)"/s.exec(String(claim ?? ""));
  if (!m) return null;
  // A claim may quote a second fragment after a gloss — take the first quotation
  // (up to its closing quote followed by a separator) when one exists, else the
  // greedy span.
  const first = /"(.+?)"(?=\s|$|—|-|,|\.|;|\))/s.exec(claim);
  const inner = (first ?? m)[1];
  const segs = inner
    .split(/…|\.\.\./)
    .map(norm)
    .filter((s) => s.length >= MIN_QUOTE);
  if (segs.length === 0) return null;
  return segs.reduce((a, b) => (b.length > a.length ? b : a));
}

/** "3" | "9-11" | "~53" | ":45, 116" | "13, 33, 53" → [[a,b], …]; unparseable parts are dropped. */
export function lineRanges(spec) {
  const out = [];
  for (const part of String(spec ?? "").split(/,\s*/)) {
    const r = /^\s*:?~?(\d+)(?:\s*[-–]\s*~?(\d+))?\s*$/.exec(part);
    if (!r) continue;
    const a = Number(r[1]);
    const b = r[2] ? Number(r[2]) : a;
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

/** Whitespace-collapsed text with an offset→line map, so a quotation that spans lines still anchors. */
export function indexFile(raw) {
  // Entity decoding shortens the text, so the offset→line map is built from the
  // decoded string: a replaced entity never contains a newline, so line numbers
  // survive the substitution.
  const src = demarkup(raw);
  let text = "";
  const lineAt = [];
  let line = 1;
  let prevSpace = false;
  for (const ch of src) {
    if (ch === "\n") line += 1;
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        text += " ";
        lineAt.push(line);
      }
      prevSpace = true;
    } else {
      text += ch;
      lineAt.push(line);
      prevSpace = false;
    }
  }
  return { text, lineAt, lines: raw.split("\n").length };
}

/** Every [startLine, endLine] at which `seg` occurs in an indexed file. */
export function occurrences(index, seg) {
  const hits = [];
  let p = 0;
  while ((p = index.text.indexOf(seg, p)) !== -1) {
    hits.push([index.lineAt[p], index.lineAt[Math.min(p + seg.length - 1, index.lineAt.length - 1)]]);
    p += 1;
  }
  return hits;
}

/**
 * Pure: one row against its indexed file.
 *   { status: "resolved" | "unquoted" | "nofile" | "anchored" | "moved" | "absent", hits, seg, nearest }
 */
export function anchorRow(row, index) {
  if (row.resolution) return { status: "resolved", hits: [] };
  const seg = quotedSegment(row.claim);
  if (!seg) return { status: "unquoted", hits: [] };
  if (!index) return { status: "nofile", hits: [], seg };
  const hits = occurrences(index, seg);
  if (hits.length === 0) return { status: "absent", hits, seg };
  const ranges = lineRanges(row.line);
  const near = hits.some(([s, e]) => ranges.some(([a, b]) => e >= a - WINDOW && s <= b + WINDOW));
  if (near) return { status: "anchored", hits, seg };
  const ref = ranges.length > 0 ? ranges[0][0] : 0;
  const nearest = [...hits].sort((x, y) => Math.abs(x[0] - ref) - Math.abs(y[0] - ref))[0];
  return { status: "moved", hits, seg, nearest };
}

/** Pure over a whole inventory; `readIndex(file)` returns an index or null. */
export function anchorAll(rows, readIndex) {
  const cache = new Map();
  const idx = (f) => {
    if (!cache.has(f)) cache.set(f, readIndex(f));
    return cache.get(f);
  };
  const results = rows.map((row, i) => ({ i, row, ...anchorRow(row, idx(row.file)) }));
  const by = (s) => results.filter((r) => r.status === s);
  const removeStillPresent = results.filter(
    (r) => (r.status === "anchored" || r.status === "moved") && (r.row.action ?? "keep") === "remove",
  );
  // A `resolution` drops a row out of every count above, so it is the one edit
  // that can silently retire a live defect. A remove-actioned row may carry a
  // resolution only once its copy is gone: if the quotation still renders, the
  // resolution is a false statement and this is FATAL, not ratcheted.
  const resolvedRemoveStillPresent = rows
    .map((row, i) => ({ i, row }))
    .filter(({ row }) => row.resolution && (row.action ?? "keep") === "remove")
    .map(({ i, row }) => ({ i, row, ...anchorRow({ ...row, resolution: undefined }, idx(row.file)) }))
    .filter((r) => r.status === "anchored" || r.status === "moved");
  const absentByFile = {};
  for (const r of by("absent")) absentByFile[r.row.file] = (absentByFile[r.row.file] ?? 0) + 1;
  return {
    results,
    anchored: by("anchored"),
    moved: by("moved"),
    absent: by("absent"),
    unquoted: by("unquoted"),
    resolved: by("resolved"),
    nofile: by("nofile"),
    removeStillPresent,
    resolvedRemoveStillPresent,
    absentByFile,
  };
}

// ── evidence citations ───────────────────────────────────────────────────────
// A path counts as a citation only when it starts at a repository root (or is
// one of the root files): the evidence prose also carries shorthand such as
// "src/data/reviewData.ts" after a full path earlier in the same sentence, and a
// shorthand is not a claim about a location.
const CITE_RE =
  /(?<![\w@/.-])((?:artifacts|docs|lib|scripts|native|fixtures|fleet|tests|tools|site|config|docker|firmware|\.github|\.githooks|\.claude)\/[\w./-]+\.(?:tsx|ts|mjs|json|js|md|ya?ml|swift|html|sh|toml|kt|rs)|README\.md|CLAUDE\.md|AGENTS\.md|SECURITY\.md|pnpm-workspace\.yaml|package\.json):(\d+)(?:\s*[-–]\s*(\d+))?/g;
// Only a DOUBLE-QUOTED fragment (straight or curly) counts as a quotation of the
// cited file. A backtick span is an identifier or a command — `pnpm run proof:x`
// after a citation says the proof exists, not that the cited line contains those
// words — and treating it as a quotation produced 16 false absences on the first
// re-extraction (2026-09-06).
const FRAG_RE = /^[^"“`]{0,40}(?:"([^"]{12,}?)"|“([^”]{12,}?)”)/;
const FRAG_WINDOW = 10;

/** Every root-anchored `path:line[-line]` in an evidence string, with the quoted fragment that follows it (if any). */
export function citationsIn(evidence) {
  const out = [];
  const text = String(evidence ?? "");
  const all = [...text.matchAll(CITE_RE)];
  all.forEach((m, k) => {
    // A fragment belongs to the NEAREST citation before it: the window stops at
    // the next citation, so `a.mjs:683-753); docs/B.md:149 ("four gaps")` does
    // not hand B's fragment to A (the first re-extraction produced exactly that).
    const start = m.index + m[0].length;
    const stop = Math.min(start + 200, all[k + 1]?.index ?? text.length);
    const after = text.slice(start, stop);
    const fm = FRAG_RE.exec(after);
    const raw = fm ? (fm[1] ?? fm[2]) : null; // group 2 is the curly-quoted form
    const seg = raw
      ? norm(raw).split(/…|\.\.\./).map((s) => s.trim()).filter((s) => s.length >= MIN_QUOTE).sort((x, y) => y.length - x.length)[0] ?? null
      : null;
    out.push({ index: m.index, length: m[0].length, file: m[1], lo: Number(m[2]), hi: Number(m[3] ?? m[2]), seg });
  });
  return out;
}

/**
 * Pure: one unresolved row's evidence citations against the tree.
 * Each result: { status: "missing" | "pastEof" | "unfragmented" | "near" | "moved" | "absent", citation, nearest }
 */
export function checkCitations(row, readIndex) {
  if (row.resolution) return [];
  return citationsIn(row.evidence).map((c) => {
    const index = readIndex(c.file);
    if (!index) return { status: "missing", citation: c };
    if (c.hi > index.lines) return { status: "pastEof", citation: c };
    if (!c.seg) return { status: "unfragmented", citation: c };
    // The row's own claim wording quoted after a citation is the surface
    // speaking, not the cited file — existence-check the citation and stop.
    if (norm(String(row.claim ?? "")).includes(c.seg)) return { status: "claimEcho", citation: c };
    const hits = occurrences(index, c.seg);
    if (hits.length === 0) return { status: "absent", citation: c };
    if (hits.some(([s, e]) => e >= c.lo - FRAG_WINDOW && s <= c.hi + FRAG_WINDOW)) return { status: "near", citation: c };
    const nearest = [...hits].sort((x, y) => Math.abs(x[0] - c.lo) - Math.abs(y[0] - c.lo))[0];
    return { status: "moved", citation: c, nearest };
  });
}

export function evidenceAll(rows, readIndex) {
  const cache = new Map();
  const idx = (f) => {
    if (!cache.has(f)) cache.set(f, readIndex(f));
    return cache.get(f);
  };
  const results = [];
  rows.forEach((row, i) => {
    for (const r of checkCitations(row, idx)) results.push({ i, row, ...r });
  });
  const by = (s) => results.filter((r) => r.status === s);
  return { results, missing: by("missing"), pastEof: by("pastEof"), unfragmented: by("unfragmented"), claimEcho: by("claimEcho"), near: by("near"), moved: by("moved"), absent: by("absent") };
}

// ── launch-profile membership ────────────────────────────────────────────────
const PROFILE_CITE_RE = /scripts\/launch-profile\.mjs(?::\d+(?:-\d+)?)?/g;
const STATUS_RE = /\b(launch|deferred|defers|demo[_ -]only|internal)\b/gi;
const armOf = (word) => (word.toLowerCase() === "defers" ? "deferred" : word.toLowerCase().replace(/[ -]/, "_"));
// Words that may stand between an id and the status word that governs it
// ("X and Y are both deferred", "three launch families — X, Y"); anything else
// between them means the status word belongs to some other subject.
const LINK_WORDS = new Set([
  "and", "or", "both", "all", "are", "is", "was", "were", "remain", "remains", "stay", "stays", "classified", "as", "a", "an", "the",
  "each", "only", "one", "still", "now", "also", "its", "their", "path", "paths", "family", "families", "kind", "kinds", "surface",
  "surfaces", "connector", "connectors", "route", "routes", "published", "signal", "signals", "row", "rows", "id", "ids", "entry",
  "entries", "two", "three", "four", "five", "read-only",
]);
// Phrases in which "launch" is a name, not an arm.
const PHRASE_MASK_RE = /launch[- ](profile|claims?|surface|decision paths?)/gi;
const PROFILE_ID_FLOOR = 40;

/** id → Set(arm) from the profile's SURFACES (entries are `{ id }` objects or bare id strings). */
export function profileArms(surfaces, statuses) {
  const arms = new Map();
  for (const s of surfaces) {
    for (const st of statuses) {
      for (const e of s[st] ?? []) {
        const id = typeof e === "string" ? e : e?.id;
        if (!id) continue;
        if (!arms.has(id)) arms.set(id, new Set());
        arms.get(id).add(st);
      }
    }
  }
  return arms;
}

const maskSpans = (text, re) => text.replace(re, (m) => " ".repeat(m.length));

/** The clause holding offset `at`: bounded by `;`, a newline, or a sentence break (period, space, capital). */
export function clauseAround(text, at) {
  let lo = 0;
  let hi = text.length;
  for (const m of text.matchAll(/;|\n|\.\s+(?=[A-Z])/g)) {
    const s = m.index;
    const e = s + m[0].length;
    if (e <= at) lo = e;
    else if (s >= at) {
      hi = s;
      break;
    }
  }
  return { lo, hi, clause: text.slice(lo, hi) };
}

/**
 * Pure: every launch-profile citation in one evidence string → the arm assertions in its clause.
 *   { status: "ok" | "mismatch" | "unasserted", citation, id?, asserted?, actual?, clause }
 */
export function membershipAssertions(evidence, arms) {
  const text = String(evidence ?? "");
  const out = [];
  const ids = [...arms.keys()].sort((a, b) => b.length - a.length);
  const idSet = new Set(ids);
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A bare dictionary word that happens to be a profile id ("network", "identity",
  // "graph") counts only when the evidence marks it as an id — backticked, quoted,
  // or sitting in "X is/are …" / "the X connector|family|kind" — "zero network" is English.
  const plainWord = (id) => !/[-_/:.]/.test(id);
  const marked = (clause, at, id) => {
    const before = clause.slice(Math.max(0, at - 24), at);
    const after = clause.slice(at + id.length, at + id.length + 24);
    if (/[`"'“‘]$/.test(before) && /^[`"'”’]/.test(after)) return true;
    if (/^\s+(is|are|remains?|stays?|connector|family|kind)\b/.test(after)) return true;
    return /\b(family|families|kind|kinds|connector|connectors|id|ids|only)\s+$/.test(before);
  };
  // Is `between` (the text from an id to a status word, or back) made only of
  // separators, link words, numbers, citations and other ids? A sentence break or
  // any other word means the status governs some other subject.
  const linked = (between) => {
    let t = maskSpans(between, PROFILE_CITE_RE).replace(/:\d+(?:-\d+)?/g, " ");
    for (let k = 0; k < 4; k += 1) t = t.replace(/\([^()]*\)/g, " ");
    if (/\.\s/.test(t) || /[()]/.test(t)) return false;
    for (const tok of t.split(/[\s,;:`"'“”‘’*—–\[\]]+/)) {
      if (tok === "" || tok === "-" || tok === "/" || /^\d+$/.test(tok)) continue;
      if (LINK_WORDS.has(tok.toLowerCase()) || idSet.has(tok)) continue;
      return false;
    }
    return true;
  };
  for (const m of text.matchAll(PROFILE_CITE_RE)) {
    const { clause } = clauseAround(text, m.index);
    const masked = maskSpans(maskSpans(clause, PROFILE_CITE_RE), PHRASE_MASK_RE);
    const statuses = [...masked.matchAll(STATUS_RE)].map((s) => ({ at: s.index, end: s.index + s[0].length, arm: armOf(s[1]) }));
    const found = [];
    for (const id of ids) {
      for (const im of masked.matchAll(new RegExp(`(?<![\\w/-])${escape(id)}(?![\\w/-])`, "g"))) {
        if (plainWord(id) && !marked(clause, im.index, id)) continue;
        found.push({ id, at: im.index, end: im.index + id.length });
      }
    }
    let asserted = 0;
    for (const f of found) {
      // The status that governs an id: the nearest one AFTER it with only link
      // material between ("X and Y are deferred"), else the nearest one BEFORE
      // it the same way ("defers X, Y" / "three launch families — X, Y").
      const after = statuses.filter((s) => s.at >= f.end).sort((x, y) => x.at - y.at).find((s) => linked(masked.slice(f.end, s.at)));
      const before = statuses.filter((s) => s.end <= f.at).sort((x, y) => y.at - x.at).find((s) => linked(masked.slice(s.end, f.at)));
      const gov = after ?? before;
      if (!gov) continue;
      asserted += 1;
      const actual = arms.get(f.id);
      out.push({
        status: actual.has(gov.arm) ? "ok" : "mismatch",
        citation: m[0],
        id: f.id,
        asserted: gov.arm,
        actual: [...actual],
        clause: clause.trim(),
      });
    }
    if (asserted === 0) out.push({ status: "unasserted", citation: m[0], clause: clause.trim() });
  }
  return out;
}

export function membershipAll(rows, arms) {
  const results = [];
  rows.forEach((row, i) => {
    if (row.resolution) return;
    // Two citations in one clause yield the same assertions twice; count each (row, id, arm) once.
    const seen = new Set();
    for (const r of membershipAssertions(row.evidence, arms)) {
      const key = `${r.status}|${r.id ?? ""}|${r.asserted ?? ""}|${r.clause}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ i, row, ...r });
    }
  });
  const by = (s) => results.filter((r) => r.status === s);
  return { results, ok: by("ok"), mismatch: by("mismatch"), unasserted: by("unasserted") };
}

/** `--write`: re-anchor each moved citation's line inside the evidence text, last match first so earlier indices stay valid. */
export function rewriteCitations(rows, ev) {
  const byRow = new Map();
  for (const r of ev.moved) {
    if (!byRow.has(r.i)) byRow.set(r.i, []);
    byRow.get(r.i).push(r);
  }
  let changed = 0;
  for (const [i, list] of byRow) {
    let text = String(rows[i].evidence);
    for (const r of list.sort((a, b) => b.citation.index - a.citation.index)) {
      const [s, e] = r.nearest;
      const next = `${r.citation.file}:${s === e ? s : `${s}-${e}`}`;
      text = text.slice(0, r.citation.index) + next + text.slice(r.citation.index + r.citation.length);
      changed += 1;
    }
    rows[i].evidence = text;
  }
  return changed;
}

export function ratchetObject(a, ev, mem) {
  const sortedByFile = Object.fromEntries(Object.entries(a.absentByFile).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
  return {
    note: RATCHET_NOTE,
    absent: a.absent.length,
    removeActionedStillPresent: a.removeStillPresent.length,
    evidenceFragmentsAbsent: ev ? ev.absent.length : 0,
    membershipMismatches: mem ? mem.mismatch.length : 0,
    absentByFile: sortedByFile,
  };
}

export function serializeRatchet(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Pure verdict for check mode.
 *   untracked → the ratchet is not committed, so it controls nothing.
 *   rose      → absent or remove-still-present is above the committed figure.
 *   stale     → bytes differ but nothing rose (a fall not yet blessed by --write, or a hand-edit).
 */
export function ratchetVerdict({ committedRaw, isTracked, expectedRaw, committed, now }) {
  if (!isTracked) return { ok: false, kind: "untracked" };
  if (committedRaw !== expectedRaw) {
    const rose = [];
    if (committed && now.absent > committed.absent) rose.push(`absent ${committed.absent} → ${now.absent}`);
    if (committed && now.removeActionedStillPresent > committed.removeActionedStillPresent) {
      rose.push(`remove-actioned still present ${committed.removeActionedStillPresent} → ${now.removeActionedStillPresent}`);
    }
    if (committed && now.evidenceFragmentsAbsent > (committed.evidenceFragmentsAbsent ?? 0)) {
      rose.push(`evidence fragments absent ${committed.evidenceFragmentsAbsent ?? 0} → ${now.evidenceFragmentsAbsent}`);
    }
    if (committed && (now.membershipMismatches ?? 0) > (committed.membershipMismatches ?? 0)) {
      rose.push(`launch-profile membership mismatches ${committed.membershipMismatches ?? 0} → ${now.membershipMismatches}`);
    }
    return { ok: false, kind: rose.length > 0 ? "rose" : "stale", rose };
  }
  return { ok: true, kind: "ok", rose: [] };
}

/** `--write`: re-anchor every moved row's `line` to the nearest occurrence; returns the count changed. */
export function reanchor(rows, anchors) {
  let changed = 0;
  for (const r of anchors.moved) {
    const [s, e] = r.nearest;
    const next = s === e ? String(s) : `${s}-${e}`;
    if (rows[r.i].line !== next) {
      rows[r.i].line = next;
      changed += 1;
    }
  }
  return changed;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  const checks = [];
  const file = "one\ntwo **quoted sentence here** three\nfour\n" + "pad\n".repeat(30) + "the far away sentence sits here\n";
  const index = indexFile(file);
  const rows = [
    { file: "f", line: "2", claim: '"quoted sentence here"', action: "keep" },
    { file: "f", line: "2", claim: '"the far away sentence sits here" — gloss', action: "remove" },
    { file: "f", line: "2", claim: '"this sentence was deleted from the file"', action: "rewrite" },
    { file: "f", line: "2", claim: '"this sentence was deleted from the file"', action: "rewrite", resolution: "RESOLVED" },
    { file: "f", line: "2", claim: "a paraphrase with no quotation", action: "keep" },
    { file: "f", line: "~1-3", claim: '"quoted sentence\n  here" (the quote spans a re-flow)', action: "keep" },
  ];
  const a = anchorAll(rows, () => index);
  checks.push(["a quotation within ±10 lines is anchored (bold stripped)", a.anchored.some((r) => r.i === 0)]);
  // Lines: 1 one, 2 two, 3 four, 4-33 pad, 34 the far-away sentence.
  checks.push(["a quotation 30 lines away is MOVED, with its nearest occurrence", a.moved.some((r) => r.i === 1 && r.nearest[0] === 34)]);
  checks.push(["a quotation nowhere in the file is ABSENT", a.absent.some((r) => r.i === 2)]);
  checks.push(["a resolved row is never counted absent", a.resolved.some((r) => r.i === 3) && !a.absent.some((r) => r.i === 3)]);
  checks.push(["a claim with no quoted segment is reported unquoted, not judged", a.unquoted.some((r) => r.i === 4)]);
  checks.push(["a re-flowed quotation with a '~' range still anchors", a.anchored.some((r) => r.i === 5)]);
  const ent = anchorAll([{ file: "e", line: "1", claim: '"CIS & DISA STIG as decision signals"', action: "keep" }], () => indexFile("<h3>CIS &amp; DISA STIG as decision signals</h3>\n"));
  checks.push(["an HTML entity on the surface is markup, not a rewrite — the quotation still anchors", ent.anchored.length === 1]);
  checks.push(["a remove-actioned quotation still present is counted", a.removeStillPresent.length === 1 && a.removeStillPresent[0].i === 1]);
  const rr = anchorAll(
    [
      { file: "f", line: "2", claim: '"quoted sentence here"', action: "remove", resolution: "RESOLVED (but the words are still there)" },
      { file: "f", line: "2", claim: '"quoted sentence here"', action: "keep", resolution: "RECLASSIFIED: hedged in context" },
      { file: "f", line: "2", claim: '"this sentence was deleted from the file"', action: "remove", resolution: "RESOLVED: removed" },
    ],
    () => index,
  );
  checks.push([
    "a remove-actioned row resolved while its copy still renders is caught; a reclassified keep row and a truly removed one are not",
    rr.resolvedRemoveStillPresent.length === 1 && rr.resolvedRemoveStillPresent[0].i === 0,
  ]);
  const twoCites = citationsIn('scripts/a.mjs:683-753); docs/B.md:149-154 ("four declared gaps here", checked)');
  checks.push(["a fragment belongs to the nearest citation before it, never to an earlier one", twoCites[0].seg === null && twoCites[1].seg === "four declared gaps here"]);
  checks.push(["absent is tallied per file", a.absentByFile.f === 1]);

  const copy = rows.map((r) => ({ ...r }));
  const changed = reanchor(copy, a);
  checks.push(["--write re-anchors exactly the moved row to where the quotation is", changed === 1 && copy[1].line === "34" && copy[0].line === "2"]);

  const before = ratchetObject(a);
  const raw = serializeRatchet(before);
  checks.push(["an identical ratchet passes (the check can also pass)", ratchetVerdict({ committedRaw: raw, isTracked: true, expectedRaw: raw, committed: before, now: before }).ok]);
  const worse = { ...before, absent: before.absent + 1 };
  const v = ratchetVerdict({ committedRaw: raw, isTracked: true, expectedRaw: serializeRatchet(worse), committed: before, now: worse });
  checks.push(["a RISE in absent is fatal by name", !v.ok && v.kind === "rose" && v.rose[0].startsWith("absent")]);
  const better = { ...before, absent: 0 };
  const v2 = ratchetVerdict({ committedRaw: raw, isTracked: true, expectedRaw: serializeRatchet(better), committed: before, now: better });
  checks.push(["a fall is stale until --write records it", !v2.ok && v2.kind === "stale"]);
  checks.push(["an untracked ratchet controls nothing", ratchetVerdict({ committedRaw: raw, isTracked: false, expectedRaw: raw, committed: before, now: before }).kind === "untracked"]);
  checks.push(["lineRanges reads every citation shape in the inventory", JSON.stringify(lineRanges(":45, 116")) === "[[45,45],[116,116]]" && JSON.stringify(lineRanges("~53")) === "[[53,53]]" && JSON.stringify(lineRanges("9-11")) === "[[9,11]]"]);
  checks.push(["an ellipsis splits a quotation and the longest segment is matched", quotedSegment('"short one … the far away sentence sits here"') === "the far away sentence sits here"]);

  // ── evidence citations ─────────────────────────────────────────────────────
  const files = {
    "docs/X.md": indexFile("alpha\nthe cited sentence lives here\ngamma\n" + "pad\n".repeat(30) + "the drifted sentence moved down here\n"),
  };
  const readIdx = (f) => files[f] ?? null;
  const evRows = [
    { file: "s", line: "1", claim: '"c"', evidence: 'Grounded: docs/X.md:2 ("the cited sentence lives here") and docs/X.md:3.' },
    { file: "s", line: "1", claim: '"c"', evidence: 'docs/X.md:4 — "the drifted sentence moved down here" (moved since)' },
    { file: "s", line: "1", claim: '"c"', evidence: 'docs/X.md:2 ("a sentence the file never carried at all")' },
    { file: "s", line: "1", claim: '"c"', evidence: "see src/data/shorthand.ts:9 and docs/NOPE.md:1 and docs/X.md:999" },
    { file: "s", line: "1", claim: '"c"', evidence: 'docs/X.md:2 ("a sentence the file never carried at all")', resolution: "RESOLVED" },
    { file: "s", line: "1", claim: '"c"', evidence: "docs/X.md:2 (`pnpm run proof:something-that-exists` is the command)" },
  ];
  const ev = evidenceAll(evRows, readIdx);
  checks.push(["a fragment within ±10 lines of its citation is near; a citation without a fragment is only existence-checked", ev.near.some((r) => r.i === 0) && ev.unfragmented.some((r) => r.i === 0)]);
  checks.push(["a fragment found 30 lines away is MOVED, with its nearest occurrence", ev.moved.some((r) => r.i === 1 && r.nearest[0] === 34)]);
  checks.push(["a fragment nowhere in the cited file is ABSENT", ev.absent.some((r) => r.i === 2)]);
  checks.push(["a shorthand path is not a citation; a missing file and a line past EOF are each named", !ev.results.some((r) => r.citation.file.startsWith("src/")) && ev.missing.some((r) => r.i === 3) && ev.pastEof.some((r) => r.i === 3)]);
  checks.push(["a resolved row's evidence is a record, not a citation to hold", !ev.results.some((r) => r.i === 4)]);
  checks.push(["a backtick span after a citation is an identifier, not a quotation — the citation is only existence-checked", ev.unfragmented.some((r) => r.i === 5) && !ev.absent.some((r) => r.i === 5)]);
  const evCopy = evRows.map((r) => ({ ...r }));
  const n = rewriteCitations(evCopy, ev);
  checks.push(["--write re-anchors exactly the moved citation inside the evidence text", n === 1 && evCopy[1].evidence.startsWith("docs/X.md:34 —") && evCopy[0].evidence === evRows[0].evidence]);
  const r0 = ratchetObject(a, ev);
  const r1 = { ...r0, evidenceFragmentsAbsent: r0.evidenceFragmentsAbsent + 1 };
  const v3 = ratchetVerdict({ committedRaw: serializeRatchet(r0), isTracked: true, expectedRaw: serializeRatchet(r1), committed: r0, now: r1 });
  checks.push(["a RISE in absent evidence fragments is fatal by name", !v3.ok && v3.kind === "rose" && v3.rose[0].startsWith("evidence fragments absent")]);
  const echo = evidenceAll(
    [{ file: "s", line: "1", claim: '"the far away sentence sits here" — gloss', evidence: 'docs/X.md:2 ("the far away sentence sits here" is future-tense framing)' }],
    readIdx,
  );
  checks.push(["a fragment that is the row's own claim wording is a CLAIM ECHO, never an absent citation", echo.claimEcho.length === 1 && echo.absent.length === 0]);

  // ── launch-profile membership ──────────────────────────────────────────────
  const fakeArms = profileArms(
    [
      { key: "connector-families", launch: [{ id: "graph" }], deferred: [{ id: "custody-beacon" }, "pacs-access", { id: "network" }, { id: "itsm" }], demo_only: [{ id: "connector-emulator" }], internal: [] },
      { key: "published-api-paths", launch: [], deferred: [{ id: "/v1/webhooks" }, { id: "/v1/webhooks/deliveries" }], demo_only: [], internal: [] },
      { key: "app-surfaces", launch: [], deferred: [], demo_only: [{ id: "signalgrid-desktop" }, { id: "signalgrid-review" }], internal: [] },
    ],
    ["launch", "deferred", "demo_only", "internal"],
  );
  checks.push(["profile arms read `{ id }` entries and bare-string entries alike", fakeArms.get("pacs-access")?.has("deferred") === true && fakeArms.size === 10]);
  const memList = membershipAssertions("No alert-routing surface at launch: /v1/webhooks and /v1/webhooks/deliveries are deferred published paths (scripts/launch-profile.mjs:392-393)", fakeArms);
  checks.push(["a status word governs an id only through link material — 'at launch: X and Y are deferred' asserts deferred, not launch", memList.length === 2 && memList.every((r) => r.status === "ok" && r.asserted === "deferred")]);
  const memAside = membershipAssertions("Device management is grounded (`graph`, scripts/launch-profile.mjs:158), but the identity leg is deferred", fakeArms);
  checks.push(["an id with no governing status word is unasserted — 'graph … but the identity leg is deferred' asserts nothing about graph", memAside.every((r) => r.status === "unasserted")]);
  const memEnglish = membershipAssertions("The zero network browser demo is signalgrid-review, classified demo_only at scripts/launch-profile.mjs:496", fakeArms);
  checks.push(["a bare dictionary word that is also an id ('zero network') is English unless marked; the marked id is judged", memEnglish.length === 1 && memEnglish[0].id === "signalgrid-review" && memEnglish[0].status === "ok"]);
  const memDefers = membershipAssertions(":192-232 of scripts/launch-profile.mjs defers `pacs-access`, `itsm` and the rest", fakeArms);
  checks.push(["'defers X, Y' governs the ids after it", memDefers.length === 2 && memDefers.every((r) => r.status === "ok" && r.asserted === "deferred")]);
  const memOk = membershipAssertions('graph is the one launch connector (scripts/launch-profile.mjs:160, "The one read-only")', fakeArms);
  checks.push(["an id whose asserted arm is the profile's arm is ok", memOk.length === 1 && memOk[0].status === "ok" && memOk[0].id === "graph" && memOk[0].asserted === "launch"]);
  const memForged = membershipAssertions("graph is deferred (scripts/launch-profile.mjs:160)", fakeArms);
  checks.push(["a FORGED arm is a mismatch naming the id, the asserted arm and the profile's arm", memForged.length === 1 && memForged[0].status === "mismatch" && memForged[0].actual.join() === "launch"]);
  const memPath = membershipAssertions('signalgrid-desktop is "fixture-fed" (scripts/launch-profile.mjs:487-493)', fakeArms);
  checks.push(["the word launch inside the cited PATH is not an arm — a clause with no status word is unasserted, not a mismatch", memPath.length === 1 && memPath[0].status === "unasserted"]);
  const memTwo = membershipAssertions("`custody-beacon` and `pacs-access` are both deferred (scripts/launch-profile.mjs:206, :221)", fakeArms);
  checks.push(["two ids sharing one status word are each asserted and each ok", memTwo.length === 2 && memTwo.every((r) => r.status === "ok")]);
  const memClauses = membershipAssertions("connector-emulator is demo_only (scripts/launch-profile.mjs:476); graph is launch (scripts/launch-profile.mjs:160)", fakeArms);
  checks.push(["each citation is judged in its OWN clause — a status word across a semicolon is not borrowed", memClauses.length === 2 && memClauses.every((r) => r.status === "ok")]);
  const memCross = membershipAssertions("connector-emulator is launch (scripts/launch-profile.mjs:476); graph is launch (scripts/launch-profile.mjs:160)", fakeArms);
  checks.push(["…and a wrong arm in one clause is caught without the other clause excusing it", memCross.filter((r) => r.status === "mismatch").length === 1 && memCross.find((r) => r.status === "mismatch").id === "connector-emulator"]);
  const memRows = membershipAll([{ evidence: "graph is deferred (scripts/launch-profile.mjs:160)" }, { evidence: "graph is deferred (scripts/launch-profile.mjs:160)", resolution: "RESOLVED" }], fakeArms);
  checks.push(["a resolved row's evidence is a record — its arms are not asserted", memRows.results.length === 1]);
  const m0 = ratchetObject(a, ev, memRows);
  const m1 = { ...m0, membershipMismatches: m0.membershipMismatches + 1 };
  const v4 = ratchetVerdict({ committedRaw: serializeRatchet(m0), isTracked: true, expectedRaw: serializeRatchet(m1), committed: m0, now: m1 });
  checks.push(["a RISE in membership mismatches is fatal by name", !v4.ok && v4.kind === "rose" && v4.rose[0].startsWith("launch-profile membership mismatches")]);
  const liveArms = profileArms(SURFACES, STATUSES);
  checks.push([`the live profile imports at least ${PROFILE_ID_FLOOR} ids across four arms (the floor the check enforces)`, liveArms.size >= PROFILE_ID_FLOOR && STATUSES.length === 4]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nSELF-TEST FAILED — ${bad} check(s). A gate that cannot flag a planted drift is green about nothing.`);
    return 1;
  }
  console.log(`\nSelf-test green — ${checks.length}/${checks.length}: anchored, moved, absent, resolved, unquoted, re-anchor, evidence citations, claim echo, launch-profile membership and every ratchet direction behave.`);
  return 0;
}

// Importable: the pure functions above are reused by one-off inventory scripts,
// so the live check runs only when this file is the entry point.
const IS_MAIN = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (IS_MAIN) main();

function main() {
if (SELF_TEST) process.exit(selfTest());

// ── live ─────────────────────────────────────────────────────────────────────
const inventory = JSON.parse(readFileSync(JSON_PATH, "utf8"));
const readIndex = (f) => (existsSync(f) ? indexFile(readFileSync(f, "utf8")) : null);
const anchors = anchorAll(inventory.rows, readIndex);
const evidence = evidenceAll(inventory.rows, readIndex);
const arms = profileArms(SURFACES, STATUSES);
const membership = membershipAll(inventory.rows, arms);

console.log("Claim-inventory anchors — a quoted claim must still be a quotation on its surface\n");
console.log(
  `  rows ${inventory.rows.length}: anchored ${anchors.anchored.length}, moved ${anchors.moved.length}, absent ${anchors.absent.length}, ` +
    `resolved ${anchors.resolved.length}, unquoted ${anchors.unquoted.length}, file missing ${anchors.nofile.length}; ` +
    `remove-actioned still present ${anchors.removeStillPresent.length}`,
);
console.log(
  `  evidence citations (unresolved rows): ${evidence.results.length} — missing file ${evidence.missing.length}, past EOF ${evidence.pastEof.length}, ` +
    `fragment near ${evidence.near.length}, moved ${evidence.moved.length}, absent ${evidence.absent.length}, claim echo ${evidence.claimEcho.length}, no fragment ${evidence.unfragmented.length}`,
);
console.log(
  `  launch-profile membership (unresolved rows): ${arms.size} profile id(s) imported; ${membership.results.length} citation clause(s) — ` +
    `asserted arm ok ${membership.ok.length}, MISMATCH ${membership.mismatch.length}, unasserted ${membership.unasserted.length}`,
);

if (WRITE) {
  const changed = reanchor(inventory.rows, anchors);
  const rewritten = rewriteCitations(inventory.rows, evidence);
  const after = anchorAll(inventory.rows, readIndex);
  const evAfter = evidenceAll(inventory.rows, readIndex);
  const memAfter = membershipAll(inventory.rows, arms);
  writeFileSync(JSON_PATH, `${JSON.stringify(inventory, null, 1)}\n`);
  writeFileSync(RATCHET, serializeRatchet(ratchetObject(after, evAfter, memAfter)));
  console.log(
    `\nRe-anchored ${changed} row(s) and ${rewritten} evidence citation(s); wrote ${RATCHET} (absent ${after.absent.length}, ` +
      `remove-actioned still present ${after.removeStillPresent.length}, evidence fragments absent ${evAfter.absent.length}, ` +
      `membership mismatches ${memAfter.mismatch.length}).`,
  );
  console.log("Now regenerate the derived Markdown: node scripts/gen-claim-inventory-md.mjs — and commit all three.");
  process.exit(0);
}

let problems = 0;
if (arms.size < PROFILE_ID_FLOOR || STATUSES.length < 4) {
  problems += 1;
  console.error(`\n✗ launch-profile import yielded ${arms.size} id(s) across ${STATUSES.length} arm(s) (floor ${PROFILE_ID_FLOOR} ids, 4 arms) — the profile's shape changed under this check; a membership test over an empty map proves nothing.`);
}
if (membership.mismatch.length > 0) {
  console.error(`\n  launch-profile membership MISMATCH (REPORTED here; the ratchet below fails a rise):`);
  for (const r of membership.mismatch.slice(0, 20)) console.error(`    ${r.row.file}:${r.row.line} — "${r.id}" asserted ${r.asserted}, profile says ${r.actual.join("/")}: …${r.clause.slice(0, 120)}`);
}
if (anchors.resolvedRemoveStillPresent.length > 0) {
  problems += 1;
  console.error(`\n✗ ${anchors.resolvedRemoveStillPresent.length} remove-actioned row(s) carry a resolution while their copy still renders:`);
  for (const r of anchors.resolvedRemoveStillPresent.slice(0, 20)) console.error(`    ${r.row.file}:${r.row.line} "${r.seg.slice(0, 70)}"`);
  console.error("  A resolution retires the row from every count here; write it only once the copy is gone, or revise the action with the reason.");
}
if (evidence.missing.length > 0 || evidence.pastEof.length > 0) {
  problems += 1;
  console.error(`\n✗ ${evidence.missing.length} evidence citation(s) name a file that does not exist and ${evidence.pastEof.length} cite a line past its end:`);
  for (const r of [...evidence.missing, ...evidence.pastEof].slice(0, 20)) console.error(`    ${r.row.file}:${r.row.line} → ${r.citation.file}:${r.citation.lo}${r.citation.hi !== r.citation.lo ? `-${r.citation.hi}` : ""} (${r.status})`);
  console.error("  A citation that points nowhere reads as evidence and is not. Fix the citation in the row's evidence.");
}
if (evidence.moved.length > 0) {
  problems += 1;
  console.error(`\n✗ ${evidence.moved.length} evidence citation(s) quote a fragment that sits more than ${FRAG_WINDOW} lines from the cited line:`);
  for (const r of evidence.moved.slice(0, 30)) console.error(`    ${r.row.file}:${r.row.line} → ${r.citation.file}:${r.citation.lo} found at ${r.nearest[0]}`);
  if (evidence.moved.length > 30) console.error(`    … and ${evidence.moved.length - 30} more`);
  console.error("  Run `node scripts/check-claim-inventory-anchors.mjs --write` to re-anchor the citations, then regenerate the Markdown.");
}
if (anchors.nofile.length > 0) {
  problems += 1;
  console.error(`\n✗ ${anchors.nofile.length} row(s) cite a file that does not exist:`);
  for (const r of anchors.nofile.slice(0, 20)) console.error(`    ${r.row.file}:${r.row.line}`);
}
if (anchors.moved.length > 0) {
  problems += 1;
  console.error(`\n✗ ${anchors.moved.length} quoted claim(s) sit more than ${WINDOW} lines from their cited line:`);
  for (const r of anchors.moved.slice(0, 40)) console.error(`    ${r.row.file}:${r.row.line} → found at ${r.nearest[0]}`);
  if (anchors.moved.length > 40) console.error(`    … and ${anchors.moved.length - 40} more`);
  console.error("  Run `node scripts/check-claim-inventory-anchors.mjs --write` to re-anchor the line citations, then regenerate the Markdown.");
}

const expected = serializeRatchet(ratchetObject(anchors, evidence, membership));
let committedRaw = null;
let committed = null;
try {
  committedRaw = readFileSync(RATCHET, "utf8");
  committed = JSON.parse(committedRaw);
} catch {
  committedRaw = null;
}
let isTracked = false;
try {
  isTracked = execFileSync("git", ["ls-files", "--error-unmatch", RATCHET], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
} catch {
  isTracked = false;
}
const verdict = ratchetVerdict({ committedRaw, isTracked, expectedRaw: expected, committed, now: ratchetObject(anchors, evidence, membership) });
if (!verdict.ok) {
  problems += 1;
  if (verdict.kind === "untracked") {
    console.error(`\n✗ ${RATCHET} is not committed — an uncommitted ratchet controls nothing. Run --write and commit it.`);
  } else if (verdict.kind === "rose") {
    console.error(`\n✗ The anchor ratchet ROSE: ${verdict.rose.join("; ")}.`);
    console.error("  A quotation that leaves its surface must take a `resolution` on its row; copy the inventory says must go may not grow;");
    console.error("  a cited fragment that leaves its file must be re-cited or the row resolved; an arm asserted against the profile must be the profile's arm.");
    for (const r of evidence.absent.slice(0, 10)) console.error(`    evidence: ${r.row.file}:${r.row.line} → ${r.citation.file}:${r.citation.lo} "${r.citation.seg.slice(0, 70)}"`);
    for (const r of membership.mismatch.slice(0, 10)) console.error(`    membership: ${r.row.file}:${r.row.line} — "${r.id}" asserted ${r.asserted}, profile says ${r.actual.join("/")}`);
    const prevByFile = committed?.absentByFile ?? {};
    for (const [f, n] of Object.entries(anchors.absentByFile)) {
      if (n > (prevByFile[f] ?? 0)) {
        console.error(`    ${f}: absent ${prevByFile[f] ?? 0} → ${n}`);
        for (const r of anchors.absent.filter((x) => x.row.file === f).slice(0, 5)) console.error(`      :${r.row.line} "${r.seg.slice(0, 80)}"`);
      }
    }
  } else {
    console.error(`\n✗ ${RATCHET} is stale — the measured figures fell or the file was edited by hand. Run --write to record the current measurement and commit it.`);
  }
}

if (problems > 0) {
  console.error("\nClaim-inventory anchors FAILED — the inventory no longer quotes the surfaces it says it does.");
  process.exit(1);
}
console.log(
  `\nClaim-inventory anchors passed — ${anchors.anchored.length} quoted claim(s) anchored and ${evidence.near.length} cited fragment(s) in place; ` +
    `absent held at ${anchors.absent.length}, remove-actioned still present at ${anchors.removeStillPresent.length}, ` +
    `evidence fragments absent at ${evidence.absent.length} (each may only fall).`,
);
}
