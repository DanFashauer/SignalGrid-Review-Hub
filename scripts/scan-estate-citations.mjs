// scan-estate-citations.mjs — run the cited-path check across every repository in the
// estate, not just this one.
//
//   node scripts/scan-estate-citations.mjs            # report
//   node scripts/scan-estate-citations.mjs --json     # machine-readable
//
// WHY THE ESTATE AND NOT JUST THIS REPO. The defect this catches — a document citing a
// file that is not there — is worst in the repositories nobody is looking at. This one
// has 189 gates watching it (measured 2026-09-06 by `node scripts/check-gate-census.mjs`,
// which prints the current figure — this line said "~175" and there is no point retyping a
// number the census owns); the private core, the legacy `DEV` tree and the MCP server
// have none. And a reader deciding what to build does not stop at a repository boundary:
// the private core's own "Where things live" map is exactly the kind of document an
// agent treats as ground truth, and it is the least likely to have been re-measured.
//
// A REPO THAT COULD NOT BE SCANNED IS REPORTED, NEVER COUNTED CLEAN. This is the same
// law the simulation-request loop enforces one floor down: unrun is not green. A missing
// checkout is loud here, because "5 of 7 clean" and "5 clean, 2 never opened" look
// identical in a summary and mean completely different things.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "./check-cited-paths.mjs";

const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The estate, declared rather than discovered: a scan that silently covers whatever
// happens to be on disk cannot tell you what it missed.
export const ESTATE = [
  { name: "SignalGrid-Review-Hub", path: SELF_ROOT, note: "this repository — the product surface" },
  { name: "signalgrid-mcp", path: "/workspace/signalgrid-mcp", note: "read-only macOS posture MCP server" },
  { name: "signalgrid", path: "/workspace/signalgrid", note: "private core (Replit lineage)" },
  { name: "dev", path: "/workspace/dev", note: "legacy alpha lineage, superseded" },
  { name: "signalgrid-inspiration", path: "/workspace/signalgrid-inspiration", note: "private intake source material" },
  { name: "vaultlens", path: "/workspace/danfashauer/vaultlens", note: "separate product" },
  {
    name: "fleet",
    path: "/workspace/fleet",
    note: "fork of fleetdm/fleet — upstream's docs, not this owner's writing",
    upstreamFork: true,
  },
];

const AS_JSON = process.argv.includes("--json");

const results = [];
for (const entry of ESTATE) {
  if (!existsSync(entry.path)) {
    results.push({ ...entry, status: "NOT_SCANNED", reason: "no checkout at this path" });
    continue;
  }
  try {
    const r = scanRepo(entry.path);
    results.push({ ...entry, status: r.missing.length === 0 ? "CLEAN" : "BROKEN", ...r });
  } catch (err) {
    results.push({ ...entry, status: "NOT_SCANNED", reason: String(err?.message ?? err) });
  }
}

const scanned = results.filter((r) => r.status !== "NOT_SCANNED");
const broken = results.filter((r) => r.status === "BROKEN");
const unscanned = results.filter((r) => r.status === "NOT_SCANNED");

// `upstreamFork` WAS DECLARED AND READ NOWHERE. The fleet entry carries
// `upstreamFork: true` with the note "upstream's docs, not this owner's writing",
// and nothing in this file ever consulted it — so fleetdm's own broken README links
// were tallied into one figure with this owner's. Measured 2026-09-06: 26 broken
// citations "in 3 repos", of which 23 were fleet's. The headline number was ~9x the
// thing it was supposed to measure, and a reader could not tell from the summary.
//
// A fork's citations are REPORTED (a broken link is still worth seeing) and never
// gate: nobody here wrote them and nobody here can fix them without diverging from
// upstream.
const firstPartyBroken = broken.filter((r) => !r.upstreamFork);
const forkBroken = broken.filter((r) => r.upstreamFork);
const firstPartyMissing = firstPartyBroken.reduce((n, r) => n + r.missing.length, 0);
const forkMissing = forkBroken.reduce((n, r) => n + r.missing.length, 0);
const totalMissing = firstPartyMissing + forkMissing;

// GATED on first-party broken citations only; REPORTED for forks and for repos this
// checkout could not reach. It used to `console.log` its ✗ rows and exit 0 on every
// path, so `pnpm run scan:estate` printed 26 failures and told its caller — and any
// script wrapping it — that everything was fine.
const exitCode = firstPartyMissing > 0 ? 1 : 0;

if (AS_JSON) {
  console.log(JSON.stringify({ results, firstPartyMissing, forkMissing, unscanned: unscanned.length }, null, 2));
  process.exit(exitCode);
}

console.log("Estate cited-path scan — a document may not point at a file that is not there\n");
console.log(`  ${"repository".padEnd(24)} ${"status".padEnd(12)} docs  cites  broken`);
console.log(`  ${"-".repeat(24)} ${"-".repeat(12)} ----  -----  ------`);
for (const r of results) {
  const docs = r.status === "NOT_SCANNED" ? "—" : String(r.docs);
  const cites = r.status === "NOT_SCANNED" ? "—" : String(r.checked);
  const bad = r.status === "NOT_SCANNED" ? "—" : String(r.missing.length);
  console.log(`  ${r.name.padEnd(24)} ${r.status.padEnd(12)} ${docs.padStart(4)}  ${cites.padStart(5)}  ${bad.padStart(6)}`);
}

for (const r of firstPartyBroken) {
  console.log(`\n── ${r.name} — ${r.missing.length} broken citation(s)  [GATED: this owner's writing]`);
  console.log(`   ${r.note}`);
  for (const m of r.missing) console.log(`   ✗ ${m.doc}  →  ${m.path}`);
}

for (const r of forkBroken) {
  console.log(`\n── ${r.name} — ${r.missing.length} broken citation(s)  [REPORTED, not gated: upstream fork]`);
  console.log(`   ${r.note}`);
  for (const m of r.missing) console.log(`   · ${m.doc}  →  ${m.path}`);
}

for (const r of scanned) {
  if (r.intakeDocs > 0) console.log(`\n  note: ${r.name} — ${r.intakeDocs} pasted/intake document(s) skipped (not this owner's claims)`);
  for (const e of r.exempted ?? []) console.log(`  note: ${r.name} — ${e.doc} exempt, ${e.count} path(s) describing ${e.reason}`);
}

if (unscanned.length > 0) {
  console.log(`\n  NOT SCANNED — reported, never counted clean:`);
  for (const r of unscanned) console.log(`    · ${r.name} — ${r.reason}`);
  console.log(`    Clone them under /workspace and re-run; silence about a repo is not a pass.`);
}

console.log(
  `\n${scanned.length}/${ESTATE.length} repositories scanned · ` +
    `${firstPartyMissing} broken citation(s) in ${firstPartyBroken.length} first-party repo(s) [GATED] · ` +
    `${forkMissing} in ${forkBroken.length} upstream fork(s) [REPORTED] · ${totalMissing} total` +
    (unscanned.length ? ` · ${unscanned.length} NOT SCANNED` : ""),
);
if (exitCode !== 0) {
  console.error(
    `\nEstate cited-path scan FAILED: ${firstPartyMissing} broken citation(s) in writing this owner controls.\n` +
      `A document pointing at a file that is not there is read as ground truth by the next agent.`,
  );
}
process.exit(exitCode);
