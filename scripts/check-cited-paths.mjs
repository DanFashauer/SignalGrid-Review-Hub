// Cited-path check — a document may not point at a file that does not exist.
//
//   node scripts/check-cited-paths.mjs                    # gate this repository
//   node scripts/check-cited-paths.mjs --root /path/repo  # gate any other checkout
//   node scripts/check-cited-paths.mjs --json             # machine-readable
//   node scripts/check-cited-paths.mjs --self-test        # prove the gate can fail
//
// WHY. `check-doc-orphans.mjs` asks whether a reader can REACH a document. This asks
// whether the document, once reached, points anywhere real. Different question, and the
// gap between them is where evidence-shaped nothing lives: a reviewer skims
// `lib/foo/src/index.ts` and reads it as proof; nobody opens it. Two separate outside
// analyses of this repository cited files that do not exist, and every reader
// downstream treated the citations as measurements.
//
// PORTABLE BY CONSTRUCTION. The first version hardcoded `docs/` as the only place
// documents live and a fixed list of source roots — both true here and false almost
// everywhere else, including this owner's other repositories. Now the markdown set
// comes from `git ls-files` (so it follows whatever layout a repo has, and never wanders
// into node_modules), and the source roots are DERIVED from the repo's own top-level
// tracked directories. A repo with `packages/` gets `packages/` for free; this one keeps
// working unchanged.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = resolve(flag("--root") ?? SELF_ROOT);
const AS_JSON = argv.includes("--json");

const git = (args, cwd = ROOT) => {
  try {
    // stderr is silenced deliberately: `remote get-url origin` in a checkout with no
    // remote is an EXPECTED path (the basename fallback), and letting git print
    // "No such remote 'origin'" onto a passing self-test's output teaches readers to
    // ignore error text on a green run.
    return execSync(`git ${args}`, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};
const lines = (s) => (s ? s.trim().split("\n").filter(Boolean) : []);

// Prove the root is a readable git work tree BEFORE any scan. `git()` above swallows
// every failure to "" so the citation reads stay simple — but that makes an unreadable
// checkout (present path, no/broken `.git`, shallow-without-worktree) indistinguishable
// from a real repo with zero markdown docs: both yield an empty `ls-files` and would be
// reported CLEAN. That is the "green over an absent input" inversion the fail-closed
// doctrine exists to stop, and the estate scanner's own header already promises "unrun
// is not green". Throw here so callers surface NOT_SCANNED instead of a vacuous pass.
export function assertGitWorkTree(root) {
  let out;
  try {
    out = execSync("git rev-parse --is-inside-work-tree", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`not a readable git checkout (git rev-parse failed): ${root}`);
  }
  if (out !== "true") throw new Error(`not a git work tree (rev-parse returned "${out}"): ${root}`);
}

/** Top-level tracked directories — the roots a citation may plausibly start with. */
export function deriveRoots(root = ROOT) {
  const tops = new Set();
  for (const f of lines(git("ls-files", root))) {
    const slash = f.indexOf("/");
    if (slash > 0) tops.add(f.slice(0, slash));
  }
  // `src` is added unconditionally: a repo may document a source layout it does not
  // itself contain (a handoff doc for another checkout), and we want those caught or
  // explicitly exempted rather than invisible.
  tops.add("src");
  return [...tops].filter((d) => !d.startsWith(".")).sort();
}

export function buildPattern(roots) {
  const alt = roots.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp("`((?:" + alt + ")\\/[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{1,6})`", "g");
}

// Citations that legitimately name a path this checkout does not contain. Keep SHORT
// and justified — every entry is a hole, and a hole nobody can explain is a hole
// somebody will widen.
export const ALLOW = [
  /\/dist\//, // build output, gitignored
  /\/build\//,
  /\/node_modules\//,
  /\/target\//, // rust build output
  /\.example$/,
  /\bYOUR_/, // placeholder the reader substitutes
  /<[^>]+>/, // placeholder segment: docs/<name>.md
  /\/\.\.\.\//, // elided middle: native/ios/.../Models.swift — shorthand, not a citation
];

// Directories holding PASTED EXTERNAL MATERIAL rather than authored documentation —
// scraped pages, vendor docs, intake dumps. Their citations describe somebody else's
// tree and are not this repository's claims to keep true. `attached_assets/` is the
// Replit paste convention and is where the private core keeps scraped vendor pages.
// This is a skip with a reason, not a silent exclusion: the count is reported.
// `.claude/skills/` is VENDORED third-party work (obra/superpowers, MIT — see
// .claude/skills/VENDORED.md). Its documentation cites illustrative example paths
// — `tests/exact/path/to/test.py`, `scripts/helper.py`, `docs/file1.md` — which are
// placeholders in somebody else's prose, not claims about this tree. The alternative
// was editing the vendored files to satisfy our gate, which would have destroyed the
// one property that makes a vendored copy auditable: that it is byte-identical to
// upstream and can be diffed against it. Skipping is the cheaper honesty.
export const INTAKE_PREFIXES = ["attached_assets/", "vendor/", "third_party/", ".claude/skills/"];

// Documents whose subject IS another repository, keyed by REPOSITORY IDENTITY —
// `owner/repo` read out of `git remote get-url origin`, not the checkout's directory
// name and not the repo name alone. The value names the repo they describe, and it is
// printed so the exemption stays visible rather than silent.
//
// WHY NOT THE DIRECTORY BASENAME, which is what this keyed on until 2026-09-02. A
// checkout's directory name is a local accident: a `git worktree` for a review lands in
// `wt-53/`, a second clone lands in `SignalGrid-Review-Hub-2/`, CI's own checkout could
// be renamed tomorrow. Under the basename key every one of those lost ALL exemptions at
// once and the gate reported 18 broken citations that are not broken. That direction is
// fail-CLOSED, so nothing shipped wrong — but a gate that cannot be run in a review
// worktree is a gate reviewers stop running, and an unrun gate is not a gate.
//
// WHY NOT THE REPO NAME ALONE, which is what the first fix used. `SignalGrid-Review-Hub`
// is a name, not an identity: any repository on any host may carry it. A key that a
// stranger can mint by naming their repo the same thing is a key that hands them this
// repository's exemptions. `owner/repo` is the identity GitHub itself uses.
export const CROSS_REPO = {
  "DanFashauer/SignalGrid-Review-Hub": {
    "docs/PRIVATE_CORE_HANDOFF.md": "the private core repository (not this public surface)",
    "docs/PRODUCT_CORE_FOUNDATION.md": "the private core repository (not this public surface)",
  },
};

// Name-only aliases, consulted ONLY when the remote carries no owner segment at all —
// a clone from a local path (`git clone /home/user/SignalGrid-Review-Hub`, origin
// `/home/user/SignalGrid-Review-Hub`) or no remote whatsoever, where the name is the
// only identity that exists. It exists to keep the case the owner/repo fix must not
// break: a local mirror of this repository, which is a real thing people make.
//
// THE DECISION, written down because the alternative was arguable: a FORK
// (`someone-else/SignalGrid-Review-Hub`) is NOT exempted, and neither is an unrelated
// repository that happens to share the name. Both carry an owner, so neither ever
// reaches this table. The reason is that a fork is a different repository under
// different editorial control — its copy of `docs/PRIVATE_CORE_HANDOFF.md` may have
// been rewritten to point at paths the fork genuinely intends to have, and this gate
// cannot tell that from a fork that left them alone. Fail-closed is the right direction
// there: the fork sees the citations REPORTED and declares its own key if it means to
// keep them. Exempting by name would have been the fail-OPEN direction and would have
// covered the stranger's repo as a side effect of covering the fork.
export const CROSS_REPO_NAME_ALIASES = {
  "SignalGrid-Review-Hub": "DanFashauer/SignalGrid-Review-Hub",
};

/** Pure: every cited path in `text`, minus the allowed ones. Drives gate and self-test. */
export function citationsIn(text, pattern) {
  const out = [];
  for (const m of text.matchAll(pattern)) {
    const p = m[1];
    if (ALLOW.some((re) => re.test(p))) continue;
    out.push(p);
  }
  return out;
}

/** Pure: which citations do not resolve, given an existence oracle. */
export function missingIn(text, exists, pattern) {
  return citationsIn(text, pattern).filter((p) => !exists(p));
}

/**
 * Pure: the identity a remote URL implies, as `{ key, hasOwner }`. Handles the https
 * form (`https://host/owner/repo`), the scp-style ssh form (`git@host:owner/repo`), the
 * `ssh://` form, an optional `.git` suffix and a trailing slash.
 *
 * `hasOwner` is the load-bearing half. A hosted remote yields `owner/repo` and
 * `hasOwner: true` — a full identity. A LOCAL PATH origin (`/home/user/Repo`,
 * `file:///srv/git/Repo`, `../Repo`) has no owner in any meaningful sense: every
 * segment before the last is a filesystem accident of that machine, so the key
 * degrades to the name alone and `hasOwner: false` tells the caller to LABEL it as a
 * basename fallback rather than claim an identity it did not read.
 *
 * Returns undefined for anything it cannot read, so the caller falls back rather than
 * inventing a key.
 */
export function repoKeyFromRemote(url) {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (!trimmed) return undefined;

  // A hosted remote — the only shape that carries an owner. Anything with a scheme that
  // is not `file:`, or the scp-style `user@host:owner/repo`, is hosted.
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(trimmed)?.[1]?.toLowerCase();
  const scp = /^[^/]+@[^/:]+:(.+)$/.exec(trimmed);
  const isLocalPath =
    scheme === "file" || (!scheme && !scp && (trimmed.startsWith("/") || trimmed.startsWith(".") || trimmed.startsWith("~")));

  const segs = (scp ? scp[1] : trimmed.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "")).split("/").filter(Boolean);
  const name = segs[segs.length - 1];
  if (!name) return undefined;

  // For a hosted URL the host is segs[0] when there was a scheme; drop it, then the
  // segment immediately before the name is the owner.
  const path = scheme && !scp ? segs.slice(1) : segs;
  const owner = path.length >= 2 ? path[path.length - 2] : undefined;

  if (isLocalPath || !owner) return { key: name, hasOwner: false };
  return { key: `${owner}/${name}`, hasOwner: true };
}

/**
 * The exemption key for a checkout, and where it came from. A hosted origin remote is
 * the repository's identity (`owner/repo`); a local-path origin and a checkout with no
 * remote at all both degrade to a NAME, and both are LABELLED as a basename fallback so
 * a surprising exemption set can be traced to the key that produced it. Saying "from
 * origin remote" over a key that is only a directory name is the small lie this
 * function exists not to tell.
 *
 * `aliasedFrom` is set when a name-only key was resolved through
 * CROSS_REPO_NAME_ALIASES, so the alias is printed rather than applied invisibly.
 */
export function repoKey(root = ROOT) {
  const fromRemote = repoKeyFromRemote(git("remote get-url origin", root));
  const basename = root.split("/").filter(Boolean).pop();

  if (fromRemote?.hasOwner) return { key: fromRemote.key, source: "origin remote (owner/repo)" };

  const nameOnly = fromRemote?.key ?? basename;
  const source = fromRemote
    ? "basename fallback (origin remote carries no owner — a local-path remote)"
    : "basename fallback (no origin remote)";
  const alias = CROSS_REPO_NAME_ALIASES[nameOnly];
  return alias
    ? { key: alias, source, aliasedFrom: nameOnly }
    : { key: nameOnly, source };
}

/**
 * Pure: how a citation resolves, given the tracked-file set and an existence oracle.
 * Three states, not two — "missing" and "generated" are different defects with
 * different fixes, and collapsing them was the hole described below.
 */
export function classifyCitation(p, docRel, tracked, exists) {
  const asRoot = p;
  const asRel = join(dirname(docRel), p);
  const rootThere = exists(asRoot);
  const relThere = exists(asRel);
  if (!rootThere && !relThere) return { state: "missing" };
  if ((rootThere && tracked.has(asRoot)) || (relThere && tracked.has(asRel))) return { state: "tracked" };
  return { state: "generated", at: rootThere ? asRoot : asRel };
}

export function scanRepo(root) {
  assertGitWorkTree(root);
  const { key: name, source: keySource, aliasedFrom } = repoKey(root);
  const dir = root.split("/").filter(Boolean).pop();
  const roots = deriveRoots(root);
  const pattern = buildPattern(roots);
  const exempt = CROSS_REPO[name] ?? {};
  const docs = lines(git("ls-files -- '*.md' '*.markdown'", root));
  const tracked = new Set(lines(git("ls-files", root)));

  // A citation resolves if EITHER reading of it lands on a real file: from the
  // repository root (the convention for a backticked path in prose) or relative to the
  // citing document (the convention for a markdown link target). Accepting only the
  // first is not a stricter gate, it is a WRONG one — it reported
  // `native/ios/SignalGridMobile/README.md → docs/REPO_ALIGNMENT.md` as broken when that
  // file sits right beside the README, and the "fix" repointed a correct document at one
  // that says nothing about its subject. A gate that manufactures findings is worse than
  // no gate: someone acts on them.
  //
  // RESOLVING IS NOT ENOUGH: it must resolve to a TRACKED file. A citation that lands
  // only on generated, gitignored output passes here and fails on a fresh clone, and
  // the failure is invisible to whoever ran the proof that minted the file. Two
  // documents cited `artifacts/proof/signalgrid-grid-proof.json` — output of
  // `pnpm run proof:signalgrid-grid`, gitignored at .gitignore:55 — and preflight runs
  // this gate at step 111, ~120 steps BEFORE that proof, so a clean clone failed
  // preflight on a citation that reads perfectly on any machine where the proof has
  // ever run. The rule is DERIVED from `git ls-files`, not from a list of generated
  // directories somebody maintains: whatever a repo generates, it is untracked, and
  // untracked is what a fresh clone does not have.
  const exists = (p) => existsSync(join(root, p));

  const missing = [];
  const exempted = [];
  let checked = 0;
  let intakeDocs = 0;
  let generated = 0;

  for (const rel of docs) {
    if (INTAKE_PREFIXES.some((p) => rel.startsWith(p))) {
      intakeDocs += 1;
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const cites = citationsIn(text, pattern);
    checked += cites.length;
    const bad = [];
    for (const p of cites) {
      const c = classifyCitation(p, rel, tracked, exists);
      if (c.state === "tracked") continue;
      if (c.state === "generated") generated += 1;
      bad.push({
        path: p,
        why:
          c.state === "generated"
            ? `resolves ONLY to generated, untracked output (${c.at}) — absent from a fresh clone`
            : "points at nothing",
      });
    }
    if (bad.length === 0) continue;
    if (exempt[rel]) exempted.push({ doc: rel, count: bad.length, reason: exempt[rel] });
    else for (const b of bad) missing.push({ doc: rel, path: b.path, why: b.why });
  }
  return {
    repo: name,
    repoKeySource: keySource,
    repoKeyAliasedFrom: aliasedFrom,
    dir,
    exemptionsDeclared: Object.keys(exempt).length,
    root,
    docs: docs.length,
    intakeDocs,
    roots: roots.length,
    checked,
    generated,
    missing,
    exempted,
  };
}

// This repository's own identity key, named once so the self-test never restates it.
const SELF_KEY = "DanFashauer/SignalGrid-Review-Hub";

function selfTest() {
  const checks = [];
  const pattern = buildPattern(["lib", "scripts", "artifacts", "docs", "vendor_absent"]);
  const none = () => false;
  const all = () => true;

  checks.push([
    "A MISSING CITATION IS CAUGHT — the gate's whole purpose, exercised over real text",
    missingIn("see `lib/ghost/src/index.ts` for detail", none, pattern).length === 1,
  ]);
  checks.push([
    "…and a citation that resolves is NOT reported (the pass is not vacuous)",
    missingIn("see `lib/real/src/index.ts` for detail", all, pattern).length === 0,
  ]);
  checks.push(["multiple citations on one line are each checked", missingIn("`lib/a/x.ts` and `scripts/b/y.mjs`", none, pattern).length === 2]);
  checks.push(["unbackticked prose is NOT a citation", citationsIn("the file lib/foo/src/index.ts is interesting", pattern).length === 0]);
  checks.push(["a path outside the derived roots is NOT a citation", citationsIn("`nowhere/thing/file.ts`", pattern).length === 0]);
  checks.push(["a bare directory is NOT a citation", citationsIn("`lib/signalgrid-core/src/`", pattern).length === 0]);

  // The regression this gate caused before it caught anything. A nested README linked
  // `docs/REPO_ALIGNMENT.md`, which sits beside it; root-only resolution called that
  // broken, and the "fix" repointed a correct document at an unrelated one. Pinned
  // against the real files so it fails if either the resolution or the tree changes.
  const nested = "native/ios/SignalGridMobile/README.md";
  const beside = "docs/REPO_ALIGNMENT.md";
  checks.push([
    "A CITATION RELATIVE TO ITS OWN DOCUMENT RESOLVES — root-only resolution manufactured a false finding here",
    existsSync(join(SELF_ROOT, dirname(nested), beside)) && !existsSync(join(SELF_ROOT, beside)),
  ]);
  checks.push([
    "…and the live scan no longer reports it",
    !scanRepo(SELF_ROOT).missing.some((m) => m.doc === nested && m.path === beside),
  ]);
  checks.push(["the ALLOW list actually allows — a dist path is skipped", citationsIn("`artifacts/api-server/dist/index.mjs`", pattern).length === 0]);
  checks.push(["…and ALLOW is not a blanket pass — a non-dist sibling is still checked", citationsIn("`artifacts/api-server/src/index.ts`", pattern).length === 1]);

  // Portability: the roots must come from the tree, not from a list someone maintains.
  const derived = deriveRoots(SELF_ROOT);
  checks.push(["roots are DERIVED from the tree, and there are plausibly many", derived.length >= 5]);
  checks.push(["…including ones no hardcoded list would have had", derived.includes("lib") && derived.includes("scripts")]);

  checks.push([
    "every cross-repo exemption names the repository it belongs to",
    Object.values(CROSS_REPO).every((docs) => Object.values(docs).every((r) => typeof r === "string" && r.length > 12)),
  ]);
  checks.push([
    "every cross-repo exemption names a document that exists — a stale exemption is a hole",
    Object.entries(CROSS_REPO).every(([repo, docs]) =>
      repo !== SELF_KEY ? true : Object.keys(docs).every((d) => existsSync(join(SELF_ROOT, d))),
    ),
  ]);
  checks.push([
    "every name-only alias points at a declared owner/repo key — an alias to nothing exempts nothing, silently",
    Object.entries(CROSS_REPO_NAME_ALIASES).every(([n, target]) => !n.includes("/") && target.includes("/") && CROSS_REPO[target]),
  ]);

  // ── A citation must resolve to a TRACKED file ────────────────────────────────────
  // The hole this closed: `artifacts/proof/signalgrid-grid-proof.json` is generated by
  // `pnpm run proof:signalgrid-grid` and gitignored, so two documents cited it, this
  // gate passed on every machine where the proof had ever run, and a fresh clone failed
  // preflight ~120 steps before the proof that would have minted it. Both directions.
  const trackedSet = new Set(["docs/real.md", "lib/real/src/index.ts"]);
  const onDisk = new Set([...trackedSet, "artifacts/proof/signalgrid-grid-proof.json"]);
  const diskExists = (p) => onDisk.has(p);
  checks.push([
    "A CITATION RESOLVING ONLY TO GENERATED, UNTRACKED OUTPUT IS A VIOLATION — the fresh-clone defect",
    classifyCitation("artifacts/proof/signalgrid-grid-proof.json", "docs/x.md", trackedSet, diskExists).state === "generated",
  ]);
  checks.push([
    "…and a tracked file is NOT flagged (the rule is not a blanket refusal)",
    classifyCitation("lib/real/src/index.ts", "docs/x.md", trackedSet, diskExists).state === "tracked",
  ]);
  checks.push([
    "…and an absent path is still 'missing', a different defect with a different fix",
    classifyCitation("lib/ghost/src/index.ts", "docs/x.md", trackedSet, diskExists).state === "missing",
  ]);
  checks.push([
    "…and the tracked test follows the document-relative reading too, not just the root one",
    classifyCitation("real/src/index.ts", "lib/README.md", trackedSet, diskExists).state === "tracked",
  ]);
  checks.push([
    "NO DOCUMENT IN THIS TREE CITES A PATH UNDER artifacts/proof/ — the class, not just the two instances",
    (() => {
      const pat = buildPattern(deriveRoots(SELF_ROOT));
      return lines(git("ls-files -- '*.md' '*.markdown'", SELF_ROOT))
        .filter((f) => !INTAKE_PREFIXES.some((p) => f.startsWith(p)))
        .every((f) => !citationsIn(readFileSync(join(SELF_ROOT, f), "utf8"), pat).some((c) => c.startsWith("artifacts/proof/")));
    })(),
  ]);
  checks.push([
    "…and the live scan reports zero generated-output citations right now (the positive control)",
    scanRepo(SELF_ROOT).generated === 0,
  ]);

  // The fail-open this gate shipped with: a present-but-non-git path read as a vacuous
  // "0 citations across 0 docs" pass instead of NOT_SCANNED. Mutation-shaped — a real
  // git checkout must still scan (proven by every other check running against SELF_ROOT),
  // and a non-git one must throw.
  const tmpNonGit = mkdtempSync(join(tmpdir(), "cited-notgit-"));
  writeFileSync(join(tmpNonGit, "README.md"), "see `lib/ghost/src/index.ts` for detail");
  let threwOnNonGit = false;
  try {
    scanRepo(tmpNonGit);
  } catch {
    threwOnNonGit = true;
  } finally {
    rmSync(tmpNonGit, { recursive: true, force: true });
  }
  checks.push([
    "A PRESENT-BUT-NON-GIT PATH IS NOT_SCANNED (throws), never a vacuous 0-docs pass — the fail-open this gate shipped with",
    threwOnNonGit,
  ]);
  checks.push([
    "…and a real git checkout (this repo) still scans without throwing",
    (() => {
      try {
        return scanRepo(SELF_ROOT).docs > 0;
      } catch {
        return false;
      }
    })(),
  ]);

  // ── The exemption key is DERIVED FROM THE REPOSITORY, not from its directory ──
  // Until 2026-09-02 the CROSS_REPO table was keyed on the checkout's directory
  // basename, so a `git worktree` named anything else lost every exemption and the gate
  // reported 18 citations broken that are not. Normalisation first, then the behaviour
  // itself over a real (tiny) git checkout whose directory name is deliberately wrong.
  //
  // …and then keyed on the repo NAME alone until later the same day, which is a
  // different hole in the same wall: any repository anywhere may be named
  // `SignalGrid-Review-Hub`, so the name is a label, not an identity. The key is now
  // `owner/repo`, and a remote with no owner is LABELLED a basename fallback instead of
  // claiming an identity it never read.
  checks.push([
    "the exemption key is owner/repo out of an https remote, .git suffix stripped",
    repoKeyFromRemote("https://github.com/DanFashauer/SignalGrid-Review-Hub.git")?.key === "DanFashauer/SignalGrid-Review-Hub",
  ]);
  checks.push([
    "…and out of the scp-style ssh form",
    repoKeyFromRemote("git@github.com:DanFashauer/SignalGrid-Review-Hub.git")?.key === "DanFashauer/SignalGrid-Review-Hub",
  ]);
  checks.push([
    "…and out of the ssh:// form, with a trailing slash (the host is not mistaken for the owner)",
    repoKeyFromRemote("ssh://git@github.com/DanFashauer/SignalGrid-Review-Hub/")?.key === "DanFashauer/SignalGrid-Review-Hub",
  ]);
  checks.push([
    "A DIFFERENT OWNER IS A DIFFERENT KEY — the whole point of owner/repo",
    repoKeyFromRemote("https://github.com/someone-else/SignalGrid-Review-Hub.git")?.key === "someone-else/SignalGrid-Review-Hub",
  ]);
  checks.push([
    "a LOCAL-PATH origin has no owner: name-only key, hasOwner false (so the caller labels it a fallback)",
    (() => {
      const a = repoKeyFromRemote("/home/user/SignalGrid-Review-Hub");
      const b = repoKeyFromRemote("file:///srv/git/SignalGrid-Review-Hub.git");
      const c = repoKeyFromRemote("../SignalGrid-Review-Hub");
      return [a, b, c].every((k) => k?.key === "SignalGrid-Review-Hub" && k.hasOwner === false);
    })(),
  ]);
  checks.push([
    "…and an unreadable/absent remote yields undefined so the caller can fall back, never a wrong key",
    repoKeyFromRemote("") === undefined && repoKeyFromRemote(undefined) === undefined,
  ]);
  checks.push([
    "this checkout's key is owner/repo from its origin remote, whatever the directory is called",
    (() => {
      const k = repoKey(SELF_ROOT);
      return k.key === SELF_KEY && k.source === "origin remote (owner/repo)";
    })(),
  ]);

  // A scratch checkout in a DIFFERENTLY NAMED directory, carrying one of the exempted
  // documents. With the review-hub origin it must stay exempt; with no remote at all it
  // must fall back to the basename and — correctly — lose the exemption. Both directions,
  // so this proves a live behaviour rather than the absence of one.
  const exemptDoc = Object.keys(CROSS_REPO[SELF_KEY])[0];
  const tmpNamed = mkdtempSync(join(tmpdir(), "not-the-review-hub-"));
  const scans = {};
  try {
    const g = (a) => execSync(`git ${a}`, { cwd: tmpNamed, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    g("init -q");
    mkdirSync(join(tmpNamed, dirname(exemptDoc)), { recursive: true });
    writeFileSync(join(tmpNamed, exemptDoc), "it lives at `src/auth.ts` over there\n");
    g(`add -A -- ${JSON.stringify(exemptDoc)}`);
    scans.noRemote = scanRepo(tmpNamed);
    g("remote add origin https://github.com/DanFashauer/SignalGrid-Review-Hub.git");
    scans.ours = scanRepo(tmpNamed);
    g("remote set-url origin https://github.com/someone-else/SignalGrid-Review-Hub.git");
    scans.stranger = scanRepo(tmpNamed);
    g("remote set-url origin /srv/mirrors/SignalGrid-Review-Hub");
    scans.localPath = scanRepo(tmpNamed);
  } catch {
    // leave the map empty — the checks below then fail, which is the fail-closed direction
  } finally {
    rmSync(tmpNamed, { recursive: true, force: true });
  }
  checks.push([
    "A DIFFERENTLY-NAMED CHECKOUT KEEPS ITS EXEMPTIONS — keyed on the origin remote, not the directory",
    !!scans.ours && scans.ours.repo === SELF_KEY && scans.ours.missing.length === 0 && scans.ours.exempted.length === 1,
  ]);
  checks.push([
    "…and the same directory with NO remote falls back to its basename and loses them (the exemption is real, not blanket)",
    !!scans.noRemote && scans.noRemote.repoKeySource.startsWith("basename fallback") && scans.noRemote.missing.length === 1,
  ]);
  checks.push([
    "AN UNRELATED REPO OF THE SAME NAME UNDER ANOTHER OWNER IS NOT EXEMPTED — a name is not an identity",
    !!scans.stranger &&
      scans.stranger.repo === "someone-else/SignalGrid-Review-Hub" &&
      scans.stranger.exempted.length === 0 &&
      scans.stranger.missing.length === 1,
  ]);
  checks.push([
    "…and a LOCAL-PATH origin is labelled a basename fallback (never 'origin remote') and resolves through the name-only alias",
    !!scans.localPath &&
      scans.localPath.repoKeySource.startsWith("basename fallback (origin remote carries no owner") &&
      scans.localPath.repoKeyAliasedFrom === "SignalGrid-Review-Hub" &&
      scans.localPath.repo === SELF_KEY &&
      scans.localPath.exempted.length === 1 &&
      scans.localPath.missing.length === 0,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Guarded on being the entry point: `scan-estate-citations.mjs` imports `scanRepo` from
// here, and a module that gates its own repository as a side effect of being imported
// makes every consumer's exit code a lie about the wrong tree.
const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isEntry) {
  // exported API only
} else if (argv.includes("--self-test")) {
  process.exit(selfTest());
} else {
  runCli();
}

function runCli() {
let r;
try {
  r = scanRepo(ROOT);
} catch (err) {
  // NOT SCANNED is not a pass. Exit 2 keeps it distinct from 1 (broken citation) and 0
  // (clean), matching the check:absence convention — a caller can tell "the target could
  // not be read" from "the target is clean" from "the target has a hole".
  console.error(`Cited-path check NOT SCANNED for ${ROOT}: ${err.message}`);
  console.error("An unreadable target cannot be scanned, and an unscanned target is never");
  console.error("a pass. Point --root at a git work tree, or clone the checkout first.");
  process.exit(2);
}

if (AS_JSON) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.missing.length > 0 ? 1 : 0);
}

// Which key matched, always, and where it came from. An exemption table keyed on
// something invisible is an exemption table nobody can debug.
console.log(
  `Exemption key: ${r.repo} (from ${r.repoKeySource}; checkout directory "${r.dir}")` +
    (r.repoKeyAliasedFrom ? ` [name-only alias: "${r.repoKeyAliasedFrom}" → ${r.repo}]` : "") +
    ` — ${r.exemptionsDeclared} declared cross-repo exemption(s).`,
);
if (r.exemptionsDeclared === 0 && Object.keys(CROSS_REPO).length > 0) {
  console.log(`  (CROSS_REPO declares keys: ${Object.keys(CROSS_REPO).join(", ")} — none matched.)`);
}

if (r.exempted.length > 0) {
  console.log("Cross-repo citations, exempted by declaration (not silently):");
  for (const e of r.exempted) console.log(`  · ${e.doc} — ${e.count} path(s) describing ${e.reason}`);
  console.log("");
}

if (r.missing.length > 0) {
  console.error(`Cited-path check FAILED for ${r.repo}: ${r.missing.length} citation(s) do not resolve to a tracked file.\n`);
  for (const { doc, path, why } of r.missing.slice(0, 60)) console.error(`  ✗ ${doc}  →  ${path}  (${why})`);
  if (r.missing.length > 60) console.error(`    … and ${r.missing.length - 60} more`);
  console.error("\nA citation that points nowhere reads as evidence and is not.");
  console.error("A citation that resolves only to GENERATED, UNTRACKED output is the same");
  console.error("defect wearing a green: it reads fine on the machine that ran the producer");
  console.error("and fails on a fresh clone. Name the producing command in prose instead of");
  console.error("citing its output path.");
  console.error("Fix the path, remove the citation, or — if the document is about another");
  console.error("repository — declare it in CROSS_REPO with the repo it belongs to.");
  process.exit(1);
}
console.log(
  `Cited-path check passed — ${r.checked} citation(s) across ${r.docs} docs in ${r.repo} ` +
    `all resolve to TRACKED files (a fresh clone resolves them too).`,
);
}
