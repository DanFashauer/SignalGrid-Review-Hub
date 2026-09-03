#!/usr/bin/env node
// Surface read coverage — which surfaces have been READ, and which never have.
//
//   node scripts/check-surface-review-coverage.mjs             # gate + report + table
//   node scripts/check-surface-review-coverage.mjs --write     # regenerate the .md
//   node scripts/check-surface-review-coverage.mjs --self-test # prove the gate can fail
//
// WHY THIS EXISTS. The owner's worry, verbatim, on 2026-09-02:
//
//     "only a select portion of the repo vs the full repo"
//
// Validation here IS whole-repo on every push — preflight, the breadth lane and CI all
// sweep the tree. The deep independent READS are not: the verdict-core reads, the three
// emit-side reads, the iOS runtime read, the Android and desktop reads, the route
// cross-check were each chosen surface by surface, by someone deciding where to look
// next. Nothing recorded that choice, so "we reviewed the repo" and "we reviewed the
// eight places we happened to go" were the same sentence from outside.
//
// THIS GATE'S OWN FIRST VERSION COMMITTED THE DEFECT IT EXISTS TO PREVENT, twice, and
// both are worth keeping written down because they are the failure mode in miniature:
//
//   1. It enumerated surfaces at TOP LEVEL only, so seven "expanded" trees swallowed
//      their own children in silence: artifacts/lane-messages (115 tracked files),
//      artifacts/api-collection (111), lab-collections (42), sim-results (30), the
//      .claude command and hook sets, the CodeQL config, native/ios/mdm — about 330
//      tracked files sat outside both the surface set AND the "not a surface" list. It
//      reported "68 surfaces" over a repository it had not finished counting. A ledger
//      that under-counts its own subject is the unearned affirmative at one remove.
//   2. It credited `docs/*.md` — every top-level document — as READ on the strength of
//      #375, which was an INDEX-row audit that touched three of them.
//
// So coverage of the TREE is now an assertion, not a hope. Every tracked file must be
// claimed by exactly one surface or by a declared out-of-scope tree; anything else is
// FATAL. `tracked files covered: N / N` prints on every run, and if that ratio is not
// 1 the derivation has drifted and the gate refuses.
//
// WHAT IS GATED (fails the build):
//   1. Coverage completeness: every tracked file belongs to a surface or to a declared
//      out-of-scope tree. This is what makes "the full repo" a checkable claim.
//   2. Every derived surface has a row. A surface with no row fails, naming it and the
//      exact line to add — a new package or directory cannot arrive unnoticed.
//   3. Every row names a path that exists and is still a surface the derivation
//      produces. A row for a deleted surface is a fossil.
//   4. Every read carries a date, a reviewer, a record and a SCOPE. The date must be a
//      real calendar day and must not be in the future — a future-dated read can never
//      go stale, which is a silent exemption from the only clock here. A record shaped
//      `#NNN` (N >= 1) is a pull-request reference and is VERIFIED against local history
//      ("(#N)" in a commit subject); a miss in a FULL clone means the reference is
//      fabricated and is fatal, while a miss in a SHALLOW clone (this repo, and CI) is
//      REPORTED, never fatal — a real older PR can sit beyond fetch depth. Anything else
//      must be a path in this tree or a commit `git cat-file -e` resolves.
//   5. Every declared out-of-scope tree (`NON_SURFACE_TREES`) still matches at least one
//      tracked file. The list is used only as a filter, so a key that matches nothing is
//      invisible in the aggregate count yet reads as a hole in coverage that is not there
//      — a stale fossil, and fatal per-key.
//   6. The generated page is not stale versus the JSON and the tree.
//
// WHAT IS REPORTED (never fails the build): which surfaces are unread, which are only
// PARTIALLY read, the oldest read, reads older than 30 days, and PR references this
// shallow clone could not verify. Staleness is reported rather than gated on purpose: a
// ledger that turns red on the calendar gets switched off within a week, and a
// switched-off gate reports nothing at all. The same logic holds the shallow-clone PR
// miss: a full clone would gate it, but a shallow one cannot tell it from an old PR.
//
// READ vs PARTIAL vs EXECUTED — the distinction the first version could not express,
// and the reason it over-reported. `scope` is required on every read:
//   "surface"          the whole surface was read.
//   "partial: <what>"  a named slice of it was. Counts as PARTIAL, never as read.
//   "executed"         the surface was BUILT or RUN, not read. Counts as neither, and
//                      is rendered separately. `6f89457` is the case that forced this:
//                      it is a real, valuable record of the iOS shell compiling and
//                      passing 8/8 on a simulator, and its sixteen files are all under
//                      `artifacts/sim-results/` — not one is under `native/ios/`.
//                      Running code is not reading it.
//
// WHAT THIS DOES NOT PROVE, said plainly because a green table invites the opposite
// reading: a row says a read HAPPENED. It says nothing about whether the read was good,
// how deep it went, or whether it looked at the part that matters. The RECORD — the
// pull request, the commit, the plan row — is the only thing that shows that, and this
// gate checks only that the record RESOLVES, never what it contains. `open`/`closed`
// are transcribed from the record, not judged here.
//
// WHAT IS DERIVED AND WHAT IS DECLARED, stated precisely rather than claimed loosely.
// DERIVED, with no list anywhere: the surface set (workspace globs, then every child of
// an expanded tree that holds tracked files, then the loose files of each such tree as
// their own surface, then every remaining top-level tree). A new package, a new
// directory, a new top-level tree all become surfaces by themselves, and the
// completeness assertion above means one cannot be quietly missed.
// DECLARED, and only this: `NON_SURFACE_TREES` below — trees deliberately out of scope,
// each carrying its reason. It is an EXCLUSION list, so it fails closed: forgetting to
// add something makes it a surface that demands a row, never a file that vanishes.
//
// SIBLING, NOT DUPLICATE. `docs/agent/review-coverage.json` + `check-review-coverage.mjs`
// are FILE-level: which individual files a named role opened, at what depth. This is
// SURFACE-level. The file-level ledger can report hundreds of files read and still not
// answer the owner's question, because hundreds of files spread across four packages
// leaves the rest of the repository unopened.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_REL = "docs/agent/SURFACE_REVIEW_COVERAGE.json";
const PAGE_REL = "docs/agent/SURFACE_REVIEW_COVERAGE.md";
const GENERATED_BY = "<!-- generated by check-surface-review-coverage.mjs --write; do not edit by hand -->";
const STALE_DAYS = 30;

/**
 * Trees deliberately NOT surfaces. The ONLY hand-maintained list in this file, and an
 * exclusion list on purpose: forgetting an entry makes something a surface that demands
 * a row, never a file that disappears from the count.
 */
export const NON_SURFACE_TREES = new Map([
  [
    "third_party",
    "vendored — somebody else's code, so reading it audits an upstream project rather than this repository; scripts/check-publication-boundary.mjs governs it instead.",
  ],
  [
    "attached_assets",
    "owner-pasted raw material whose disposition is an OPEN owner decision (LOOP.md NEXT ACTION, 2026-09-02), so there is no settled shape to read yet.",
  ],
]);

/**
 * Trees whose CHILDREN are the surfaces, rather than the tree itself. Deeper entries
 * must follow their parents; `native/ios` is expanded inside the already-expanded
 * `native` because its Swift targets are separate reading surfaces and its loose
 * project files (project.yml, Signing.xcconfig, setup.sh) are a third.
 *
 * This is not a scope list — nothing is excluded by being here or by being absent. It
 * only decides the GRAIN at which a tree is counted, and every file stays claimed
 * either way, which the completeness assertion proves.
 */
const EXPANDED_TREES = ["lib", "artifacts", "docs", ".claude", ".github", "native", "native/ios"];

/** The id used for files sitting directly in tree T, e.g. `docs/*`, `native/ios/*`. */
const looseId = (tree) => `${tree}/*`;
/** The id used for tracked files at the repository root. */
const ROOT_ID = "(root)";

// ── the tree, as git sees it ─────────────────────────────────────────────────

/**
 * FAIL CLOSED. A checkout this cannot enumerate is a checkout nothing below is true
 * about, so this THROWS rather than returning []. The first version swallowed the
 * failure and returned an empty list, which under `--write` would have baked "None."
 * into the published page — a document asserting completeness on the strength of a
 * command that did not run.
 */
export function listTracked(root = REPO) {
  let out;
  try {
    // stderr is PIPED, not inherited: the fail-closed control in the self-test runs this
    // against a non-repository on purpose, and git's "not a git repository" appearing on
    // the terminal would read as a real error in an otherwise green run.
    out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(`\`git ls-files\` failed in ${root} (${e.message}) — the tree cannot be enumerated, so no coverage claim here would be checkable.`);
  }
  const files = out.split("\0").filter(Boolean);
  if (files.length === 0) throw new Error(`\`git ls-files\` returned nothing in ${root} — refusing to report coverage over an empty tree.`);
  return files;
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// ── workspace packages ───────────────────────────────────────────────────────

/**
 * The `packages:` list out of pnpm-workspace.yaml. A small hand parser rather than a
 * YAML dependency: the block is `packages:` followed by `  - <glob>` lines, and pulling
 * a parser in for four lines would be its own liability. FAIL CLOSED — unreadable, or
 * zero globs, throws, because a workspace resolving to no packages would make every
 * assertion below vacuously true.
 */
export function workspaceGlobs(root = REPO) {
  let src;
  try {
    src = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  } catch (e) {
    throw new Error(`pnpm-workspace.yaml is unreadable (${e.message}) — the surface set cannot be derived, so nothing here is checkable.`);
  }
  const globs = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    if (/^packages:\s*$/.test(raw)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const m = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/.exec(raw);
    if (m) {
      globs.push(m[1]);
      continue;
    }
    if (raw.trim() === "" || raw.startsWith("#")) continue;
    break;
  }
  if (globs.length === 0) throw new Error("pnpm-workspace.yaml yielded ZERO package globs — refusing to report on a surface set derived from nothing.");
  return globs;
}

/** Directories matched by a workspace glob that carry a package.json. */
export function workspacePackages(root = REPO) {
  const out = [];
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith("/*")) {
      const parent = glob.slice(0, -2);
      const dir = join(root, parent);
      if (!isDir(dir)) continue;
      for (const d of readdirSync(dir).sort()) {
        if (existsSync(join(dir, d, "package.json"))) out.push(`${parent}/${d}`);
      }
    } else if (existsSync(join(root, glob, "package.json"))) {
      out.push(glob);
    }
  }
  if (out.length === 0) throw new Error("No workspace package resolved from pnpm-workspace.yaml's globs — the derivation has drifted.");
  return out.sort();
}

// ── derivation ───────────────────────────────────────────────────────────────

/**
 * Every surface this repository is expected to have read at some point, derived from
 * the tracked tree. Returns `[{ id, path, kind }]`, sorted, ids unique.
 *
 * The rule, in one sentence: a workspace package is a surface; every child of an
 * expanded tree that holds tracked files is a surface; the loose files of an expanded
 * tree are a surface; every other top-level tree is a surface; and the tracked files at
 * the repository root are a surface. Nothing is skipped, which is what the coverage
 * assertion in `auditSurfaceCoverage` then proves rather than assumes.
 */
export function deriveSurfaces(root = REPO, tracked = null) {
  const files = (tracked ?? listTracked(root)).filter((f) => !NON_SURFACE_TREES.has(f.split("/")[0]));
  const packages = new Set(workspacePackages(root));
  const expanded = new Set(EXPANDED_TREES);
  const out = new Map();
  const add = (id, path, kind) => {
    if (!out.has(id)) out.set(id, { id, path, kind });
  };

  for (const p of packages) add(p, p, "package");

  for (const tree of EXPANDED_TREES) {
    const prefix = `${tree}/`;
    const depth = tree.split("/").length;
    let sawLoose = false;
    for (const f of files) {
      if (!f.startsWith(prefix)) continue;
      const parts = f.split("/");
      if (parts.length === depth + 1) {
        sawLoose = true;
        continue;
      }
      const child = parts.slice(0, depth + 1).join("/");
      if (expanded.has(child) || packages.has(child)) continue;
      add(child, child, tree === "docs" ? "docs family" : tree === "native" || tree === "native/ios" ? "native" : "tree");
    }
    if (sawLoose) add(looseId(tree), tree, "loose files");
  }

  // Top-level trees that are not expanded, not packages, not out of scope.
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length === 1) {
      add(ROOT_ID, ".", "loose files");
      continue;
    }
    const top = parts[0];
    if (expanded.has(top) || packages.has(top)) continue;
    add(top, top, "tree");
  }

  const list = [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (list.length === 0) throw new Error("the derivation produced no surfaces at all");
  return list;
}

/**
 * Assign every tracked file to exactly one surface. Returns
 * `{ byId, uncovered, outOfScope, total }`. `uncovered` is the set the completeness
 * assertion fails on: a file the derivation forgot is a file no row can ever be about.
 */
export function coverTracked(surfaces, tracked) {
  const byId = new Map(surfaces.map((s) => [s.id, 0]));
  const uncovered = [];
  let outOfScope = 0;
  // Per-key tally of the declared exclusions, so `auditSurfaceCoverage` can prove each
  // one still matches something. A key here that stays at 0 is a stale fossil — a hole
  // dressed as a decision — and is FATAL, distinct from the aggregate `outOfScope > 0`.
  const outOfScopeByKey = new Map([...NON_SURFACE_TREES.keys()].map((k) => [k, 0]));

  // Longest path first, so a child surface always beats its parent tree.
  const exact = surfaces.filter((s) => !s.id.endsWith("/*") && s.id !== ROOT_ID).sort((a, b) => b.path.length - a.path.length);
  const loose = new Map(surfaces.filter((s) => s.id.endsWith("/*")).map((s) => [s.path, s.id]));

  for (const f of tracked) {
    const top = f.split("/")[0];
    if (NON_SURFACE_TREES.has(top)) {
      outOfScope += 1;
      outOfScopeByKey.set(top, outOfScopeByKey.get(top) + 1);
      continue;
    }
    const parts = f.split("/");
    if (parts.length === 1) {
      if (byId.has(ROOT_ID)) {
        byId.set(ROOT_ID, byId.get(ROOT_ID) + 1);
        continue;
      }
      uncovered.push(f);
      continue;
    }
    const parent = parts.slice(0, -1).join("/");
    const looseSurface = loose.get(parent);
    if (looseSurface) {
      byId.set(looseSurface, byId.get(looseSurface) + 1);
      continue;
    }
    const owner = exact.find((s) => f.startsWith(`${s.path}/`));
    if (owner) {
      byId.set(owner.id, byId.get(owner.id) + 1);
      continue;
    }
    uncovered.push(f);
  }
  return { byId, uncovered, outOfScope, outOfScopeByKey, total: tracked.length };
}

// ── field validation ─────────────────────────────────────────────────────────

/** YYYY-MM-DD naming a real calendar day. `2026-02-30` is not one. */
export function isIsoDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Default IO for `resolveRecord`, real git against a root. Injectable so the self-test
 * can drive both the shallow and the full-clone branches deterministically, without
 * depending on this checkout's actual depth.
 */
const defaultRecordIO = {
  /** A squash-merge lands "(#N)" in the commit subject; a `--fixed-strings` grep finds
   * it. Non-empty output ⇒ the referenced PR is in LOCAL history. */
  prInHistory(n, root) {
    let out = "";
    try {
      out = execFileSync("git", ["log", "--all", "--fixed-strings", `--grep=(#${n})`, "--format=%H", "-1"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return false;
    }
    return out.trim() !== "";
  },
  /** True when this clone can resolve the commit object. A shallow clone (CI checks
   * out depth 1) cannot resolve an older commit, so a miss is not proof of a bad hash. */
  commitExists(hex, root) {
    try {
      execFileSync("git", ["cat-file", "-e", `${hex}^{commit}`], { cwd: root, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  },
  /** True when this clone is shallow — a miss then cannot be told from a PR beyond depth. */
  isShallow(root) {
    try {
      return (
        execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === "true"
      );
    } catch {
      return false;
    }
  },
};

/**
 * How a `record` may resolve. "`#NNN` accepted as written" was a hole in the loosening
 * direction: a fabricated `#99999` flipped a surface to READ with nothing to check it.
 * A PR reference is now VERIFIED against local history — a squash-merge lands "(#N)" in
 * the commit subject, and `git log --grep` finds it. A hit resolves. A miss in a FULL
 * clone means the reference is fabricated, so it resolves to null (fatal). A miss in a
 * SHALLOW clone (this repo, and CI) cannot be told apart from a legitimately-old PR
 * beyond the fetch depth, so it resolves to an "UNVERIFIED" string — truthy, so never
 * fatal, but carrying the word so the caller REPORTS it rather than swallowing it.
 *
 * `#0` and `#000000123` are not pull requests, so the shape is anchored at `[1-9]\d*`.
 * Anything else must be a path in this tree, or a commit-ish HEX id git resolves.
 * Requiring hex is what stops an ordinary word ("main", "HEAD") resolving as a branch
 * and laundering a bad record.
 */
export function resolveRecord(record, root = REPO, io = {}) {
  if (typeof record !== "string" || record.trim() === "") return null;
  const r = record.trim();
  const prInHistory = io.prInHistory ?? defaultRecordIO.prInHistory;
  const commitExists = io.commitExists ?? defaultRecordIO.commitExists;
  const m = /^#([1-9]\d*)$/.exec(r);
  if (m) {
    const n = m[1];
    if (prInHistory(n, root)) return "pull-request reference";
    // Clone depth is environment-dependent: CI checks out shallow (depth 1) and
    // even a local clone may lack older merge commits, so a "(#N)" miss cannot
    // be told apart from a fabricated number. A miss is therefore REPORTED as
    // unverified — truthy, never fatal — so a fabricated #NNN surfaces in the
    // unverified list rather than passing silently, and a real older PR beyond
    // the fetch depth never false-fails the gate in CI.
    return `pull-request reference — UNVERIFIED ("(#${n})" not in local history; clone may be shallow)`;
  }
  if (existsSync(join(root, r))) return "path in the tree";
  if (/^[0-9a-f]{7,40}$/i.test(r)) {
    if (commitExists(r, root)) return "commit";
    // Commit resolution is clone-depth dependent (CI checks out depth 1), the same
    // as a PR ref: an older commit beyond the fetch depth cannot be told from a
    // fabricated hash, so a miss is REPORTED, never fatal.
    return `commit reference — UNVERIFIED (${r} not resolvable here; clone may be shallow)`;
  }
  return null;
}

/** The three shapes a read's `scope` may take. Anything else is fatal. */
export function classifyScope(scope) {
  if (scope === "surface") return "surface";
  if (scope === "executed") return "executed";
  if (typeof scope === "string" && /^partial: \S/.test(scope)) return "partial";
  return null;
}

function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86_400_000);
}

// ── audit (pure; the self-test drives it against planted inputs) ─────────────

export function auditSurfaceCoverage(surfaces, ledger, opts = {}) {
  const root = opts.root ?? REPO;
  const pathExists = opts.pathExists ?? ((p) => existsSync(join(root, p)));
  const recordOk = opts.recordOk ?? ((r) => resolveRecord(r, root));
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cover = opts.cover ?? null;

  const fatal = [];
  const empty = { fatal, table: [], notes: [], executions: [], notRead: [], partial: [], stale: [], unverified: [], oldest: null, readCount: 0, total: surfaces.length, cover };

  const rows = ledger && typeof ledger.surfaces === "object" && ledger.surfaces !== null ? ledger.surfaces : null;
  if (!rows) {
    fatal.push(`${LEDGER_REL}: no \`surfaces\` object — the ledger is unreadable, so nothing below is checked.`);
    return empty;
  }

  // (1) COMPLETENESS — every tracked file is claimed. This is the assertion that makes
  // "the full repo" checkable rather than asserted.
  if (cover && cover.uncovered.length > 0) {
    const sample = cover.uncovered.slice(0, 8).join(", ");
    fatal.push(
      `${cover.uncovered.length} tracked file(s) belong to NO surface and to no declared out-of-scope tree — e.g. ${sample}` +
        `${cover.uncovered.length > 8 ? ", …" : ""}.\n` +
        "        The derivation has a shape it does not handle. Until it does, the surface count describes\n" +
        "        less than this repository, which is the exact defect this gate exists to prevent.",
    );
  }

  // (1b) PER-KEY: every declared out-of-scope tree must still match at least one tracked
  // file. `NON_SURFACE_TREES` is the only hand-maintained list here and is used ONLY as a
  // filter, so a key that matches nothing is invisible in the aggregate `outOfScope` count
  // yet reads as a deliberate hole in coverage that is not there — a stale fossil. This is
  // per-key and does NOT replace the aggregate `outOfScope > 0` floor; both must hold.
  const outOfScopeByKey = opts.outOfScopeByKey ?? cover?.outOfScopeByKey ?? null;
  const nonSurfaceKeys = opts.nonSurfaceKeys ?? [...NON_SURFACE_TREES.keys()];
  if (outOfScopeByKey) {
    for (const key of nonSurfaceKeys) {
      if ((outOfScopeByKey.get(key) ?? 0) === 0) {
        fatal.push(
          `NON_SURFACE_TREES key \`${key}/\` is declared out-of-scope but matches no tracked file — ` +
            "a stale exclusion is a hole: delete the key, or restore the tree it was meant to exclude.",
        );
      }
    }
  }

  // (2) every derived surface has a row.
  for (const s of surfaces) {
    if (!Object.prototype.hasOwnProperty.call(rows, s.id)) {
      fatal.push(
        `${LEDGER_REL}: surface \`${s.id}\` (${s.kind}) exists in the tree and has NO row. ` +
          `Add it, with an empty reads array if it has not been read:\n` +
          `        ${JSON.stringify(s.id)}: { "path": ${JSON.stringify(s.path)}, "reads": [] }`,
      );
    }
  }

  // (3) every row points at something still here, and still derived.
  const derivedIds = new Set(surfaces.map((s) => s.id));
  for (const [id, row] of Object.entries(rows)) {
    const path = row?.path;
    if (typeof path !== "string" || path.trim() === "") {
      fatal.push(`${LEDGER_REL}: row \`${id}\` has no \`path\` — a row that names no place describes nothing.`);
    } else if (!pathExists(path)) {
      fatal.push(
        `${LEDGER_REL}: row \`${id}\` names \`${path}\`, which is not in this tree. ` +
          `A row for a deleted surface is a fossil — delete the row, or restore the path.`,
      );
    }
    if (!derivedIds.has(id)) {
      fatal.push(
        `${LEDGER_REL}: row \`${id}\` is not a surface the derivation produces. ` +
          `Either the surface moved, or the row was hand-added — the derivation is the authority.`,
      );
    }
    if (!Array.isArray(row?.reads)) {
      fatal.push(`${LEDGER_REL}: row \`${id}\` has no \`reads\` array. An unread surface is \`"reads": []\`, never a missing field.`);
    }
    // `note` is OPTIONAL and exists for what an empty `reads` array cannot say on its
    // own: work landed NEAR this surface without being a read OF it. Never blank — a
    // blank note reads as an explanation and is not one.
    if (row?.note !== undefined && (typeof row.note !== "string" || row.note.trim() === "")) {
      fatal.push(`${LEDGER_REL}: row \`${id}\` has an empty \`note\`. Write the sentence or drop the field.`);
    }
  }

  // (4) every read is attributable, dated in the past, and scoped.
  const table = [];
  const notRead = [];
  const partial = [];
  const stale = [];
  const executions = [];
  const unverified = [];
  let oldest = null;
  let readCount = 0;

  for (const s of surfaces) {
    const row = rows[s.id];
    const reads = Array.isArray(row?.reads) ? row.reads : [];
    const kinds = [];

    for (const [i, r] of reads.entries()) {
      const where = `${LEDGER_REL}: \`${s.id}\` read #${i + 1}`;
      if (!isIsoDate(r?.date)) {
        fatal.push(`${where} has date \`${r?.date}\` — a read must name the day it happened, as YYYY-MM-DD.`);
      } else if (r.date > today) {
        fatal.push(
          `${where} is dated \`${r.date}\`, which is in the future (today is ${today}). ` +
            "A future-dated read can never age past the staleness window, so it is permanently exempt from the only clock here.",
        );
      }
      for (const field of ["read", "reviewer", "record"]) {
        if (typeof r?.[field] !== "string" || r[field].trim() === "") {
          fatal.push(`${where} is missing \`${field}\` — an unattributable read claim is not evidence that anyone read anything.`);
        }
      }
      const kind = classifyScope(r?.scope);
      if (kind === null) {
        fatal.push(
          `${where} has scope \`${r?.scope}\`. It must be "surface" (the whole surface was read), ` +
            `"partial: <what>" (a named slice), or "executed" (built or run, not read). ` +
            "Without it, a read of three files counts the same as a read of three hundred.",
        );
      } else kinds.push({ kind, read: r });
      for (const field of ["open", "closed"]) {
        if (!Number.isInteger(r?.[field]) || r[field] < 0) {
          fatal.push(`${where} has \`${field}\` = \`${r?.[field]}\`; it must be a non-negative integer transcribed from the record.`);
        }
      }
      if (typeof r?.record === "string" && r.record.trim() !== "") {
        const reason = recordOk(r.record);
        if (reason === null) {
          fatal.push(
            `${where} cites record \`${r.record}\`, which resolves to nothing here. ` +
              "A record must be `#NNN` (a PR in local history), a path in this tree, or a commit id git can resolve.",
          );
        } else if (typeof reason === "string" && /unverified/i.test(reason)) {
          // A PR reference this shallow clone could not confirm. Not fatal — a real older
          // PR can sit beyond fetch depth — but REPORTED so it is never silently accepted.
          unverified.push({ id: s.id, record: r.record, reason });
        }
      }
    }

    const reading = kinds.filter((k) => k.kind !== "executed").map((k) => k.read);
    for (const k of kinds) if (k.kind === "executed") executions.push({ id: s.id, ...k.read });

    const dates = reading.map((r) => r?.date).filter(isIsoDate).sort();
    const last = dates.length ? dates[dates.length - 1] : null;
    const state = kinds.some((k) => k.kind === "surface") ? "READ" : reading.length > 0 ? "PARTIAL" : "NOT READ";

    if (state === "READ") readCount += 1;
    else if (state === "PARTIAL") partial.push(s);
    else notRead.push(s);

    if (last) {
      if (oldest === null || last < oldest.date) oldest = { id: s.id, date: last };
      const age = daysBetween(last, today);
      if (age > STALE_DAYS) stale.push({ id: s.id, date: last, days: age });
    }

    table.push({
      id: s.id,
      kind: s.kind,
      state,
      note: typeof row?.note === "string" ? row.note : "",
      count: reading.length,
      execCount: kinds.filter((k) => k.kind === "executed").length,
      files: cover?.byId.get(s.id) ?? 0,
      last,
      reviewer: reading.length ? String(reading[reading.length - 1]?.reviewer ?? "") : "",
      record: reading.length ? String(reading[reading.length - 1]?.record ?? "") : "",
      open: reading.reduce((a, r) => a + (Number.isInteger(r?.open) ? r.open : 0), 0),
      closed: reading.reduce((a, r) => a + (Number.isInteger(r?.closed) ? r.closed : 0), 0),
    });
  }

  const notes = table.filter((r) => r.note).map((r) => ({ id: r.id, note: r.note }));
  return { fatal, table, notes, executions, notRead, partial, stale, unverified, oldest, readCount, total: surfaces.length, cover };
}

// ── the generated page ───────────────────────────────────────────────────────

/**
 * Deterministic by construction: no timestamp, no HEAD sha, nothing that changes
 * between two runs over the same tree. That is what lets `--write` and the on-disk
 * comparison below be the same computation — and it is why this file can be gated by
 * regenerate-and-compare while docs/STATUS.md, which embeds its own commit sha, cannot.
 */
export function renderPage(audit) {
  const c = audit.cover;
  const L = [];
  L.push(GENERATED_BY);
  L.push("");
  L.push("# Surface read coverage — which surfaces have been read, and which never have");
  L.push("");
  L.push(
    "Validation in this repository is whole-repo on every push. The deep independent",
    "reads are not: each one was chosen surface by surface. This page is the ledger of",
    "that choice, so an unread surface is visible rather than silent.",
  );
  L.push("");
  L.push(
    `**${audit.readCount} of ${audit.total} surfaces have been read. ${audit.partial.length} are partially read. ` +
      `${audit.notRead.length} have not been read at all.**`,
  );
  L.push("");
  if (c) {
    L.push(
      `Coverage of the tree is asserted, not assumed: **${c.total - c.outOfScope - c.uncovered.length} of ` +
        `${c.total - c.outOfScope} in-scope tracked files** belong to a surface on this page ` +
        `(${c.outOfScope} more are in declared out-of-scope trees). A file belonging to no surface fails the gate.`,
    );
    L.push("");
  }
  L.push(
    "A surface counts READ only when some read covers the whole of it. A read of a named",
    "slice is PARTIAL. Building or running a surface is neither, and is listed separately",
    "below. A row says a read HAPPENED — the record is the only thing that shows it was",
    "any good. Source of truth: `docs/agent/SURFACE_REVIEW_COVERAGE.json`. Regenerate with",
    "`node scripts/check-surface-review-coverage.mjs --write`.",
  );
  L.push("");
  L.push("| Surface | Kind | Files | State | Reads | Last read | Reviewer | Record | Closed | Open |");
  L.push("| --- | --- | ---: | --- | ---: | --- | --- | --- | ---: | ---: |");
  for (const r of audit.table) {
    L.push(
      `| \`${r.id}\` | ${r.kind} | ${r.files} | ${r.state === "READ" ? "read" : r.state === "PARTIAL" ? "**partial**" : "**NOT READ**"} | ` +
        `${r.count} | ${r.last ?? "—"} | ${r.reviewer || "—"} | ${r.record || "—"} | ${r.closed} | ${r.open} |`,
    );
  }
  L.push("");

  L.push(`## Partially read (${audit.partial.length})`);
  L.push("");
  L.push("A named slice was read. The rest of the surface has not been.");
  L.push("");
  if (audit.partial.length === 0) L.push("- None.");
  else for (const s of audit.partial) L.push(`- \`${s.id}\` (${s.kind})`);
  L.push("");

  L.push(`## Not read (${audit.notRead.length})`);
  L.push("");
  if (audit.notRead.length === 0) L.push("None — every derived surface carries at least one read.");
  else for (const s of audit.notRead) L.push(`- \`${s.id}\` (${s.kind})`);
  L.push("");

  L.push(`## Execution records (${audit.executions.length})`);
  L.push("");
  L.push("Surfaces that were BUILT or RUN rather than read. Valuable, and not coverage —");
  L.push("these count towards nothing above.");
  L.push("");
  if (audit.executions.length === 0) L.push("- None.");
  else for (const e of audit.executions) L.push(`- \`${e.id}\` — ${e.date}, ${e.reviewer}, \`${e.record}\`: ${e.read}`);
  L.push("");

  // The list of unverified PR references is NOT rendered into the page: whether a
  // "(#N)" resolves depends on the clone's fetch depth (CI checks out shallow),
  // so putting it in the committed page would make the page's own stale-check
  // clone-dependent and red in CI. It is REPORTED in the gate's console output
  // (main()) instead, where output is not byte-compared.

  if (audit.notes.length) {
    L.push("## Notes on individual rows");
    L.push("");
    L.push("Why a row reads the way it does — usually because work landed NEAR a surface");
    L.push("without being a read OF it, which an empty `reads` array cannot say on its own.");
    L.push("");
    for (const n of audit.notes) L.push(`- \`${n.id}\` — ${n.note}`);
    L.push("");
  }

  L.push("## Not a surface");
  L.push("");
  L.push("Declared out of scope, with the reason. This is the only hand-maintained list");
  L.push("behind this page, and it is an exclusion list, so forgetting an entry makes");
  L.push("something a surface that demands a row — never a file that disappears.");
  L.push("");
  for (const [t, why] of NON_SURFACE_TREES) L.push(`- \`${t}/\` — ${why}`);
  L.push("");
  return `${L.join("\n")}\n`;
}

/**
 * The on-disk staleness comparison, as a function of a ROOT so the self-test can drive
 * the real thing against a mutated copy. The first version's control only proved that
 * `String.replace` changes a string; it never touched a file, so the comparison this
 * gate actually performs was never exercised.
 */
export function comparePageOnDisk(root, expected) {
  const p = join(root, PAGE_REL);
  if (!existsSync(p)) return { status: "missing", path: p };
  return { status: readFileSync(p, "utf8") === expected ? "ok" : "stale", path: p };
}

// ── self-test ────────────────────────────────────────────────────────────────

/**
 * Hermetic. Every plant happens in a throwaway git repository under the OS temp dir,
 * never in this working tree.
 *
 * The first version planted `lib/__surface-coverage-selftest__/package.json` in the REAL
 * tree. It cleaned up in a `finally`, and that is not good enough here: simulation
 * provenance is `git status --porcelain` INCLUDING untracked files, so for the seconds
 * the plant existed any concurrent run would have been stamped dirty, and a SIGKILL
 * mid-test would have left a directory that makes this gate fatal on the next run.
 * `deriveSurfaces` already took a root; it just was not being used.
 *
 * The real tree is still falsified both directions — by hand, on the branch, and the
 * result is reported with the change. That is a different check from this one and this
 * comment does not claim to be it.
 */
function makeTempRepo() {
  const root = mkdtempSync(join(tmpdir(), "surface-coverage-selftest-"));
  const w = (rel, body) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  w("pnpm-workspace.yaml", "packages:\n  - artifacts/*\n  - lib/*\n  - scripts\n");
  w("package.json", "{}\n");
  w("README.md", "root file\n");
  w("lib/core/package.json", '{"name":"core"}\n');
  w("lib/core/src/index.ts", "export const x = 1;\n");
  w("artifacts/api-server/package.json", '{"name":"api"}\n');
  w("artifacts/api-server/src/index.ts", "export const y = 1;\n");
  w("artifacts/lane-messages/one.json", "{}\n");
  w("scripts/package.json", '{"name":"scripts"}\n');
  w("scripts/a.mjs", "// a\n");
  w("docs/TOP.md", "# top\n");
  w("docs/agent/LEDGER.md", "# agent\n");
  w("native/android/app/Main.kt", "fun main() {}\n");
  w("native/ios/Shell/App.swift", "let a = 1\n");
  w("native/ios/project.yml", "name: x\n");
  w("firmware/dock/src/lib.rs", "pub fn f() {}\n");
  // One file under EVERY declared out-of-scope key, so the fixture is consistent with the
  // per-key F2 check (a key matching zero tracked files is fatal) rather than tripping it.
  w("third_party/vendor/thing.js", "// vendored\n");
  w("attached_assets/raw/pasted.txt", "raw\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

function selfTest() {
  const controls = [];
  const check = (name, fn) => {
    let ok = false;
    let detail = "";
    try {
      ok = fn() === true;
    } catch (e) {
      detail = ` (threw: ${e.message})`;
    }
    controls.push({ name, ok, detail });
  };

  const ledger = JSON.parse(readFileSync(join(REPO, LEDGER_REL), "utf8"));
  const tracked = listTracked(REPO);
  const base = deriveSurfaces(REPO, tracked);
  const baseCover = coverTracked(base, tracked);
  const auditReal = (l, o = {}) => auditSurfaceCoverage(base, l, { cover: baseCover, ...o });

  // ── floors on the REAL tree: a derivation that has drifted must refuse ──────
  check("the derivation finds at least 80 surfaces (a shrunken sweep is green about nothing)", () => base.length >= 80);
  check("the derivation finds the packages, apps, trees, loose-file sets and docs families it is named for", () => {
    const ids = new Set(base.map((s) => s.id));
    return [
      "lib/signalgrid-core", "lib/integrations", "artifacts/api-server", "artifacts/lane-messages", "artifacts/api-collection",
      "scripts", "native/android", "native/ios/EnterpriseShell", "native/ios/mdm", "native/ios/*",
      "firmware", "tests", ".github/workflows", ".claude/skills", ".claude/hooks", ".github/*", "docs/*", "docs/agent", "(root)",
    ].every((i) => ids.has(i));
  });
  check("EVERY tracked in-scope file is claimed by exactly one surface (this is what 'the full repo' means here)", () => baseCover.uncovered.length === 0);
  check("the out-of-scope trees really do hold files, so excluding them is a decision about something", () => baseCover.outOfScope > 0);
  check("the clean tree audits with ZERO fatal problems", () => auditReal(ledger).fatal.length === 0);

  // ── the completeness assertion must be able to fail ─────────────────────────
  check("a tracked file belonging to no surface is FATAL", () => {
    const holed = base.filter((s) => s.id !== "lib/signalgrid-core");
    const cover = coverTracked(holed, tracked);
    if (cover.uncovered.length === 0) return false;
    const { fatal } = auditSurfaceCoverage(holed, ledger, { cover });
    return fatal.some((f) => f.includes("belong to NO surface"));
  });

  // ── F2: a stale out-of-scope key (matching zero tracked files) must be FATAL ─
  check("the declared out-of-scope keys each really match tracked files (baseCover proves it)", () => {
    return [...NON_SURFACE_TREES.keys()].every((k) => (baseCover.outOfScopeByKey.get(k) ?? 0) > 0);
  });
  check("a NON_SURFACE_TREES key matching ZERO tracked files is FATAL, naming the key", () => {
    const { fatal } = auditReal(ledger, { nonSurfaceKeys: [...NON_SURFACE_TREES.keys(), "no_such_tree_xyz"] });
    return fatal.some((f) => f.includes("no_such_tree_xyz") && f.includes("stale exclusion is a hole"));
  });
  check("removing the bogus key clears that failure (the per-key check is not simply always red)", () => {
    return auditReal(ledger, { nonSurfaceKeys: [...NON_SURFACE_TREES.keys()] }).fatal.length === 0;
  });

  // ── plants on a REAL but THROWAWAY git tree ────────────────────────────────
  let temp = null;
  try {
    temp = makeTempRepo();
    const tTracked = listTracked(temp);
    const tSurfaces = deriveSurfaces(temp, tTracked);
    const tCover = coverTracked(tSurfaces, tTracked);
    const rowsFor = (ids) => ({ surfaces: Object.fromEntries(ids.map((s) => [s.id, { path: s.path, reads: [] }])) });
    const tLedger = rowsFor(tSurfaces);
    const tAudit = (l, o = {}) => auditSurfaceCoverage(tSurfaces, l, { root: temp, cover: tCover, ...o });

    check("the temp tree derives the same SHAPES as the real one (packages, children, loose files, root)", () => {
      const ids = new Set(tSurfaces.map((s) => s.id));
      return ["lib/core", "artifacts/api-server", "artifacts/lane-messages", "scripts", "docs/agent", "docs/*", "native/android", "native/ios/Shell", "native/ios/*", "firmware", "(root)"].every((i) => ids.has(i));
    });
    check("the temp tree is fully covered, and both declared out-of-scope trees are excluded rather than lost", () => tCover.uncovered.length === 0 && tCover.outOfScope === 2 && tCover.outOfScopeByKey.get("third_party") === 1 && tCover.outOfScopeByKey.get("attached_assets") === 1);
    check("a complete temp ledger audits clean", () => tAudit(tLedger).fatal.length === 0);

    // PLANT 1 — a new package appears with no row.
    mkdirSync(join(temp, "lib/planted"), { recursive: true });
    writeFileSync(join(temp, "lib/planted/package.json"), '{"name":"planted"}\n');
    writeFileSync(join(temp, "lib/planted/index.ts"), "export const z = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: temp });
    const pTracked = listTracked(temp);
    const pSurfaces = deriveSurfaces(temp, pTracked);
    const pCover = coverTracked(pSurfaces, pTracked);

    check("a planted package is DERIVED (the scope really comes from the tree)", () => pSurfaces.some((s) => s.id === "lib/planted"));
    check("a derived surface with no row is FATAL, and the message names it", () => {
      const { fatal } = auditSurfaceCoverage(pSurfaces, tLedger, { root: temp, cover: pCover });
      return fatal.some((f) => f.includes("lib/planted") && f.includes("NO row"));
    });
    check("adding the row clears that failure (the gate is not simply always red)", () => {
      const withRow = { surfaces: { ...tLedger.surfaces, "lib/planted": { path: "lib/planted", reads: [] } } };
      return auditSurfaceCoverage(pSurfaces, withRow, { root: temp, cover: pCover }).fatal.length === 0;
    });
    check("an empty reads array is NOT fatal, and the surface appears in the NOT READ list", () => {
      const withRow = { surfaces: { ...tLedger.surfaces, "lib/planted": { path: "lib/planted", reads: [] } } };
      const a = auditSurfaceCoverage(pSurfaces, withRow, { root: temp, cover: pCover });
      return a.fatal.length === 0 && a.notRead.some((s) => s.id === "lib/planted");
    });

    // PLANT 2 — the surface is gone, the row is not.
    rmSync(join(temp, "lib/planted"), { recursive: true, force: true });
    execFileSync("git", ["add", "-A"], { cwd: temp });
    const dTracked = listTracked(temp);
    const dSurfaces = deriveSurfaces(temp, dTracked);
    check("a row whose directory has been DELETED is FATAL", () => {
      const withRow = { surfaces: { ...tLedger.surfaces, "lib/planted": { path: "lib/planted", reads: [] } } };
      const { fatal } = auditSurfaceCoverage(dSurfaces, withRow, { root: temp, cover: coverTracked(dSurfaces, dTracked) });
      return fatal.some((f) => f.includes("lib/planted") && f.includes("not in this tree"));
    });

    // PLANT 3 — the page comparison, driven against a file on disk.
    check("a page written to disk compares OK, and a one-word edit to that file is STALE", () => {
      const page = renderPage(tAudit(tLedger));
      mkdirSync(join(temp, dirname(PAGE_REL)), { recursive: true });
      writeFileSync(join(temp, PAGE_REL), page);
      const clean = comparePageOnDisk(temp, page);
      writeFileSync(join(temp, PAGE_REL), page.replace("have not been read at all.**", "have not been read at all (hand edited).**"));
      const dirty = comparePageOnDisk(temp, page);
      rmSync(join(temp, PAGE_REL));
      const gone = comparePageOnDisk(temp, page);
      return clean.status === "ok" && dirty.status === "stale" && gone.status === "missing";
    });

    check("listTracked FAILS CLOSED on a directory git cannot enumerate (it never returns [])", () => {
      const notARepo = mkdtempSync(join(tmpdir(), "surface-coverage-notrepo-"));
      try {
        listTracked(notARepo);
        return false;
      } catch {
        return true;
      } finally {
        rmSync(notARepo, { recursive: true, force: true });
      }
    });
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }

  check("workspaceGlobs fails closed on a workspace file it cannot read", () => {
    try {
      workspaceGlobs("/nonexistent-root-for-selftest");
      return false;
    } catch {
      return true;
    }
  });

  // ── field-level plants ─────────────────────────────────────────────────────
  const one = [{ id: "lib/signalgrid-core", path: "lib/signalgrid-core", kind: "package" }];
  const withRead = (read) => ({ surfaces: { "lib/signalgrid-core": { path: "lib/signalgrid-core", reads: [read] } } });
  const good = { date: "2026-09-02", read: "x", reviewer: "r", record: "#376", scope: "surface", open: 0, closed: 0 };
  const audit1 = (l, o = {}) => auditSurfaceCoverage(one, l, { today: "2026-09-02", ...o });

  check("a well-formed read with a #NNN record passes and counts as READ", () => {
    const a = audit1(withRead(good));
    return a.fatal.length === 0 && a.readCount === 1 && a.partial.length === 0;
  });
  check("a record that resolves NOWHERE is FATAL", () => audit1(withRead({ ...good, record: "docs/THIS_DOES_NOT_EXIST.md" })).fatal.some((f) => f.includes("resolves to nothing")));
  check("a record that is a real path in the tree passes", () => audit1(withRead({ ...good, record: "docs/COMPANY_BUILD_PLAN.md" })).fatal.length === 0);
  check("a resolvable commit passes; a commit NOT resolvable here is REPORTED unverified, never fatal (clone depth is unknowable, injected)", () => {
    const okc = (rec) => resolveRecord(rec, REPO, { commitExists: () => true });
    const missc = (rec) => resolveRecord(rec, REPO, { commitExists: () => false });
    const a = audit1(withRead({ ...good, record: "abc1234" }), { recordOk: okc });
    const b = audit1(withRead({ ...good, record: "abc1234" }), { recordOk: missc });
    return (
      a.fatal.length === 0 && a.unverified.length === 0 &&
      b.fatal.length === 0 && b.unverified.length === 1 && /unverified/i.test(b.unverified[0].reason)
    );
  });
  check("`#0` and `#000000123` are NOT pull-request references", () => resolveRecord("#0") === null && resolveRecord("#000000123") === null);
  check("a well-formed #NNN in local history resolves to a plain PR reference (injected, depth-independent)", () => resolveRecord("#4242", REPO, { prInHistory: () => true }) === "pull-request reference");

  // ── F1: a PR reference is VERIFIED against local history; a miss is judged by depth ──
  // io injected so these do not depend on the real repo's actual clone depth.
  const recordOkWith = (io) => (rec) => resolveRecord(rec, REPO, io);
  check("a #NNN whose PR IS in local history resolves, and the surface counts READ", () => {
    const a = audit1(withRead({ ...good, record: "#4242" }), { recordOk: recordOkWith({ prInHistory: () => true, isShallow: () => false }) });
    return a.fatal.length === 0 && a.readCount === 1 && a.unverified.length === 0;
  });
  check("a #NNN NOT in local history is NOT fatal but is REPORTED unverified — regardless of clone depth (a real miss and a fabricated number are indistinguishable, so neither false-fails CI nor passes silently)", () => {
    const a = audit1(withRead({ ...good, record: "#99999" }), { recordOk: recordOkWith({ prInHistory: () => false }) });
    return a.fatal.length === 0 && a.unverified.length === 1 && a.unverified[0].record === "#99999" && /unverified/i.test(a.unverified[0].reason);
  });
  check("a read with no reviewer is FATAL", () => audit1(withRead({ ...good, reviewer: "" })).fatal.some((f) => f.includes("reviewer")));
  check("a read with an impossible date is FATAL", () => audit1(withRead({ ...good, date: "2026-02-30" })).fatal.some((f) => f.includes("must name the day")));
  check("a FUTURE-dated read is FATAL (it could never go stale)", () => audit1(withRead({ ...good, date: "2099-01-01" })).fatal.some((f) => f.includes("in the future")));
  check("a read with no record is FATAL", () => audit1(withRead({ ...good, record: "" })).fatal.some((f) => f.includes("record")));

  // ── scope, the distinction that stops a slice counting as the whole ────────
  check("a read with no scope is FATAL", () => audit1(withRead({ ...good, scope: undefined })).fatal.some((f) => f.includes("It must be \"surface\"")));
  check("an unrecognised scope is FATAL, and a bare \"partial\" with nothing named is too", () => {
    return (
      audit1(withRead({ ...good, scope: "skimmed" })).fatal.length > 0 &&
      audit1(withRead({ ...good, scope: "partial" })).fatal.length > 0 &&
      audit1(withRead({ ...good, scope: "partial: " })).fatal.length > 0
    );
  });
  check("a partial read counts PARTIAL, never READ", () => {
    const a = audit1(withRead({ ...good, scope: "partial: three files" }));
    return a.fatal.length === 0 && a.readCount === 0 && a.partial.length === 1 && a.notRead.length === 0 && a.table[0].state === "PARTIAL";
  });
  check("an executed record counts as NEITHER, and is listed separately", () => {
    const a = audit1(withRead({ ...good, scope: "executed" }));
    return a.fatal.length === 0 && a.readCount === 0 && a.partial.length === 0 && a.notRead.length === 1 && a.executions.length === 1;
  });
  check("a surface read is not downgraded by a partial read beside it", () => {
    const l = { surfaces: { "lib/signalgrid-core": { path: "lib/signalgrid-core", reads: [{ ...good, scope: "partial: a slice" }, good] } } };
    return audit1(l).readCount === 1;
  });

  // ── staleness is REPORTED, never fatal — proven both ways ──────────────────
  check("an ancient read is REPORTED stale and is NOT fatal", () => {
    const a = audit1(withRead({ ...good, date: "2000-01-01" }));
    return a.fatal.length === 0 && a.stale.length === 1 && a.oldest?.date === "2000-01-01";
  });
  check("a read inside the staleness window is not flagged", () => audit1(withRead(good), { today: "2026-09-05" }).stale.length === 0);
  check("an executed record does not set the staleness clock", () => audit1(withRead({ ...good, date: "2000-01-01", scope: "executed" })).stale.length === 0);

  // ── notes, and the ledger's own readability ────────────────────────────────
  check("an empty `note` is FATAL, and a written one is carried", () => {
    const blank = { surfaces: { "lib/signalgrid-core": { path: "lib/signalgrid-core", note: "  ", reads: [] } } };
    const written = { surfaces: { "lib/signalgrid-core": { path: "lib/signalgrid-core", note: "a real sentence", reads: [] } } };
    return audit1(blank).fatal.some((f) => f.includes("empty `note`")) && audit1(written).fatal.length === 0 && audit1(written).notes.length === 1;
  });
  check("a missing `surfaces` object is FATAL rather than vacuously green", () => auditReal({ version: 1 }).fatal.length > 0);
  check("the page is byte-stable across two renders", () => renderPage(auditReal(ledger)) === renderPage(auditReal(ledger)));
  check("the page names the declared out-of-scope trees and their reasons", () => {
    const p = renderPage(auditReal(ledger));
    return p.includes("`third_party/`") && p.includes("`attached_assets/`") && p.includes("vendored");
  });

  let bad = 0;
  console.log("Surface-read-coverage self-test — the gate must be able to fail\n");
  for (const c of controls) {
    console.log(`  ${c.ok ? "ok  " : "FAIL"} — ${c.name}${c.detail}`);
    if (!c.ok) bad += 1;
  }
  console.log(`\nself-test: ${controls.length - bad}/${controls.length} controls passed`);
  if (bad) {
    console.error("\nSelf-test FAILED — a gate that cannot fail proves nothing, so this refuses to run.");
    process.exit(1);
  }
  process.exit(0);
}

// ── main ─────────────────────────────────────────────────────────────────────

function main({ write }) {
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(join(REPO, LEDGER_REL), "utf8"));
  } catch (e) {
    console.error(`✗ ${LEDGER_REL} could not be read or parsed (${e.message}). The ledger is the gate's subject; without it nothing is checkable.`);
    process.exit(1);
  }

  let tracked;
  let surfaces;
  let cover;
  try {
    tracked = listTracked(REPO);
    surfaces = deriveSurfaces(REPO, tracked);
    cover = coverTracked(surfaces, tracked);
  } catch (e) {
    console.error(`✗ the surface set could not be derived: ${e.message}`);
    process.exit(1);
  }

  const audit = auditSurfaceCoverage(surfaces, ledger, { cover });
  const page = renderPage(audit);

  if (write) {
    if (audit.fatal.length > 0) {
      console.error("✗ refusing to write the page over a ledger that does not pass the gate:\n");
      for (const f of audit.fatal) console.error(`  ✗ ${f}`);
      process.exit(1);
    }
    writeFileSync(join(REPO, PAGE_REL), page);
    console.log(
      `wrote ${PAGE_REL} — ${audit.readCount} read, ${audit.partial.length} partial, ${audit.notRead.length} not read, of ${audit.total} surfaces`,
    );
    return;
  }

  console.log("Surface read coverage — which surfaces have been read, and which never have\n");
  const w = Math.max(...audit.table.map((r) => r.id.length), 7);
  console.log(`  ${"SURFACE".padEnd(w)}  FILES  STATE      READS  LAST READ    CLOSED  OPEN  RECORD`);
  for (const r of audit.table) {
    console.log(
      `  ${r.id.padEnd(w)}  ${String(r.files).padStart(5)}  ${r.state.padEnd(9)}  ${String(r.count).padStart(5)}  ` +
        `${(r.last ?? "—").padEnd(11)}  ${String(r.closed).padStart(6)}  ${String(r.open).padStart(4)}  ${r.record || "—"}`,
    );
  }

  console.log(`\n  GATED: every tracked file belongs to a surface; every surface has a row; every row's path exists;`);
  console.log("         every read has a date in the past, a reviewer, a resolvable record and a scope; the page is not stale.");
  console.log("  REPORTED: which surfaces are unread or partial, the oldest read, and reads older than 30 days.");
  console.log("            Never fatal — a ledger that reddens on the calendar gets switched off, and then reports nothing.");
  console.log("  NOT PROVEN by any row here: that the read was any good. The record is what proves that.\n");

  const inScope = cover.total - cover.outOfScope;
  console.log(`  tracked files: ${cover.total} — ${inScope - cover.uncovered.length}/${inScope} in-scope files belong to a surface, ${cover.outOfScope} in declared out-of-scope trees`);
  console.log(`  READ:     ${audit.readCount} of ${audit.total} surfaces`);
  console.log(`  PARTIAL:  ${audit.partial.length} of ${audit.total} surfaces`);
  for (const s of audit.partial) console.log(`            · ${s.id} (${s.kind})`);
  console.log(`  NOT READ: ${audit.notRead.length} of ${audit.total} surfaces`);
  for (const s of audit.notRead) console.log(`            · ${s.id} (${s.kind})`);
  if (audit.executions.length) {
    console.log(`  EXECUTED, not read (${audit.executions.length}) — built or run; counts towards nothing above:`);
    for (const e of audit.executions) console.log(`            · ${e.id} — ${e.date}, ${e.record}`);
  }
  if (audit.unverified.length) {
    console.log(
      `  REPORTED: ${audit.unverified.length} record(s) unverified — PR refs not in this shallow clone's local history ` +
        "(a miss here is not proof of a bad ref; in a full clone it would be fatal):",
    );
    for (const u of audit.unverified) console.log(`            · ${u.id} — ${u.record}: ${u.reason}`);
  }
  if (audit.notes.length) {
    console.log("  NOTES on individual rows:");
    for (const n of audit.notes) console.log(`            · ${n.id} — ${n.note}`);
  }
  console.log("  NOT A SURFACE, declared with a reason:");
  for (const [t, why] of NON_SURFACE_TREES) console.log(`            · ${t}/ — ${why}`);
  if (audit.oldest) console.log(`  oldest read: ${audit.oldest.id} on ${audit.oldest.date}`);
  if (audit.stale.length) {
    console.log(`  STALE (>${STALE_DAYS} days, reported only):`);
    for (const s of audit.stale) console.log(`            · ${s.id} — last read ${s.date}, ${s.days} days ago`);
  } else {
    console.log(`  stale (>${STALE_DAYS} days): none`);
  }

  let problems = audit.fatal.length;
  for (const f of audit.fatal) console.error(`\n  ✗ ${f}`);

  const cmp = comparePageOnDisk(REPO, page);
  if (cmp.status === "missing") {
    console.error(`\n  ✗ ${PAGE_REL} does not exist. It is generated — run \`node scripts/check-surface-review-coverage.mjs --write\` and commit it.`);
    problems += 1;
  } else if (cmp.status === "stale") {
    console.error(
      `\n  ✗ ${PAGE_REL} is STALE versus ${LEDGER_REL} and the tree. ` +
        "Run `node scripts/check-surface-review-coverage.mjs --write` and commit it.\n" +
        "      The page carries no timestamp and no commit sha precisely so that regenerate-and-compare is a sound test for it.",
    );
    problems += 1;
  }

  if (problems > 0) {
    console.error("\nSurface-read-coverage gate FAILED — the ledger no longer describes the tree, and a surface it cannot see is a surface nobody is told about.");
    process.exit(1);
  }
  console.log("\nSurface-read-coverage gate passed — every tracked file belongs to a surface, every surface has a row, and every read in it is attributable.");
}

// Importable: `scripts/loop-state.mjs` reuses the derivation for its one-line row, and a
// module that ran its own gate on import would turn that reuse into a second full run
// with a second exit code. Same guard `check-review-coverage.mjs` uses, for the same reason.
const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  else main({ write: argv.includes("--write") });
}
