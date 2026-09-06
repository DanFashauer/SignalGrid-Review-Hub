#!/usr/bin/env node
// Markdown links — a relative link target must resolve DOCUMENT-RELATIVE to a
// tracked file, because that is the only reading a browser performs.
//
// WHY THIS IS NOT check-cited-paths. That gate reads backticked repo-root paths
// in prose and accepts either of two readings (root-relative or document-relative),
// which is right for prose and wrong for a link: GitHub follows `](FOO.md)` from
// the document's own directory and nowhere else. When 41 strategy documents moved
// from `docs/` to `docs/research/` on 2026-08-10, every `](FOO.md)` inside them
// kept pointing at a sibling that was no longer there — twelve dead links in that
// directory, thirty-five across the tree, invisible to every gate for four weeks
// (tenth-round docs audit, 2026-09-06). Each was a 404 for a reader clicking in
// the rendered view.
//
// SCOPE, deliberately: `](target)` where target is not a URL, an anchor or a
// mailto. Inline code spans and fenced code are skipped — a regex or an example
// path inside backticks is not a link. A declared SNAPSHOT (a README written for
// another location, whose links are correct THERE) is reported by name with its
// reason, never silently skipped.
//
//   node scripts/check-markdown-links.mjs [--self-test]

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_PREFIXES = ["attached_assets/", "vendor/", "third_party/", ".claude/skills/"];

/** Documents whose links are written for a DIFFERENT location, with the reason. Reported, not silent. */
export const SNAPSHOTS = {
  "docs/consolidation/HOME_REPO_README.md":
    "a draft README that Phase 6 copies to the home repository's ROOT (`cp … README.md`); its links resolve from there, not from docs/consolidation/",
};

const LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/** Pure: every relative link target in `text`, with its line, skipping code spans and fences. */
export function linksIn(text) {
  const out = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    for (const m of line.matchAll(LINK)) {
      const before = line.slice(0, m.index);
      if ((before.match(/`/g) ?? []).length % 2 === 1) continue; // inside an inline code span
      let t = m[1];
      if (/^([a-z][a-z0-9+.-]*:|#)/i.test(t)) continue; // URL scheme, mailto:, tel:, anchor
      t = t.replace(/[#?].*$/, "");
      if (!t) continue;
      out.push({ target: t, line: i + 1 });
    }
  });
  return out;
}

/** Pure: does `target`, read from `doc`, land on a tracked file or a directory holding one? */
export function resolvesFrom(doc, target, tracked) {
  const rel = normalize(join(dirname(doc), target)).replace(/\/$/, "");
  if (rel.startsWith("..")) return false;
  if (tracked.has(rel)) return true;
  const prefix = `${rel}/`;
  for (const f of tracked) if (f.startsWith(prefix)) return true;
  return false;
}

/** Pure audit. docs: { [rel]: text }; tracked: Set of tracked paths. */
export function auditLinks(docs, tracked, snapshots = SNAPSHOTS) {
  const fatal = [];
  const snapshot = [];
  let checked = 0;
  for (const [doc, text] of Object.entries(docs)) {
    for (const { target, line } of linksIn(text)) {
      checked += 1;
      if (resolvesFrom(doc, target, tracked)) continue;
      if (snapshots[doc]) {
        snapshot.push({ doc, line, target, reason: snapshots[doc] });
        continue;
      }
      fatal.push(`${doc}:${line} links to \`${target}\`, which does not resolve from that document's directory to a tracked file — a 404 in the rendered view`);
    }
  }
  return { fatal, snapshot, checked };
}

function loadDocs() {
  const out = {};
  const files = execSync("git ls-files -- '*.md'", { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
  for (const rel of files) {
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    try {
      out[rel] = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      out[rel] = "";
    }
  }
  return out;
}

function trackedSet() {
  return new Set(execSync("git ls-files", { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean));
}

function selfTest() {
  const checks = [];
  const tracked = new Set(["docs/A.md", "docs/research/B.md", "LICENSE", "docs/img/x.png", "lib/pkg/src/index.ts"]);
  let r = auditLinks({ "docs/research/B.md": "see [A](../A.md) and [lic](../../LICENSE) and [img](../img/x.png)" }, tracked);
  checks.push(["document-relative links that land on tracked files pass (positive control)", r.fatal.length === 0 && r.checked === 3]);
  r = auditLinks({ "docs/research/B.md": "see [A](A.md)" }, tracked);
  checks.push(["THE PLANTED MISS: a sibling link that is only true from the old directory is FATAL — the relocation fossil", r.fatal.length === 1 && r.fatal[0].includes("docs/research/B.md:1")]);
  r = auditLinks({ "docs/research/B.md": "see [A](./../A.md#section) and [q](../A.md?x=1)" }, tracked);
  checks.push(["anchors and query strings are stripped before resolution", r.fatal.length === 0]);
  r = auditLinks({ "docs/A.md": "[site](https://example.com) [mail](mailto:x@y.z) [top](#top) [tel](tel:123)" }, tracked);
  checks.push(["URLs, mailto, tel and anchors are not relative links", r.checked === 0]);
  r = auditLinks({ "docs/A.md": "the regex `\\]\\((FOO.md)\\)` and\n```\n[x](GHOST.md)\n```\n" }, tracked);
  checks.push(["a link shape inside an inline code span or a fence is not a link", r.checked === 0]);
  r = auditLinks({ "docs/A.md": "[dir](../lib/pkg)" }, tracked);
  checks.push(["a link to a directory holding tracked files resolves", r.fatal.length === 0]);
  r = auditLinks({ "docs/A.md": "[up](../../outside.md)" }, tracked);
  checks.push(["a link climbing above the repository root does not resolve", r.fatal.length === 1]);
  r = auditLinks({ "docs/consolidation/HOME_REPO_README.md": "[a](docs/A.md)" }, tracked);
  checks.push(["a declared SNAPSHOT is reported with its reason, not failed — and not silent", r.fatal.length === 0 && r.snapshot.length === 1 && r.snapshot[0].reason.length > 20]);
  r = auditLinks({ "docs/consolidation/HOME_REPO_README.md": "[a](docs/A.md)" }, tracked, {});
  checks.push(["…and without the declaration the same link is FATAL (the exemption is real, not blanket)", r.fatal.length === 1]);
  const live = auditLinks(loadDocs(), trackedSet());
  checks.push(["LIVE: the tree holds hundreds of relative links and every one resolves (or is a declared snapshot)", live.checked >= 400 && live.fatal.length === 0]);
  checks.push(["…and every declared snapshot still exists and still has links that only resolve elsewhere (a stale exemption is a hole)",
    Object.keys(SNAPSHOTS).every((d) => trackedSet().has(d)) && live.snapshot.length >= 1]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const docs = loadDocs();
  const r = auditLinks(docs, trackedSet());
  console.log(`Markdown links — ${r.checked} relative link(s) across ${Object.keys(docs).length} tracked document(s), each resolved from its own directory.`);
  if (r.snapshot.length > 0) {
    console.log(`  REPORTED — ${r.snapshot.length} link(s) in declared snapshot document(s), correct at their destination and not here:`);
    for (const s of r.snapshot) console.log(`    · ${s.doc}:${s.line} → ${s.target}`);
    for (const d of new Set(r.snapshot.map((s) => s.doc))) console.log(`    ${d}: ${SNAPSHOTS[d]}`);
  }
  if (r.fatal.length > 0) {
    console.error(`\nMarkdown-link check FAILED: ${r.fatal.length} problem(s).`);
    for (const f of r.fatal) console.error(`  ✗ ${f}`);
    console.error("\nA link follows the document's own directory and nowhere else. Fix the target (../ for a\nrelocated sibling), or declare a snapshot document in SNAPSHOTS with the reason.");
    process.exit(1);
  }
  console.log("Markdown-link check passed — every relative link lands on a tracked file from its own document.");
}
