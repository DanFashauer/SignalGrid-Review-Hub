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
//   node scripts/raise-hand.mjs --resolve <id> ["what unblocked it"]   # close one
//   node scripts/raise-hand.mjs --list                                 # what is open
//
// The four substance fields (doing, blocked, need) plus a domain are the DR-054 contract:
// what you were doing, what blocked you, what you need, and — via `who`/`domain` — who can
// unblock it. A raised hand with an empty `doing`/`blocked`/`need` is refused: an empty
// blocker is worse than none, it looks answered (same law as the lane mailbox).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = join(repo, "artifacts/raised-hands");

const argv = process.argv.slice(2);
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

function resolveHand() {
  ensureLedger();
  const id = val("--resolve");
  const note = argv[argv.indexOf("--resolve") + 2] && !argv[argv.indexOf("--resolve") + 2].startsWith("--") ? argv[argv.indexOf("--resolve") + 2] : "";
  const file = readdirSync(LEDGER).find((f) => f === `${id}.json` || f.replace(/\.json$/, "") === id);
  if (!file) { console.error(`no raised hand with id "${id}" (use --list)`); process.exit(2); }
  const h = JSON.parse(readFileSync(join(LEDGER, file), "utf8"));
  h.status = "resolved";
  h.resolvedAt = new Date().toISOString();
  if (note) h.resolution = note;
  writeFileSync(join(LEDGER, file), `${JSON.stringify(h, null, 2)}\n`, "utf8");
  console.log(`resolved ${h.id}${note ? ` — ${note}` : ""}`);
}

function raise() {
  const doing = val("--doing"), blocked = val("--blocked"), need = val("--need");
  if (!doing || !blocked || !need) {
    console.error('raise-hand: --doing, --blocked and --need are all required (DR-054: what you were doing, what blocked you, what you need). An empty blocker looks answered.');
    process.exit(2);
  }
  ensureLedger();
  const raisedAt = new Date().toISOString();
  const id = `${raisedAt.slice(0, 10)}-${slug(blocked)}`;
  const record = {
    id,
    raisedAt,
    origin: val("--origin") ?? "session",
    doing,
    blockedBy: blocked,
    need,
    whoCanUnblock: val("--who") ?? "",
    domain: (val("--domain") ?? "").toLowerCase(),
    status: "open",
    routedTo: null,
  };
  writeFileSync(join(LEDGER, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`raised hand recorded: artifacts/raised-hands/${id}.json`);
  console.log("The monitor (check-raised-hands) will surface it in loop:state and the mac tick until it is resolved.");
  console.log("Commit it to the lane so the other lane sees it: git add artifacts/raised-hands && git commit && push (or via lane:deliver).");
}

if (argv.includes("--list")) list();
else if (argv.includes("--resolve")) resolveHand();
else raise();
