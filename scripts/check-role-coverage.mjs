#!/usr/bin/env node
// Role coverage — has each role actually READ the portion it is answerable for?
//
//   node scripts/check-role-coverage.mjs              # report + CHECK (never writes)
//   node scripts/check-role-coverage.mjs --write      # regenerate the ratchet (the ONLY writer)
//   node scripts/check-role-coverage.mjs --self-test  # prove the gate can fail
//
// CHECK MODE NEVER MUTATES THE TREE, added 2026-09-02. Until then this gate WROTE
// docs/agent/role-coverage-ratchet.json on every normal run — a gate that mutates
// the tree it is asked to verify, which dirties provenance and lets the ratchet
// (the only control preventing coverage being un-read) heal itself silently. The
// ratchet is now a REGENERATE-AND-DIFF artifact, the same pattern preflight uses
// for the Postman collection and the SBOM: `--write` is the sole writer, and the
// default (check) mode recomputes the ratchet from the ledger and FAILS if the
// committed file differs from that recompute, or is untracked. A legitimate RISE
// is clean because `--write` reproduces it exactly; a hand-lowered ratchet fails
// because the recompute from the ledger no longer matches it.
//
// LIMIT, stated rather than pretended away: the recompute is a pure function of
// the LEDGER, so lowering a role's read count AND regenerating the ratchet in the
// same commit still produces a self-consistent pair. That is caught upstream —
// deleting a live claim leaves the file present, so `--write` REFUSES to lower a
// role below its committed floor unless the drop is covered by RETIRED claims
// (files that are genuinely gone). What committed-diff alone cannot catch is a
// hand-edit of BOTH the ledger and this file at once; that residue is a
// ledger-integrity question for review, not one a working-tree diff can decide.
//
// WHY THIS EXISTS, in the owner's words on 2026-08-24: "not everyone in the org
// is reviewing the entire repo and providing real updates and then locking down
// those finds and changes ... I'm not wanting to keep repeating myself."
//
// He was right, and the repository could already prove it. check-review-coverage
// has printed "6.1% — 138 of 2254 files read by a named role" on every preflight
// run for weeks, carrying its own comment: "a green gate suite is not a reviewed
// codebase; this is the number that says so". Nobody moved it. Thirty of
// forty-one roles had never recorded reading a single file, and SEVEN of those
// were ACTIVATED — they ran, produced an artifact, and never read their surface.
// native/ stood at 0 of 140. .claude/, the skills that run the org, at 0 of 81.
//
// THE STRUCTURAL REASON, and why a global percentage never fixed it: a role's
// charter is PROSE. Its surface was not machine-readable, so "have you read your
// portion" was a feeling rather than a question the repo could ask. A global
// number is nobody's number. This gate makes it somebody's.
//
// The split, same as every sibling gate:
//   FATAL     — a role's coverage going BACKWARDS. Not "below a bar": a bar
//               invites arguing about the bar. A ratchet only asks that nobody
//               un-reads what was read, and that widening a surface without
//               reading it shows up instead of diluting a percentage quietly.
//   REPORTED  — every role's count and percentage, WORST FIRST, printed beside
//               the roster's activation count so "we have a security engineer"
//               cannot be said without "who has read 6 of 412 files" under it.
//
// RETIREMENT, added 2026-09-02 — the answer this gate demanded and did not have.
// Its own failure text said "record in the ledger why it no longer holds", and no
// mechanism existed to do that: when `artifacts/mockup-sandbox` was deleted in
// Ponytail cut 3, the five web-engineer claims for it had to be DELETED to keep
// check-review-coverage green, and this gate then read that as five files
// un-read. The only ways out were both wrong — hand-edit the ratchet (it says
// never to) or leave a real, correct deletion permanently red.
//
// So a ledger entry may now be RETIRED (`retiredOn` + `retiredWhy`; the rule is
// written once, in the ledger's own `$comment`). A retired entry counts as
// reading NOTHING, and this gate allows a role's count to fall by exactly the
// number of ITS entries retired since the ratchet was last written — no more.
// Fatal iff `now < before - retiredSince(role)`. That is deliberately the
// tightest form: a deletion of five reviewed files buys exactly five, once. The
// count of retirements is stored in the ratchet alongside the reads, so the
// allowance is consumed the moment the gate next writes, and a SECOND drop of
// five is fatal even though five retired entries still sit in the ledger.
//
// A role with `surface: null` owns no code surface — research, commercial,
// outreach. That is a real answer and is EXCLUDED, never counted as 0%. Reading
// a surface you do not have is not work, and scoring it as failure would teach
// the next author to invent a surface to escape the number.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isRetired } from "./check-review-coverage.mjs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = "docs/agent/org-roster.json";
const LEDGER = "docs/agent/review-coverage.json";
const RATCHET = "docs/agent/role-coverage-ratchet.json";

/** glob -> RegExp. Supports **, * and a trailing directory match. */
export function globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // The sentinel below is U+0000, written as an ESCAPE and not as a raw byte.
  // It was a literal NUL in the source until 2026-09-02, which made git classify
  // this gate as BINARY: `git diff` printed "Binary files differ" instead of the
  // change, and a patch of it could not be applied without --binary. A gate nobody
  // can read the diff of is a gate nobody reviews. Same character, same behaviour.
  const body = esc.replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${body}$`);
}

export function coverageFor(surface, allFiles, reviewedPaths) {
  const res = surface.map(globToRe);
  const owned = allFiles.filter((f) => res.some((re) => re.test(f)));
  const read = owned.filter((f) => reviewedPaths.has(f));
  return { owned: owned.length, read: read.length };
}

/**
 * A count that fell FURTHER than the role's retirements is the only fatal
 * condition. A new role has no baseline. `allowed` is role -> number of that
 * role's claims retired since the ratchet was written (see retiredSince).
 */
export function regressions(before, now, allowed = {}) {
  const out = [];
  for (const [role, was] of Object.entries(before)) {
    const is = now[role];
    if (typeof is !== "number") continue;
    const slack = allowed[role] ?? 0;
    if (is < was - slack) out.push({ role, was, is, allowed: slack });
  }
  return out;
}

/**
 * Retirements the ratchet has not already absorbed. `nowCounts` and
 * `beforeCounts` are role -> total retired claims, from the ledger now and from
 * the ratchet as last written. Never negative: un-retiring a claim restores a
 * live claim, which raises the read count on its own and needs no slack.
 */
export function retiredSince(nowCounts, beforeCounts = {}) {
  const out = {};
  for (const [role, n] of Object.entries(nowCounts)) {
    const delta = n - (beforeCounts[role] ?? 0);
    if (delta > 0) out[role] = delta;
  }
  return out;
}

/**
 * role -> how many of its claims are retired AND name a file that is really
 * gone. `isGone(path)` is passed in so this stays pure and so the gate cannot
 * be talked into slack by a retirement over a file that still exists — that is
 * check-review-coverage's fatal case, and this gate refuses to pay for it
 * independently rather than trusting a sibling gate to run.
 */
export function retiredCounts(entries, isGone = () => true) {
  const out = {};
  for (const e of entries) {
    if (!isRetired(e) || !isGone(e.path)) continue;
    out[e.reviewedBy] = (out[e.reviewedBy] ?? 0) + 1;
  }
  return out;
}

// The note the ratchet file carries. Part of the byte string the check diffs, so
// it lives here as the single source of truth for both --write and the check.
const RATCHET_NOTE =
  "Per-role files-read high-water mark, and the retirements already absorbed. DERIVED " +
  "from the ledger by this gate; never hand-edit. Regenerate with " +
  "`node scripts/check-role-coverage.mjs --write` and commit the result.";

/** The exact object --write persists; also what the check recomputes and diffs. */
export function ratchetObject(readByRole, retired) {
  return { note: RATCHET_NOTE, read: readByRole, retired };
}

/** The exact bytes the ratchet file must hold (2-space JSON + trailing newline). */
export function serializeRatchet(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Pure verdict for check mode — no I/O, so the self-test drives it directly.
 * A gate that never mutates the tree can only conclude from the committed file
 * versus the recompute:
 *   untracked  → a control that is not committed controls nothing.
 *   backwards  → committed differs AND the recompute fell below the committed
 *                floor beyond the retirement allowance (a real un-read).
 *   stale      → committed differs but coverage did not fall (a rise not yet
 *                blessed by `--write`, or a hand-edit that raised/scrambled it).
 */
export function ratchetVerdict({ committedRaw, tracked: isTracked, expectedRaw, before, now, allowed }) {
  if (!isTracked) return { ok: false, kind: "untracked", dropped: [] };
  if (committedRaw !== expectedRaw) {
    const dropped = regressions(before, now, allowed);
    return { ok: false, kind: dropped.length > 0 ? "backwards" : "stale", dropped };
  }
  return { ok: true, kind: "ok", dropped: [] };
}

function tracked() {
  const out = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" });
  return out.trim().split("\n").filter((f) => f && !/(^|\/)(node_modules|dist|build|coverage)\//.test(f));
}

function selfTest() {
  const checks = [];
  const files = ["lib/a.ts", "lib/sub/b.ts", "docs/x.md", "native/ios/App.swift"];
  const read = new Set(["lib/a.ts"]);

  let c = coverageFor(["lib/**"], files, read);
  checks.push(["a ** glob matches nested files", c.owned === 2 && c.read === 1]);

  c = coverageFor(["docs/*.md"], files, read);
  checks.push(["a single-star glob does not cross a directory", c.owned === 1 && c.read === 0]);

  c = coverageFor(["native/**"], files, read);
  checks.push(["a surface nobody has read reports 0, not an error", c.owned === 1 && c.read === 0]);

  // The glob sentinel must survive as a sentinel: a `**` becomes `.*` and a raw
  // `*` does not, which is only true if the placeholder round-trips exactly.
  checks.push([
    "the U+0000 glob sentinel round-trips — ** widens, * does not, and neither leaks the placeholder",
    globToRe("a/**/b.ts").test("a/x/y/b.ts") && !globToRe("a/*/b.ts").test("a/x/y/b.ts") && !globToRe("a/**").source.includes("\u0000"),
  ]);
  // ...and this file stays PLAIN TEXT. A literal NUL here made git call this gate
  // binary: the diff read "Binary files differ" and the patch would not apply.
  checks.push([
    "this gate's own source carries no raw NUL — a gate whose diff cannot be read cannot be reviewed",
    !readFileSync(fileURLToPath(import.meta.url), "utf8").includes("\u0000"),
  ]);

  c = coverageFor(["nothing/**"], files, read);
  checks.push(["a surface matching NO file reports owned 0 — a rotted glob is visible, never silently 100%", c.owned === 0]);

  checks.push(["a ratchet DROP is fatal", regressions({ a: 5 }, { a: 4 }).length === 1]);
  checks.push([
    "a drop EXACTLY covered by retirements is not fatal — the surface left, the reading still happened",
    regressions({ a: 60 }, { a: 55 }, { a: 5 }).length === 0,
  ]);
  checks.push([
    "a drop LARGER than the retirements is fatal — retirement buys exactly what it retired",
    regressions({ a: 60 }, { a: 54 }, { a: 5 }).length === 1,
  ]);
  checks.push([
    "one role's retirements do not pay for another's drop",
    regressions({ a: 60, b: 10 }, { a: 55, b: 9 }, { a: 5 }).length === 1,
  ]);
  checks.push([
    "a rise is still fine when retirements exist, and does not bank slack",
    regressions({ a: 60 }, { a: 61 }, { a: 5 }).length === 0,
  ]);
  checks.push([
    "a NEW role is not a regression even with retirements in play",
    regressions({}, { a: 3 }, { a: 2 }).length === 0,
  ]);
  checks.push([
    "retirements the ratchet ALREADY absorbed buy nothing a second time",
    Object.keys(retiredSince({ a: 5 }, { a: 5 })).length === 0 &&
      retiredSince({ a: 7 }, { a: 5 }).a === 2 &&
      Object.keys(retiredSince({ a: 3 }, { a: 5 })).length === 0,
  ]);
  checks.push([
    "a second drop of five, after the ratchet absorbed the first five, is FATAL",
    regressions({ a: 55 }, { a: 50 }, retiredSince({ a: 5 }, { a: 5 })).length === 1,
  ]);
  checks.push([
    "retiredCounts counts retired claims per reviewer and ignores live ones",
    (() => {
      const c = retiredCounts([
        { reviewedBy: "web-engineer", path: "x", retiredOn: "2026-09-02", retiredWhy: "gone" },
        { reviewedBy: "web-engineer", path: "y", retiredOn: "2026-09-02", retiredWhy: "gone" },
        { reviewedBy: "web-engineer", path: "z" },
        { reviewedBy: "sre", path: "q" },
      ]);
      return c["web-engineer"] === 2 && c.sre === undefined;
    })(),
  ]);
  checks.push([
    "a retirement over a file that STILL EXISTS buys NO slack — this gate does not trust its sibling to run",
    (() => {
      const entries = [
        { reviewedBy: "web-engineer", path: "gone.ts", retiredOn: "2026-09-02", retiredWhy: "deleted" },
        { reviewedBy: "web-engineer", path: "lib/a.ts", retiredOn: "2026-09-02", retiredWhy: "not deleted at all" },
      ];
      const c = retiredCounts(entries, (path) => !files.includes(path));
      return c["web-engineer"] === 1;
    })(),
  ]);
  checks.push(["a ratchet rise is fine", regressions({ a: 5 }, { a: 9 }).length === 0]);
  checks.push(["an unchanged count is fine", regressions({ a: 5 }, { a: 5 }).length === 0]);
  checks.push(["a NEW role with no prior baseline is not a regression", regressions({}, { a: 3 }).length === 0]);

  // The live tree must actually produce rows, or the gate is measuring nothing.
  const roster = JSON.parse(readFileSync(`${repo}/${ROSTER}`, "utf8")).roles;
  const withSurface = roster.filter((r) => Array.isArray(r.surface) && r.surface.length > 0);
  checks.push(["LIVE: the roster carries machine-readable surfaces", withSurface.length > 0]);

  // LIVE: retired claims in the real ledger must name real roles, or the slack
  // is computed against a role id nobody owns and quietly buys nothing.
  const liveLedger = JSON.parse(readFileSync(`${repo}/${LEDGER}`, "utf8")).reviews;
  const liveTracked = new Set(tracked());
  const liveRetired = retiredCounts(liveLedger, (path) => !liveTracked.has(path));
  const rosterIds = new Set(roster.map((r) => r.id));
  checks.push([
    `LIVE: every retired claim names a role on the roster (${Object.keys(liveRetired).length} role(s) with retirements)`,
    Object.keys(liveRetired).every((id) => rosterIds.has(id)),
  ]);
  checks.push([
    "LIVE: no retired claim is counted as a read file",
    !liveLedger.filter(isRetired).some((e) => liveTracked.has(e.path)),
  ]);

  // ── the ratchet is a REGENERATE-AND-DIFF artifact; the check must never write ──
  {
    const expectedRaw = serializeRatchet(ratchetObject({ a: 10 }, {}));
    // Hand-lowered ratchet, ledger UNCHANGED: committed says 5, the recompute
    // from the ledger says 10. The diff fails → RED.
    const handLowered = serializeRatchet(ratchetObject({ a: 5 }, {}));
    let v = ratchetVerdict({ committedRaw: handLowered, tracked: true, expectedRaw, before: { a: 5 }, now: { a: 10 }, allowed: {} });
    checks.push(["a hand-lowered ratchet is RED — the committed file disagrees with the recompute", !v.ok]);

    // The recompute reproduces the committed file exactly → GREEN. This is the
    // legitimate-rise path: run --write, commit, and the check passes.
    v = ratchetVerdict({ committedRaw: expectedRaw, tracked: true, expectedRaw, before: { a: 10 }, now: { a: 10 }, allowed: {} });
    checks.push(["the recompute equals the committed file — GREEN", v.ok]);

    // An untracked ratchet controls nothing.
    v = ratchetVerdict({ committedRaw: "", tracked: false, expectedRaw, before: {}, now: { a: 10 }, allowed: {} });
    checks.push(["an untracked ratchet is RED — a control that is not committed controls nothing", !v.ok && v.kind === "untracked"]);

    // The ledger itself dropped (a role un-read) without a covering retirement:
    // committed floor 10, recompute 4 → classified BACKWARDS, not merely stale.
    v = ratchetVerdict({
      committedRaw: serializeRatchet(ratchetObject({ a: 10 }, {})),
      tracked: true,
      expectedRaw: serializeRatchet(ratchetObject({ a: 4 }, {})),
      before: { a: 10 },
      now: { a: 4 },
      allowed: {},
    });
    checks.push(["a drop below the committed floor is classified BACKWARDS, not stale", !v.ok && v.kind === "backwards"]);

    // A drop exactly covered by retirements is not backwards — it is a stale
    // ratchet awaiting --write, never a violation.
    v = ratchetVerdict({
      committedRaw: serializeRatchet(ratchetObject({ a: 10 }, {})),
      tracked: true,
      expectedRaw: serializeRatchet(ratchetObject({ a: 5 }, { a: 5 })),
      before: { a: 10 },
      now: { a: 5 },
      allowed: { a: 5 },
    });
    checks.push(["a drop fully covered by retirements is stale (awaiting --write), not backwards", !v.ok && v.kind === "stale"]);
  }

  const failed = checks.filter(([, k]) => !k);
  for (const [n, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
else if (runAsCli && process.argv.includes("--write")) writeRatchet();
else if (runAsCli) runGate();

/** Reads roster + ledger + tree and returns the per-role rows plus retirements.
 *  Shared by the report, the check, and --write so all three see one truth. */
function computeRows() {
  const roster = JSON.parse(readFileSync(`${repo}/${ROSTER}`, "utf8")).roles;
  const ledger = JSON.parse(readFileSync(`${repo}/${LEDGER}`, "utf8")).reviews;
  const reviewedBy = new Map();
  for (const e of ledger) {
    // A retired claim names a file that no longer exists. It is kept as the
    // record that the read happened; it reads nothing in THIS checkout.
    if (isRetired(e)) continue;
    if (!reviewedBy.has(e.reviewedBy)) reviewedBy.set(e.reviewedBy, new Set());
    reviewedBy.get(e.reviewedBy).add(e.path);
  }
  const trackedSet = new Set(tracked());
  const retiredNow = retiredCounts(ledger, (path) => !trackedSet.has(path));
  const files = [...trackedSet];

  const rows = [];
  for (const role of roster) {
    if (!Array.isArray(role.surface) || role.surface.length === 0) continue;
    const { owned, read } = coverageFor(role.surface, files, reviewedBy.get(role.id) ?? new Set());
    rows.push({
      id: role.id,
      owned,
      read,
      pct: owned === 0 ? null : (100 * read) / owned,
      activated: Boolean(role.activated),
    });
  }
  return { rows, retiredNow };
}

/** The `{ read }` map the ratchet records — one entry per role with a surface. */
function readMapOf(rows) {
  return Object.fromEntries(rows.map((r) => [r.id, r.read]));
}

/** True iff docs/agent/role-coverage-ratchet.json is a tracked file. */
function ratchetTracked() {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", RATCHET], { cwd: repo, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function printReport(rows) {
  console.log("Role coverage — has each role read the portion it is answerable for?\n");
  const withSurface = rows.filter((r) => r.owned > 0);
  const totalOwned = withSurface.reduce((a, r) => a + r.owned, 0);
  const totalRead = withSurface.reduce((a, r) => a + r.read, 0);

  const sorted = [...withSurface].sort((a, b) => a.pct - b.pct || b.owned - a.owned);
  console.log("  WORST FIRST — a role that has read none of its own surface is the top line, deliberately:");
  for (const r of sorted.slice(0, 12)) {
    const flag = r.activated && r.read === 0 ? "   ACTIVATED, has read NOTHING" : "";
    console.log(
      `    ${r.id.padEnd(28)} ${String(r.read).padStart(4)} / ${String(r.owned).padEnd(5)} ${r.pct.toFixed(0).padStart(3)}%${flag}`,
    );
  }

  const rotted = rows.filter((r) => r.owned === 0);
  if (rotted.length > 0) {
    console.log(`\n  SURFACE MATCHES NO FILE (${rotted.length}) — a glob that stopped matching is a coverage claim about nothing:`);
    for (const r of rotted) console.log(`    ${r.id}`);
  }

  const pct = totalOwned === 0 ? 0 : (100 * totalRead) / totalOwned;
  console.log(`\n  ${totalRead} of ${totalOwned} owned file(s) read across ${withSurface.length} roles with a surface (${pct.toFixed(1)}%).`);
}

// ── CHECK MODE — recompute, diff, NEVER write ────────────────────────────────
function runGate() {
  const { rows, retiredNow } = computeRows();
  printReport(rows);

  const now = readMapOf(rows);
  const expectedRaw = serializeRatchet(ratchetObject(now, retiredNow));
  const isTracked = ratchetTracked();
  const committedRaw = existsSync(`${repo}/${RATCHET}`) ? readFileSync(`${repo}/${RATCHET}`, "utf8") : "";
  const prior = committedRaw ? JSON.parse(committedRaw) : {};
  const before = prior.read ?? {};
  const allowed = retiredSince(retiredNow, prior.retired ?? {});

  const spent = Object.entries(allowed).filter(([role]) => (now[role] ?? 0) < (before[role] ?? 0));
  if (spent.length > 0) {
    console.log("\n  RETIRED SINCE THE COMMITTED RATCHET — a deleted surface retires its claims, and buys exactly that drop:");
    for (const [role, n] of spent) {
      console.log(`    ${role.padEnd(28)} ${before[role]} -> ${now[role]} read, ${n} claim(s) retired`);
    }
  }

  const verdict = ratchetVerdict({ committedRaw, tracked: isTracked, expectedRaw, before, now, allowed });
  if (verdict.ok) {
    console.log("\nRole-coverage check passed — the committed ratchet equals the recompute from the ledger.");
    return;
  }
  if (verdict.kind === "untracked") {
    console.error(
      `\nRole-coverage check FAILED — ${RATCHET} is not a tracked file.\n` +
        "  A ratchet that is not committed controls nothing. Run\n" +
        "  `node scripts/check-role-coverage.mjs --write` and commit the result.",
    );
    process.exit(1);
  }
  if (verdict.kind === "backwards") {
    console.error("\nRole-coverage check FAILED — coverage went BACKWARDS:");
    for (const d of verdict.dropped) {
      const slack = d.allowed > 0 ? ` (${d.allowed} retirement(s) allowed for, ${d.was - d.is} lost)` : "";
      console.error(`  x ${d.role}: ${d.was} -> ${d.is} file(s) read${slack}`);
    }
    console.error(
      "  A review claim was deleted, a path was renamed out from under one, or a surface was\n" +
        "  narrowed to flatter the number. Restore the claim, or — if the FILE ITSELF is gone —\n" +
        "  retire the claim in the ledger with `retiredOn` and `retiredWhy` (see its `$comment`),\n" +
        "  then run `node scripts/check-role-coverage.mjs --write` to bless exactly that drop.\n" +
        "  Coverage is allowed to rise and to stand still. It is not allowed to fall.",
    );
    process.exit(1);
  }
  // stale — the committed file differs but coverage did not fall (a rise not yet
  // blessed, or a hand-edit that scrambled/raised it).
  console.error(
    `\nRole-coverage check FAILED — ${RATCHET} does not match the recompute from the ledger.\n` +
      "  Coverage rose, or the file was hand-edited. This gate never writes the tree; run\n" +
      "  `node scripts/check-role-coverage.mjs --write` and commit the regenerated ratchet.",
  );
  process.exit(1);
}

// ── WRITE MODE — the SOLE writer. Refuses to launder an un-read. ──────────────
function writeRatchet() {
  const { rows, retiredNow } = computeRows();
  const now = readMapOf(rows);
  const prior = existsSync(`${repo}/${RATCHET}`) ? JSON.parse(readFileSync(`${repo}/${RATCHET}`, "utf8")) : {};
  const before = prior.read ?? {};
  const allowed = retiredSince(retiredNow, prior.retired ?? {});

  const dropped = regressions(before, now, allowed);
  if (dropped.length > 0) {
    console.error("Refusing to write — the recompute lowers coverage below the committed floor:");
    for (const d of dropped) {
      const slack = d.allowed > 0 ? ` (${d.allowed} retirement(s) allowed for, ${d.was - d.is} lost)` : "";
      console.error(`  x ${d.role}: ${d.was} -> ${d.is} file(s) read${slack}`);
    }
    console.error(
      "  A live claim was removed while its file still exists — retiring buys nothing for a\n" +
        "  file that is still here. Restore the claim, or delete the file and retire the claim,\n" +
        "  then run --write again. --write records reads; it does not launder an un-read.",
    );
    process.exit(1);
  }
  writeFileSync(`${repo}/${RATCHET}`, serializeRatchet(ratchetObject(now, retiredNow)));
  console.log(`Wrote ${RATCHET} — ${Object.keys(now).length} role(s), ${Object.keys(retiredNow).length} with retirements.`);
}
