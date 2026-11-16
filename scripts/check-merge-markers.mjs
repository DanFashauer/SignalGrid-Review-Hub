#!/usr/bin/env node
// No tracked file may contain an unresolved merge-conflict marker.
//
//   node scripts/check-merge-markers.mjs
//
// WHY THIS EXISTS, and it is not hypothetical. `Dockerfile.web` reached
// SignalGrid_Alpha carrying `<<<<<<< Updated upstream` / `=======` /
// `>>>>>>> Stashed changes` — the residue of a `git stash pop` that conflicted and
// was committed unresolved. Those lines are not valid Dockerfile syntax, so the web
// image could not build at all, and the next person to run `podman build` would have
// blamed podman rather than the file.
//
// CI did fail on it — both container jobs went red — which is the system working.
// But a container job is an EXPENSIVE and INDIRECT detector: it needs a runner, a
// registry pull and a multi-stage build to tell you something a substring match
// finds in milliseconds, and it only speaks for files a build actually reads. A
// conflict marker committed into a doc, a fixture, a policy JSON or a Swift source
// produces no build failure at all and simply sits there.
//
// This is the same family as the text-safety gate next door: a file that does not
// say what it appears to say. That one catches text engineered to deceive; this one
// catches text nobody meant to ship. The second is far more common.
//
// WHAT COUNTS. Only markers at the START of a line, which is where git writes them,
// and only the three that git actually emits. Prose about conflict markers — this
// header, the docs that explain the convention — is not a finding, because those
// mention the markers rather than beginning a line with one.
//
// The `=======` separator is deliberately NOT matched on its own. Markdown setext
// headings and ASCII rules use runs of `=` at the start of a line all over these
// docs, and flagging them would make the gate noise that people learn to skip. A
// conflict always brings a `<<<<<<<` or `>>>>>>>` with it, so the pair is enough.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Built from character codes so this file never contains a literal marker at the
// start of a line — otherwise the gate's own source would fail it, and the usual
// fix for that (an exemption for this path) is how a gate stops covering itself.
const LT = "<".repeat(7);
const GT = ">".repeat(7);
const MARKERS = [
  { prefix: LT, what: "conflict start (ours)" },
  { prefix: GT, what: "conflict end (theirs)" },
];

/** Scan one blob. The self-test drives THIS function, not a copy of it. */
function scanText(path, text) {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of MARKERS) {
      // Start-of-line only, and followed by a space or end-of-line — git always
      // writes `<<<<<<< label`. This keeps a line of seven `<` in ASCII art out.
      if (!lines[i].startsWith(m.prefix)) continue;
      const after = lines[i].slice(m.prefix.length);
      if (after !== "" && !after.startsWith(" ")) continue;
      findings.push({ path, line: i + 1, what: m.what, text: lines[i].slice(0, 60) });
    }
  }
  return findings;
}

// ── Self-test: prove the detector detects before believing its silence ────────
//
// Specimens are stated here rather than derived from MARKERS, for the reason the
// text-safety gate learned the hard way: a control that reads its expectations out
// of the thing under test moves in lockstep with it and cannot register a
// regression. These are the exact three lines `git stash pop` and `git merge` write.
{
  const conflicted = [
    `${LT} Updated upstream`,
    "FROM node:22",
    "=".repeat(7),
    "FROM node:20",
    `${GT} Stashed changes`,
  ].join("\n");
  const hits = scanText("<self-test>", conflicted);
  // Clean text that LOOKS dangerous: a setext heading, an ASCII rule, and prose
  // naming the markers. None may fire, or the gate becomes noise people skip.
  const clean = [
    "Heading",
    "=".repeat(20),
    "-".repeat(40),
    `A conflict writes ${LT} and ${GT} into the file.`,
  ].join("\n");
  const noise = scanText("<self-test>", clean);
  if (hits.length !== 2 || noise.length !== 0) {
    console.error("✗ merge-marker self-test FAILED — the scanner is not scanning.\n");
    console.error(`    planted a conflict, detected ${hits.length}/2 markers`);
    for (const n of noise) console.error(`    false positive: ${n.path}:${n.line} ${n.text}`);
    console.error(
      "\n  Refusing to report on the repository. A detector that cannot flag a planted\n" +
        "  conflict prints the same green over a real one.",
    );
    process.exit(1);
  }
}

let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch (err) {
  console.error(`✗ could not list tracked files: ${err.message}`);
  console.error("  A read failure is not a clean repository. Refusing to report a pass.");
  process.exit(1);
}
if (tracked.length === 0) {
  console.error("✗ git reported ZERO tracked files — refusing to call that a clean scan.");
  process.exit(1);
}

console.log("Merge markers — no tracked file may carry an unresolved conflict\n");

const findings = [];
let scanned = 0;
let binary = 0;
// A tracked file this gate could not read is a file whose contents nobody checked.
// The bare `catch { continue; }` that used to be here dropped it from every count —
// so `tracked files: 2327 / scanned as text: 2100` reconciled to nothing and the gate
// still said "no unresolved conflict in ANY tracked file", which it had not looked at.
// The two cases are not the same and are now separated:
//   ENOENT   the path is tracked but not in the working tree (mid-rebase, deleted and
//            unstaged). There is no content, so it cannot carry a marker: REPORTED.
//   EISDIR   the path is not a regular file — `scripts/mobile-app-catalog/fixtures/evil/
//   ELOOP    app-dirlink` is a tracked symlink pointing at a DIRECTORY, on purpose, and
//            the mobile-app-catalog proof asserts the catalog refuses it. It has no
//            file content to carry a marker either: REPORTED. Failing here would be
//            this gate flagging a fixture that is exactly right, which is how a gate
//            earns being switched off.
//   anything the file is there, is a file, and could not be read. "It is clean" is
//   else     then a claim with nothing behind it: FATAL.
const absent = [];
const notRegularFiles = [];
const unreadable = [];
for (const rel of tracked) {
  let buf;
  try {
    buf = readFileSync(join(repoRoot, rel));
  } catch (err) {
    const code = (err && err.code) || "unknown error";
    if (code === "ENOENT") absent.push(rel);
    else if (code === "EISDIR" || code === "ELOOP") notRegularFiles.push(`${rel} (${code})`);
    else unreadable.push(`${rel} (${code})`);
    continue;
  }
  if (buf.includes(0x00)) {
    binary += 1;
    continue;
  }
  scanned += 1;
  findings.push(...scanText(rel, buf.toString("utf8")));
}

console.log(`  tracked files:     ${tracked.length}`);
console.log(`  scanned as text:   ${scanned}`);
console.log(`  skipped as binary: ${binary}`);
console.log(`  absent from tree:  ${absent.length}${absent.length ? ` (${absent.slice(0, 5).join(", ")}${absent.length > 5 ? ", …" : ""})` : ""}`);
console.log(`  not a regular file:${notRegularFiles.length}${notRegularFiles.length ? ` (${notRegularFiles.join(", ")})` : ""}`);
console.log(`  UNREADABLE:        ${unreadable.length}`);

// The counts must ACCOUNT for every tracked path. If they do not, a file went
// somewhere this gate cannot name, and an unexplained gap is the shape of the defect
// this reconciliation exists to expose.
const accounted = scanned + binary + absent.length + notRegularFiles.length + unreadable.length;
if (accounted !== tracked.length) {
  console.error(
    `\n✗ accounting gap: ${accounted} of ${tracked.length} tracked files are accounted for. ` +
      `${tracked.length - accounted} file(s) fell out of the sweep without being classified.`,
  );
  process.exit(1);
}

if (unreadable.length > 0) {
  console.error(`\n✗ ${unreadable.length} tracked file(s) present but UNREADABLE:\n`);
  for (const u of unreadable) console.error(`    ${u}`);
  console.error(
    "\n  A file that could not be read has not been checked, and reporting a clean sweep\n" +
      "  over it would be reporting on something nobody looked at.",
  );
  process.exit(1);
}

if (scanned === 0) {
  console.error("\n✗ zero files scanned as text — that is a failure, not a pass.");
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`\n✗ ${findings.length} unresolved conflict marker(s):\n`);
  for (const f of findings) console.error(`    ${f.path}:${f.line}  ${f.what}\n        ${f.text}`);
  console.error(
    "\n  A file in this state is not what it appears to be, and in a Dockerfile, a\n" +
      "  policy JSON or a source file it is not even parseable. Resolve the conflict\n" +
      "  and commit the resolution.",
  );
  process.exit(1);
}

console.log("\nMerge-marker gate passed — no unresolved conflict in any tracked file.");
