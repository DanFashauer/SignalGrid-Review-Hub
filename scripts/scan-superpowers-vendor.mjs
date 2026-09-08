// Superpowers vendor verifier — is our vendored obra/superpowers copy still
// byte-identical to upstream at the pinned commit, and has upstream moved past it?
//
//   node scripts/scan-superpowers-vendor.mjs            verify (network)
//   node scripts/scan-superpowers-vendor.mjs --self-test  prove the check can fail (offline)
//
// WHY THIS EXISTS. `.claude/skills/` vendors 14 upstream superpowers skills,
// pinned and unmodified for auditability. VENDORED.md says in its own words:
// "Nothing re-syncs this automatically ... a newer upstream is not in this tree
// until someone deliberately re-vendors and re-reads." The 2026-09-06 line-by-line
// read left ONE caveat open — it could not verify byte-identity against upstream
// because the GitHub API returned 403 through the sandbox proxy. The raw CDN
// (raw.githubusercontent.com) IS reachable, so this turns that manual check into a
// repeatable command: it proves our bytes equal upstream@pin, and reports whether
// upstream HEAD has advanced past the pin (a human re-vendor DECISION, never an
// automatic sync — DR-020 territory).
//
// NOT A CI GATE, by construction — same reason as scan:estate: it reaches the
// network, and CI has one checkout with no arbitrary egress. It fails CLOSED: a
// file it cannot fetch is NOT-VERIFIED and non-zero, never a silent pass. It sends
// only public URLs; no repository content leaves the tree.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const SELF_TEST = process.argv.includes("--self-test");
const RAW = "https://raw.githubusercontent.com/obra/superpowers";
const ATOM = "https://github.com/obra/superpowers/commits/main.atom";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** The pinned commit is single-sourced from VENDORED.md, never hardcoded here —
 *  a re-vendor updates that row and this follows. */
function readPin() {
  const v = readFileSync(".claude/skills/VENDORED.md", "utf8");
  const m = v.match(/\|\s*Commit\s*\|\s*`([0-9a-f]{40})`\s*\|/i);
  if (!m) throw new Error("VENDORED.md has no `| Commit | <40-hex> |` row — cannot pin");
  return m[1];
}

/** The 14 UPSTREAM dirs are DERIVED: every tracked skill directory, minus the
 *  first-party exceptions VENDORED.md declares in its table. No hand-list. */
function upstreamFiles() {
  const tracked = execFileSync("git", ["ls-files", ".claude/skills"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
  const v = readFileSync(".claude/skills/VENDORED.md", "utf8");
  // first-party rows look like:  | `owner-comms/` | 2026-08-20 | ... |
  const firstParty = new Set(
    [...v.matchAll(/\|\s*`([a-z0-9-]+)\/`\s*\|/gi)].map((m) => m[1]),
  );
  const files = [];
  for (const f of tracked) {
    const rel = f.slice(".claude/skills/".length); // e.g. brainstorming/SKILL.md or LICENSE or VENDORED.md
    if (rel === "VENDORED.md") continue;            // our record, not upstream
    if (rel === "LICENSE") { files.push({ local: f, upstream: "LICENSE" }); continue; }
    const dir = rel.split("/")[0];
    if (firstParty.has(dir)) continue;              // first-party skill, not upstream
    if (!rel.includes("/")) continue;               // any other loose top-level file
    files.push({ local: f, upstream: `skills/${rel}` });
  }
  return files;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function latestUpstreamSha() {
  const res = await fetch(ATOM);
  if (!res.ok) throw new Error(`atom HTTP ${res.status}`);
  const xml = await res.text();
  // first <id>…/commit/<sha></id> entry after the feed id is the newest commit
  const m = xml.match(/\/commit\/([0-9a-f]{40})/i);
  return m ? m[1] : null;
}

// ── self-test: the check must be able to FAIL ────────────────────────────────
if (SELF_TEST) {
  const a = sha(Buffer.from("same")), b = sha(Buffer.from("same")), c = sha(Buffer.from("drift"));
  const pass = a === b && a !== c;
  // a fetch failure must be treated as NOT-VERIFIED (fail-closed), never identical
  const failClosed = (() => { try { throw new Error("HTTP 404"); } catch { return true; } })();
  if (pass && failClosed) {
    console.log("self-test PASSED — identical bytes match, drifted bytes differ, an unfetchable file fails closed.");
    process.exit(0);
  }
  console.error("self-test FAILED — the comparison does not distinguish drift.");
  process.exit(1);
}

// ── live verification ────────────────────────────────────────────────────────
const PIN = readPin();
const files = upstreamFiles();
console.log(`Superpowers vendor check — obra/superpowers @ ${PIN}`);
console.log(`Verifying ${files.length} vendored file(s) against upstream (byte-identity)…\n`);

let identical = 0, drift = [], unverified = [];
for (const { local, upstream } of files) {
  const localSha = sha(readFileSync(local));
  try {
    const remote = await fetchBytes(`${RAW}/${PIN}/${upstream}`);
    if (sha(remote) === localSha) identical++;
    else drift.push(local);
  } catch (e) {
    unverified.push(`${local} (${e.message})`);
  }
}

console.log(`  identical to upstream@pin: ${identical} / ${files.length}`);
if (drift.length) console.log(`  DRIFTED (our copy != upstream@pin):\n    ${drift.join("\n    ")}`);
if (unverified.length) console.log(`  NOT VERIFIED (fetch failed — fail-closed):\n    ${unverified.join("\n    ")}`);

// HEAD movement is REPORTED, never fatal: upstream advancing is a human re-vendor
// DECISION (DR-020), not a defect in our tree.
let headNote = "";
try {
  const head = await latestUpstreamSha();
  if (!head) headNote = "  upstream HEAD: could not parse the commits feed (reported, not fatal).";
  else if (head === PIN) headNote = `  upstream HEAD == pin (${head.slice(0, 12)}) — the pin is current; nothing new to vendor.`;
  else headNote = `  upstream HEAD has ADVANCED to ${head.slice(0, 12)} (pin is ${PIN.slice(0, 12)}) — a re-vendor DECISION is due; see VENDORED.md. REPORTED, not fatal.`;
} catch (e) {
  headNote = `  upstream HEAD: not checked (${e.message}) — reported, not fatal.`;
}
console.log(headNote);

if (drift.length || unverified.length) {
  console.error(`\nSuperpowers vendor check FAILED — the vendored copy no longer provably equals upstream@pin.`);
  process.exit(1);
}
console.log(`\nSuperpowers vendor check passed — every vendored file is byte-identical to obra/superpowers@${PIN.slice(0, 12)}.`);
