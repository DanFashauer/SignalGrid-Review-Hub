#!/usr/bin/env node
// raise-hand — write a DR-054 raised-hand record any lane, routine, gate, or session can
// call when it gets stuck, so the blocker is DURABLE and the monitor (check-raised-hands)
// will surface it until it is addressed.
//
//   node scripts/raise-hand.mjs \
//     --doing "minting live evidence" \
//     --blocked "signalgrid-mcp checkout not found under /workspace" \
//     --need "the sibling repo cloned, or the path" \
//     --domain lane \
//     --who "other lane" \
//     [--origin mac-lane]
//
//     [--where "PR #1005"] [--covers mail:<message-id>]...   # link an auto-detected stall it answers
//
//   node scripts/raise-hand.mjs --take <id> [--by <agent|lane>]        # claim one before working it
//   node scripts/raise-hand.mjs --resolve <id> "what unblocked it"     # close one — the note is REQUIRED
//   node scripts/raise-hand.mjs --list                                 # what is open
//   (pnpm: hand:raise / hand:take / hand:clear; lane:deliver batch ops raise / take / clear)
//
// The four substance fields (doing, blocked, need) plus a domain are the DR-054 contract:
// what you were doing, what blocked you, what you need, and — via `who`/`domain` — who can
// unblock it. A raised hand with an empty `doing`/`blocked`/`need` is refused: an empty
// blocker is worse than none, it looks answered (same law as the lane mailbox).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// SIGNALGRID_LANE_REPO lets lane-deliver write the record into its throwaway worktree.
const repo = process.env.SIGNALGRID_LANE_REPO ? resolve(process.env.SIGNALGRID_LANE_REPO) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lane = () => process.env.SIGNALGRID_LANE ?? (process.platform === "darwin" ? "mac" : "cloud");
const LEDGER = join(repo, "artifacts/raised-hands");

const argv = process.argv.slice(2).filter((a) => a !== "--"); // pnpm may pass its "--" through
const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "blocker";

function ensureLedger() { if (!existsSync(LEDGER)) mkdirSync(LEDGER, { recursive: true }); }

function list() {
  ensureLedger();
  const open = readdirSync(LEDGER).filter((f) => f.endsWith(".json")).map((f) => {
    try { const h = JSON.parse(readFileSync(join(LEDGER, f), "utf8")); return { f, ...h }; } catch { return { f, __unreadable: true }; }
  }).filter((h) => h.__unreadable || h.status !== "resolved");
  if (!open.length) { console.log("No open raised hands."); return; }
  for (const h of open) console.log(`  ${h.id ?? h.f}  [${h.status ?? "open"}]  ${h.domain ?? "?"}  — ${h.doing ?? h.__unreadable ?? ""}`);
}

function findHand(id) {
  const file = readdirSync(LEDGER).find((f) => f === `${id}.json` || f.replace(/\.json$/, "") === id);
  if (!file) { console.error(`no raised hand with id "${id}" (use --list)`); process.exit(2); }
  return { file, h: JSON.parse(readFileSync(join(LEDGER, file), "utf8")) };
}

function take() {
  ensureLedger();
  const { file, h } = findHand(val("--take"));
  if (h.status === "resolved") { console.error(`${h.id} is already resolved`); process.exit(2); }
  h.takenBy = val("--by") ?? lane();
  h.takenAt = new Date().toISOString();
  writeFileSync(join(LEDGER, file), `${JSON.stringify(h, null, 2)}\n`, "utf8");
  console.log(`taken ${h.id} by ${h.takenBy}`);
}

function resolveHand() {
  ensureLedger();
  const id = val("--resolve");
  const next = argv[argv.indexOf("--resolve") + 2];
  const note = val("--resolution") ?? (next && !next.startsWith("--") ? next : "");
  // "Resolved" without what resolved it is not evidence — refused, the same law as an
  // empty ack (scripts/raised-hands.mjs --check fails a resolved record with no resolution).
  if (!String(note).trim()) { console.error('raise-hand --resolve: say what unblocked it ("…" or --resolution "…") — a resolution with no evidence is refused.'); process.exit(2); }
  const { file, h } = findHand(id);
  h.status = "resolved";
  h.resolvedAt = new Date().toISOString();
  h.resolvedBy = val("--by") ?? lane();
  h.resolution = note;
  writeFileSync(join(LEDGER, file), `${JSON.stringify(h, null, 2)}\n`, "utf8");
  console.log(`resolved ${h.id}${note ? ` — ${note}` : ""}`);
}

async function raise() {
  const doing = val("--doing"), blocked = val("--blocked"), need = val("--need");
  if (!doing || !blocked || !need) {
    console.error('raise-hand: --doing, --blocked and --need are all required (DR-054: what you were doing, what blocked you, what you need). An empty blocker looks answered.');
    process.exit(2);
  }
  // DR-054's fourth field: who can unblock it. check-raised-hands.mjs (preflight + CI) rejects a hand
  // whose whoCanUnblock is empty or not a role / owner / lane, so a writer that let one through would
  // turn mainline red on the merge. Refuse here, with the same predicate.
  const { whoIsValid, rosterRoleIds, coverProblem } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "check-raised-hands.mjs")).href);
  if (!whoIsValid(val("--who"), rosterRoleIds())) {
    console.error(`raise-hand: --who "${val("--who") ?? ""}" must be owner, "mac lane", "cloud lane", "the other lane", tool:<name> or an org-roster role id (docs/agent/org-roster.json) — DR-054 needs WHO can unblock it.`);
    process.exit(2);
  }
  // Same predicate as the schema: a cover the stale-hand rule can never match (a typo'd kind, a trailing
  // space, `--covers` as the last argument) is refused here instead of turning CI red after the merge.
  for (const [i, a] of argv.entries()) {
    if (a !== "--covers") continue;
    const why = coverProblem(argv[i + 1]);
    if (why) { console.error(`raise-hand: --covers ${why}`); process.exit(2); }
  }
  ensureLedger();
  const raisedAt = new Date().toISOString();
  const id = val("--id") ?? `${raisedAt.slice(0, 10)}-${slug(blocked)}`;
  if (existsSync(join(LEDGER, `${id}.json`))) { console.error(`raise-hand: ${id} already exists — pass --id, or --take / --resolve the existing one`); process.exit(2); }
  const record = {
    id,
    raisedAt,
    origin: val("--origin") ?? lane(),
    doing,
    blockedBy: blocked,
    need,
    whoCanUnblock: val("--who") ?? "",
    domain: (val("--domain") ?? "").toLowerCase(),
    status: "open",
    routedTo: null,
  };
  if (val("--where")) record.where = val("--where");
  const covers = argv.flatMap((a, i) => (a === "--covers" ? [argv[i + 1]] : []));
  if (covers.length) record.covers = covers;
  writeFileSync(join(LEDGER, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`raised hand recorded: artifacts/raised-hands/${id}.json`);
  console.log("The monitor (check-raised-hands) will surface it in loop:state and the mac tick until it is resolved.");
  console.log("Commit it to the lane so the other lane sees it: git add artifacts/raised-hands && git commit && push (or via lane:deliver).");
}

if (argv.includes("--list")) list();
else if (argv.includes("--take")) take();
else if (argv.includes("--resolve")) resolveHand();
else await raise();
