// check-repo-links.mjs — a link into this repository must point at a ref that
// exists and a path that exists at it.
//
//   node scripts/check-repo-links.mjs              # gate
//   node scripts/check-repo-links.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. On 2026-09-05 the shipping site (signalgrid.app, built from
// artifacts/signalgrid-web) linked thirteen evidence URLs — both hero CTAs, the
// API reference, Security, the launch plan, "what ships today", both Federal
// CTAs, both SmartDock links — to `github.com/…/blob/main/…` and
// `…/tree/main/…`. There is no `main` branch; the default branch is
// SignalGrid_Alpha. Every one of the thirteen returned 404, live, on the page
// whose whole argument is "every claim traces to a proof you can open". The
// pitch deck, the fabric console and the generated evidence-coverage page
// carried the same ref. `check-cited-paths.mjs` resolves REPO-RELATIVE paths in
// backticks and has no concept of a ref segment, so this sat outside every gate.
//
// WHAT IT HOLDS, offline, no network:
//   1. the ref in every blob/tree/raw/commits link is the DEFAULT BRANCH. The
//      expected name is pinned below; when this clone carries
//      refs/remotes/origin/HEAD the pin is checked against it, so a rename of
//      the default branch fails here instead of 404ing on the site.
//   2. for blob/raw links the path is a TRACKED file at HEAD; for tree links it
//      is a tracked file or a directory holding tracked files. Untracked or
//      generated output does not count — a fresh clone must resolve the link.
//   3. the scan read something: a zero-link run is a broken walker, not a pass.
//
// WHAT IT DOES NOT HOLD, said plainly: whether the path exists on the REMOTE at
// this moment (it holds HEAD, which is what will be on the remote once this
// commit lands), and links into OTHER repositories (skipped — owner/repo must
// match this one).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_REPO = "DanFashauer/SignalGrid-Review-Hub";
/** The default branch. Checked against origin/HEAD when that symref is present. */
export const DEFAULT_BRANCH = "SignalGrid_Alpha";

// Two spellings of the same link: the literal URL, and the SPA's template form
// `${REPO}/blob/<ref>/…` where REPO is the repository URL constant (Footer.tsx,
// Hardware.tsx). The first version of this gate matched only the literal and
// would have missed seven of the thirteen dead links it was written for.
const LINK = new RegExp(
  // A path ends at whitespace, a quote, a bracket, an anchor, a query, a
  // backtick, or a Markdown table's `|` cell delimiter (the inspiration
  // catalogues link from inside tables).
  String.raw`(?:github\.com/` + OWNER_REPO.replace("/", "\\/") + String.raw`|\$\{[A-Za-z_]+\})/(blob|tree|raw|commits)/([A-Za-z0-9_.\-]+)(?:/([^\s"'<>)\]#?|\\` + "`" + String.raw`]+))?`,
  "g",
);

/** Files worth scanning: buyer-facing sources, docs, pages, builders, the README. */
// git's `:(glob)` pathspec has NO brace expansion — the first version of this
// list wrote `*.{ts,tsx,html}` and scanned zero SPA files while reporting a
// pass over the four links it could see. One suffix per pattern.
const SCAN_GLOBS = [
  "artifacts/*/src/**/*.ts",
  "artifacts/*/src/**/*.tsx",
  "artifacts/*/src/**/*.html",
  "artifacts/*/index.html",
  "site/**/*.html",
  "docs/**/*.md",
  "docs/**/*.html",
  "scripts/*.mjs",
  "README.md",
];

function git(args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function trackedFiles() {
  const out = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  if (out.length === 0) throw new Error("git ls-files returned nothing — refusing to judge links against an empty index");
  return out;
}

/** Every repo link in `text`: { kind, ref, path, line }. */
export function linksIn(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(LINK)) {
      out.push({ kind: m[1], ref: m[2], path: m[3] ? m[3].replace(/\/+$/, "") : "", line: i + 1 });
    }
  }
  return out;
}

/** Judge one link against the tracked set. Returns a problem string or null. */
export function judgeLink(link, tracked, defaultBranch = DEFAULT_BRANCH) {
  if (link.ref !== defaultBranch) {
    return `ref "${link.ref}" is not the default branch "${defaultBranch}" — the link 404s (there is no such branch)`;
  }
  if (link.kind === "commits") return null; // a commit listing needs only the ref
  if (!link.path) return link.kind === "tree" ? null : `${link.kind} link names no path`;
  const isFile = tracked.includes(link.path);
  if (link.kind === "blob" || link.kind === "raw") {
    return isFile ? null : `path "${link.path}" is not a tracked file at HEAD — a fresh clone cannot resolve it`;
  }
  const isDir = tracked.some((t) => t.startsWith(link.path + "/"));
  return isFile || isDir ? null : `path "${link.path}" is neither a tracked file nor a directory holding tracked files`;
}

/** This file's own path — its self-test carries deliberately dead links as fixtures. */
const SELF = "scripts/check-repo-links.mjs";

function scanFiles() {
  const patterns = SCAN_GLOBS.map((g) => `:(glob)${g}`);
  // The gate never judges its own fixtures. The first tracked run flagged six
  // links in this file — every one a self-test control that MUST be dead.
  return git(["ls-files", "-z", "--", ...patterns]).split("\0").filter(Boolean).filter((f) => f !== SELF);
}

function selfTest() {
  const checks = [];
  const tracked = ["docs/PARTNER_ONBOARDING.md", "docs/INDEX.md", "lib/api-spec/v1-openapi.yaml"];
  const t = (name, ok) => checks.push([name, ok]);
  const one = (s) => linksIn(s)[0];
  t("a blob link on the default branch to a tracked file passes", judgeLink(one("see https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/SignalGrid_Alpha/docs/PARTNER_ONBOARDING.md now"), tracked) === null);
  t("the real defect — blob/main — is caught by ref", /not the default branch/.test(judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/main/docs/PARTNER_ONBOARDING.md"), tracked) ?? ""));
  t("tree/main is caught by ref", /not the default branch/.test(judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/main/docs"), tracked) ?? ""));
  t("a tree link to a directory holding tracked files passes", judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/SignalGrid_Alpha/docs"), tracked) === null);
  t("a tree link with no path (the repo root) passes", judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/SignalGrid_Alpha"), tracked) === null);
  t("a blob link to a path that is not tracked is caught", /not a tracked file/.test(judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/SignalGrid_Alpha/docs/NOPE.md"), tracked) ?? ""));
  t("a tree link to an empty directory is caught", /neither a tracked file/.test(judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/SignalGrid_Alpha/docs/empty"), tracked) ?? ""));
  t("a commits link on the default branch passes", judgeLink(one("https://github.com/DanFashauer/SignalGrid-Review-Hub/commits/SignalGrid_Alpha"), tracked) === null);
  t("a link's trailing quote, bracket or anchor is not part of the path", one(`<a href="https://github.com/DanFashauer/SignalGrid-Review-Hub/blob/SignalGrid_Alpha/docs/INDEX.md#top">`).path === "docs/INDEX.md");
  t("a link into ANOTHER repository is not scanned", linksIn("https://github.com/someone/else/blob/main/README.md").length === 0);
  t("the SPA's template form `${REPO}/blob/main/…` is scanned and caught", /not the default branch/.test(judgeLink(one("href: `${REPO}/blob/main/SECURITY.md`"), tracked) ?? ""));
  t("the template form on the default branch resolves its path (backtick is not part of it)", one("const DOCS = `${REPO}/tree/SignalGrid_Alpha/docs`;").path === "docs");
  t("a Markdown table cell delimiter is not part of the path", one("| https://github.com/DanFashauer/SignalGrid-Review-Hub/tree/SignalGrid_Alpha/docs|Do |").path === "docs");
  t("the line number is the link's own line", one("x\ny\nhttps://github.com/DanFashauer/SignalGrid-Review-Hub/tree/SignalGrid_Alpha/docs").line === 3);
  // The pin must agree with the clone's own knowledge of the default branch when it has any.
  let symref = "";
  try { symref = git(["symbolic-ref", "refs/remotes/origin/HEAD"]); } catch { /* absent in a shallow clone */ }
  t(`the pinned default branch agrees with origin/HEAD (${symref || "symref absent here — not checkable"})`, symref === "" || symref === `refs/remotes/origin/${DEFAULT_BRANCH}`);
  t(`the real scan set is non-empty (${scanFiles().length} files)`, scanFiles().length > 50);
  t("the gate does not scan its own self-test fixtures", !scanFiles().includes(SELF));
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

let symref = "";
try { symref = git(["symbolic-ref", "refs/remotes/origin/HEAD"]); } catch { /* shallow clone */ }
if (symref && symref !== `refs/remotes/origin/${DEFAULT_BRANCH}`) {
  console.error(`✗ this clone says the default branch is ${symref.replace("refs/remotes/origin/", "")}, but DEFAULT_BRANCH here is pinned to ${DEFAULT_BRANCH}. Fix the pin — every link is being judged against the wrong name.`);
  process.exit(1);
}

const tracked = trackedFiles();
const files = scanFiles();
if (files.length === 0) {
  console.error("✗ the scan set is empty — the walker is broken, not the links.");
  process.exit(1);
}
const problems = [];
let total = 0;
const perFile = new Map();
for (const rel of files) {
  const text = readFileSync(resolve(repo, rel), "utf8");
  const links = linksIn(text);
  if (links.length === 0) continue;
  total += links.length;
  perFile.set(rel, links.length);
  for (const l of links) {
    const p = judgeLink(l, tracked);
    if (p) problems.push(`${rel}:${l.line}: ${l.kind}/${l.ref}/${l.path} — ${p}`);
  }
}
if (total === 0) {
  console.error("✗ zero repository links found across the scan set — either every link was removed or the pattern no longer matches; refusing to pass on nothing.");
  process.exit(1);
}
console.log(`repo links: ${total} link(s) into ${OWNER_REPO} across ${perFile.size} file(s); default branch ${DEFAULT_BRANCH}${symref ? " (confirmed by origin/HEAD)" : " (origin/HEAD absent in this clone — pin unconfirmed, judged by name)"}`);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} dead or mis-referenced link(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error("\n  A link into this repository must name the default branch and a path that is tracked at HEAD.");
  process.exit(1);
}
console.log("Repo-link gate passed — every blob/tree/raw/commits link names the default branch and a tracked path.");
