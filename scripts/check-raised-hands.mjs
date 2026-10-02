#!/usr/bin/env node
// check-raised-hands — the MONITOR for DR-054's "raise your hand" function.
//
//   node scripts/check-raised-hands.mjs             VALIDATES every hand against the schema (exit 1 naming file + field), then the human report
//   node scripts/check-raised-hands.mjs --json      machine-readable (loop:state + the mac tick read this)
//   node scripts/check-raised-hands.mjs --self-test prove the routing + gap detection can fail
//
// WHY THIS EXISTS
// --------------
// DR-054 made every autonomous unit RAISE its hand when stuck. But a raised hand nobody
// watches is as useless as no hand. This is the other half of the reflex arc, and the
// owner's directive (2026-09-23): "build something that monitors the raise-your-hand
// function, then apply what is needed for these agents to address, or create a new agent
// or skill to fill that gap." So:
//
//   1. MONITOR — a raised hand is a durable record in artifacts/raised-hands/*.json
//      (written by scripts/raise-hand.mjs). This reads them and SURFACES every OPEN one,
//      never silently — an unaddressed blocker is PENDING the same way an unacked lane
//      message is, and it gets LOUDER with age.
//   2. ROUTE — each open hand is assigned an OWNER: a role from docs/agent/org-roster.json
//      (by its `domain`), or the owner / the other lane / a named tool when `whoCanUnblock`
//      says so. A routed hand is actionable, not just visible.
//   3. GAP — a hand whose `domain` matches NO role and whose `whoCanUnblock` is not the
//      owner/lane/a tool is a CAPABILITY GAP: no agent or skill owns this kind of blocker.
//      The blocker-dispatcher agent (.claude/agents/blocker-dispatcher.md) then routes it
//      or specs the new agent/skill to create. A gap is reported the loudest.
//
// An open blocker is NOT a build failure, but a MALFORMED hand is: the bare run validates
// every hand's shape (validateHand) and exits 1 naming the file and the field, and that run is
// a preflight/CI gate. Before this, a hand with a bogus whoCanUnblock, no need, status
// "maybe" or an id that disagreed with its filename exited 0 and was routed to a GAP or
// dropped. --json / --tick-summary stay report-only (loop:state and the mac tick fold them
// in so a raised hand is never lost); --self-test is a gate too (the routing must work).

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEDGER = join(repo, "artifacts/raised-hands");
const ROSTER = join(repo, "docs/agent/org-roster.json");
const STALE_DAYS = 3; // an open raised hand older than this is overdue — reported louder.

// domain keyword -> org-roster role id. A raised hand names a `domain`; this maps it to
// the role whose executor (agent:/skill:) addresses that kind of blocker. Ordered: the
// first keyword the domain contains wins. Roles are validated against the roster at load,
// so a typo here becomes a GAP (surfaced), never a silent misroute.
export const DOMAIN_TO_ROLE = [
  // Direction / prioritization / queue blockers go to the PROJECT MANAGER, never to the
  // human owner (owner 2026-09-23: "should be part of project management handling these
  // tasks; issues get reported to them for direction"). "What next / which priority / how
  // do these fit" is the brain's to answer, via product-manager's executor.
  ["priorit", "product-manager"], ["queue", "product-manager"], ["backlog", "product-manager"],
  ["what-next", "product-manager"], ["next", "product-manager"], ["direction", "product-manager"],
  ["rank", "product-manager"], ["groom", "product-manager"],
  ["cadence", "program-manager"], ["coordinat", "program-manager"], ["shift", "program-manager"], ["schedul", "program-manager"],
  ["decision", "principal-engineer"], ["core", "principal-engineer"],
  ["gate", "devex-tooling-engineer"], ["tooling", "devex-tooling-engineer"], ["ci", "devex-tooling-engineer"], ["lint", "devex-tooling-engineer"],
  ["ios", "mobile-native-engineer"], ["swift", "mobile-native-engineer"], ["mobile", "mobile-native-engineer"],
  ["web", "web-engineer"], ["desktop", "desktop-engineer"],
  ["authz", "security-engineer"], ["auth", "security-engineer"], ["security", "security-engineer"], ["secret", "security-engineer"],
  ["iam", "iam-domain"], ["identity", "iam-domain"],
  ["endpoint", "endpoint-uem-domain"], ["uem", "endpoint-uem-domain"], ["mdm", "endpoint-uem-domain"],
  ["secops", "secops-domain"], ["network", "network-domain"], ["physical", "physical-ot-domain"], ["ot", "physical-ot-domain"],
  ["itsm", "itsm-ops-domain"], ["ops", "itsm-ops-domain"],
  ["doc", "docs-writer"], ["persistence", "data-persistence-engineer"], ["data", "data-persistence-engineer"],
  ["api", "api-contract-architect"], ["contract", "api-contract-architect"],
  ["perf", "performance-engineer"], ["release", "release-engineer"], ["deploy", "release-engineer"],
  ["accessib", "accessibility-specialist"], ["a11y", "accessibility-specialist"],
  ["complian", "compliance-analyst"],
  ["lane", "mac-lane-steward"], ["infra", "mac-lane-steward"],
  ["agent", "agent-platform-engineer"], ["skill", "agent-platform-engineer"], ["plane", "agent-platform-engineer"],
  ["reliab", "sre"], ["sre", "sre"],
];

export function rosterRoleIds() {
  try {
    const r = JSON.parse(readFileSync(ROSTER, "utf8"));
    const roles = Array.isArray(r) ? r : r.roles || [];
    return new Set(roles.map((x) => x.id).filter(Boolean));
  } catch { return new Set(); }
}

/** Resolve the OWNER of one raised hand: a validated role, an explicit human/lane/tool
 *  target, or a capability GAP. Pure (roles injected) so the self-test needs no roster. */
export function routeHand(hand, roleIds) {
  const who = String(hand.whoCanUnblock ?? "").toLowerCase();
  if (who.startsWith("owner") || who === "dan") return { owner: "owner", kind: "human" };
  if (who.includes("lane")) return { owner: who, kind: "lane" };
  if (who.startsWith("tool:")) return { owner: who, kind: "tool" };
  const domain = String(hand.domain ?? "").toLowerCase();
  for (const [kw, role] of DOMAIN_TO_ROLE) {
    if (domain.includes(kw)) {
      // Fail-closed: a mapping to a role the roster does not carry is a GAP, not a route.
      return roleIds.has(role) ? { owner: role, kind: "role" } : { owner: null, kind: "gap", reason: `domain "${domain}" maps to "${role}", absent from the roster` };
    }
  }
  return { owner: null, kind: "gap", reason: `domain "${domain || "(none)"}" matches no role and no explicit unblocker` };
}

export const HAND_STATUSES = ["open", "resolved"];
export const HAND_REQUIRED = ["id", "raisedAt", "doing", "blockedBy", "need", "whoCanUnblock", "status"];
const LANE_WHO = /^(mac lane|cloud lane|the other lane|other lane)(\b|$)/;

/** Is `who` a place a hand can legally be routed? owner, a lane, or an org-roster role
 *  (a role id may be followed by prose: "security-engineer (the fix) with …"). */
export function whoIsValid(who, roleIds) {
  const w = String(who ?? "").trim().toLowerCase();
  if (!w) return false;
  if (/^(owner|dan)(\b|$)/.test(w) || LANE_WHO.test(w)) return true;
  return roleIds.has(w.split(/[\s(,;]/)[0]);
}

/** Schema problems of ONE hand, each naming file and field. Pure: roles injected. */
export function validateHand(h, roleIds) {
  const file = h.__file ?? "(unknown file)";
  if (h.__unreadable) return [`${file}: does not parse (${h.__unreadable})`];
  const out = [];
  for (const f of HAND_REQUIRED) if (typeof h[f] !== "string" || !h[f].trim()) out.push(`${file}: field "${f}" is missing or empty`);
  if (typeof h.status === "string" && h.status.trim() && !HAND_STATUSES.includes(h.status)) out.push(`${file}: field "status" is "${h.status}", must be one of ${HAND_STATUSES.join(" | ")}`);
  if (typeof h.id === "string" && h.id.trim() && `${h.id}.json` !== file) out.push(`${file}: field "id" is "${h.id}", must equal the filename stem "${file.replace(/\.json$/, "")}"`);
  if (typeof h.whoCanUnblock === "string" && h.whoCanUnblock.trim() && !whoIsValid(h.whoCanUnblock, roleIds)) {
    out.push(`${file}: field "whoCanUnblock" is "${h.whoCanUnblock}", must be an org-roster role, owner, "mac lane", "cloud lane" or "the other lane"`);
  }
  if (h.covers !== undefined && !(Array.isArray(h.covers) && h.covers.every((c) => typeof c === "string" && /^[a-z-]+:.+/.test(c)))) {
    out.push(`${file}: field "covers" must be a list of auto-hand ids like "mail:<message-id>"`);
  }
  return out;
}

export function validateLedger(hands, roleIds) {
  return hands.flatMap((h) => validateHand(h, roleIds));
}

function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readdirSync(LEDGER)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { const h = JSON.parse(readFileSync(join(LEDGER, f), "utf8")); h.__file = f; return h; }
      catch (e) { return { __file: f, __unreadable: e.message }; } // DR-054: never drop it silently
    });
}

function ageDays(iso, nowMs) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.floor((nowMs - t) / 86400000) : null;
}

/** Pure summary of the ledger, given the roster + a clock. */
export function summarize(hands, roleIds, nowMs) {
  const rows = [];
  for (const h of hands) {
    if (h.__unreadable) { rows.push({ file: h.__file, status: "UNREADABLE", detail: h.__unreadable, owner: null, kind: "gap" }); continue; }
    if (h.status === "resolved") continue;
    const r = routeHand(h, roleIds);
    rows.push({ file: h.__file, id: h.id, status: h.status ?? "open", domain: h.domain, doing: h.doing, need: h.need, ageDays: ageDays(h.raisedAt, nowMs), ...r });
  }
  const open = rows.length;
  const gaps = rows.filter((r) => r.kind === "gap").length;
  const stale = rows.filter((r) => typeof r.ageDays === "number" && r.ageDays > STALE_DAYS).length;
  return { open, gaps, stale, rows };
}

function selfTest() {
  const fail = [];
  const t = (n, ok) => { if (!ok) fail.push(n); };
  const roles = new Set(["devex-tooling-engineer", "mobile-native-engineer", "principal-engineer", "product-manager", "program-manager"]);
  t("a gate blocker routes to devex-tooling-engineer", routeHand({ domain: "gates" }, roles).owner === "devex-tooling-engineer");
  t("a PRIORITY/direction blocker routes to the project manager, NOT the owner", routeHand({ domain: "priority-which-next" }, roles).owner === "product-manager");
  // One case per direction/priority keyword (3654425f), each domain holding only its own
  // keyword, so dropping or shadowing any one of them fails here.
  for (const [domain, role] of [
    ["priorities", "product-manager"], ["queue", "product-manager"], ["backlog", "product-manager"],
    ["what-next", "product-manager"], ["next", "product-manager"], ["direction", "product-manager"],
    ["ranking", "product-manager"], ["grooming", "product-manager"],
    ["cadence", "program-manager"], ["coordination", "program-manager"], ["shift", "program-manager"], ["scheduling", "program-manager"],
  ]) t(`a "${domain}" blocker with no explicit unblocker routes to ${role} (brain self-directs)`, routeHand({ domain }, roles).owner === role);
  t("a direction blocker whose whoCanUnblock names the owner still goes to the owner", routeHand({ domain: "priority", whoCanUnblock: "owner" }, roles).kind === "human");
  t("an ios blocker routes to mobile-native-engineer", routeHand({ domain: "ios-swift" }, roles).owner === "mobile-native-engineer");
  t("whoCanUnblock=owner resolves to the human owner", routeHand({ whoCanUnblock: "owner (a design call)" }, roles).kind === "human");
  t("whoCanUnblock=other-lane resolves to a lane", routeHand({ whoCanUnblock: "the other lane" }, roles).kind === "lane");
  // validateHand: one planted defect per rule; removing the rule makes its line go FAIL.
  const good = { __file: "h.json", id: "h", raisedAt: "2026-09-23T00:00:00Z", doing: "d", blockedBy: "b", need: "n", whoCanUnblock: "owner", status: "open" };
  const bad = (over, needle) => validateHand({ ...good, ...over }, roles).some((p) => p.includes(needle));
  t("validate: a well-formed hand has no problems", validateHand(good, roles).length === 0);
  t("validate: a role-prefixed whoCanUnblock with prose is valid", validateHand({ ...good, whoCanUnblock: "product-manager (ranks it) with principal-engineer" }, roles).length === 0);
  t("validate: lanes are valid unblockers", validateHand({ ...good, whoCanUnblock: "mac lane" }, roles).length === 0 && validateHand({ ...good, whoCanUnblock: "cloud lane" }, roles).length === 0);
  t("validate: a missing need is named by file and field", bad({ need: undefined }, 'h.json: field "need"'));
  t("validate: a missing whoCanUnblock is named", bad({ whoCanUnblock: undefined }, 'field "whoCanUnblock"'));
  t("validate: a bogus whoCanUnblock is named", bad({ whoCanUnblock: "nobody-in-particular" }, 'field "whoCanUnblock" is "nobody-in-particular"'));
  t("validate: status maybe is rejected", bad({ status: "maybe" }, 'field "status" is "maybe"'));
  t("validate: an id that is not the filename stem is rejected", bad({ id: "other" }, 'field "id" is "other"'));
  t("validate: 'Owner' is valid (case-folded, as routeHand folds it)", validateHand({ ...good, whoCanUnblock: "Owner" }, roles).length === 0);
  t("validate: 'danger-zone' is NOT the owner (word boundary)", bad({ whoCanUnblock: "danger-zone" }, 'field "whoCanUnblock"'));
  t("validate: 'ownerless' is NOT the owner (word boundary)", bad({ whoCanUnblock: "ownerless" }, 'field "whoCanUnblock"'));
  t("validate: 'the other lane' is valid (routeHand routes it)", validateHand({ ...good, whoCanUnblock: "the other lane" }, roles).length === 0);
  t("validate: a RESOLVED hand with a bogus whoCanUnblock is rejected too", bad({ status: "resolved", whoCanUnblock: "nobody" }, 'field "whoCanUnblock"'));
  t("validate: covers that is a string, not a list, is named", bad({ covers: "mail:abc" }, 'field "covers"'));
  t("validate: a covers entry with no kind prefix is named", bad({ covers: ["abc"] }, 'field "covers"'));
  t("validate: a well-formed covers list is valid", validateHand({ ...good, covers: ["mail:abc"] }, roles).length === 0);
  t("validate: an unreadable file is named", validateHand({ __file: "x.json", __unreadable: "bad" }, roles)[0].startsWith("x.json:"));
  t("validate: ledger-wide, one bad hand among good ones is reported", validateLedger([good, { ...good, __file: "z.json", id: "z", status: "maybe" }], roles).length === 1);
  t("an unknown domain with no explicit unblocker is a GAP", routeHand({ domain: "quantum-teleport" }, roles).kind === "gap");
  t("a domain mapping to a role ABSENT from the roster is a GAP, not a misroute", routeHand({ domain: "network" }, roles).kind === "gap");
  // summarize: a resolved hand is not surfaced; an open one is; an unreadable one is a gap.
  const s = summarize(
    [{ status: "resolved", domain: "gates" }, { status: "open", domain: "ios", raisedAt: "2000-01-01T00:00:00Z", whoCanUnblock: "" }, { __unreadable: "bad json", __file: "x.json" }],
    roles, Date.parse("2026-09-23T00:00:00Z"),
  );
  t("resolved hands are not surfaced, open + unreadable are", s.open === 2);
  t("a very old open hand counts as stale", s.stale >= 1);
  t("an unreadable ledger file counts as a gap, never dropped", s.gaps >= 1);
  // main(): the bare run must EXIT 1 on a planted bad hand and 0 on a good one (a self-test of
  // validateHand alone cannot see main's wiring). Runs a copy of this script in a temp tree.
  const tmp = mkdtempSync(join(realpathSync(tmpdir()), "crh-main-"));
  try {
    mkdirSync(join(tmp, "scripts"), { recursive: true }); mkdirSync(join(tmp, "docs/agent"), { recursive: true }); mkdirSync(join(tmp, "artifacts/raised-hands"), { recursive: true });
    copyFileSync(fileURLToPath(import.meta.url), join(tmp, "scripts/check-raised-hands.mjs"));
    writeFileSync(join(tmp, "docs/agent/org-roster.json"), JSON.stringify({ roles: [{ id: "sre" }] }));
    const hp = join(tmp, "artifacts/raised-hands/h.json");
    const runMain = () => spawnSync("node", [join(tmp, "scripts/check-raised-hands.mjs")], { encoding: "utf8" });
    writeFileSync(hp, JSON.stringify({ ...good, __file: undefined }));
    t("main: the bare run exits 0 on a well-formed ledger", runMain().status === 0);
    writeFileSync(hp, JSON.stringify({ ...good, whoCanUnblock: "nobody-in-particular" }));
    const bad1 = runMain();
    t("main: the bare run exits 1 on a bad hand and names file and field", bad1.status === 1 && bad1.stderr.includes('h.json: field "whoCanUnblock"'));
    // the WRITER and the schema must agree: whatever hand:raise accepts, the bare check accepts, and
    // whatever the check would reject, hand:raise refuses to write (a hand raised by the tool's own
    // route must never turn mainline red).
    rmSync(hp);
    copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "raise-hand.mjs"), join(tmp, "scripts/raise-hand.mjs"));
    const raise = (...a) => spawnSync("node", [join(tmp, "scripts/raise-hand.mjs"), "--doing", "d", "--blocked", "b", "--need", "n", ...a], { encoding: "utf8", env: { ...process.env, SIGNALGRID_LANE_REPO: tmp } });
    t("writer: hand:raise with no --who is refused (rc 2), writes nothing", raise("--id", "w1", "--domain", "ios").status === 2 && !existsSync(join(tmp, "artifacts/raised-hands/w1.json")));
    t("writer: hand:raise with a bogus --who is refused", raise("--id", "w2", "--who", "nobody-in-particular").status === 2);
    t("writer: hand:raise with a malformed --covers is refused", raise("--id", "w3", "--who", "owner", "--covers", "nokind").status === 2);
    const okRaise = raise("--id", "w4", "--who", "the other lane");
    t("writer: …and every hand it DOES write passes the bare check (rc 0)", okRaise.status === 0 && runMain().status === 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (fail.length) { for (const f of fail) console.error(`self-test FAIL: ${f}`); process.exit(1); }
  console.log("check-raised-hands self-test: ok");
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  if (!existsSync(LEDGER)) mkdirSync(LEDGER, { recursive: true });
  const hands = readLedger();
  const roleIds = rosterRoleIds();
  const s = summarize(hands, roleIds, Date.now());
  const quiet = argv.includes("--json") || argv.includes("--tick-summary");
  if (!quiet) {
    const bad = validateLedger(hands, roleIds);
    if (bad.length) {
      for (const p of bad) console.error(`  ✗ ${p}`);
      console.error(`\nRaised-hands schema check FAILED: ${bad.length} problem(s). Fix the hand file (pnpm run hand:raise writes a valid one).`);
      process.exit(1);
    }
    console.log(`Raised-hands schema check passed: ${hands.length} hand file(s) valid.`);
  }
  if (argv.includes("--json")) { console.log(JSON.stringify(s)); return; }
  // --tick-summary: one short line for the Mac tick's RESULT (empty when none open, so
  // the tick stays honestly silent). Never mistaken for "monitor did not run".
  if (argv.includes("--tick-summary")) {
    if (s.open > 0) console.log(`raised-hands=${s.open}${s.gaps ? ` gaps=${s.gaps}` : ""}${s.stale ? ` overdue=${s.stale}` : ""}`);
    return;
  }

  if (s.open === 0) { console.log("Raised hands: none open — every blocker has been resolved."); return; }
  console.log(`Raised hands: ${s.open} open${s.gaps ? `, ${s.gaps} with NO owner (capability gap)` : ""}${s.stale ? `, ${s.stale} overdue (> ${STALE_DAYS}d)` : ""}\n`);
  for (const r of s.rows) {
    const age = r.ageDays == null ? "?" : `${r.ageDays}d`;
    if (r.kind === "gap") {
      console.log(`  ⚠ GAP  [${age}] ${r.id ?? r.file} — ${r.reason ?? r.detail ?? r.domain}\n         need: ${r.need ?? "(unstated)"}\n         → no agent/skill owns this; the blocker-dispatcher must ROUTE or CREATE one.`);
    } else {
      console.log(`  → ${r.owner} (${r.kind})  [${age}] ${r.id ?? r.file} — ${r.doing ?? r.domain}\n         need: ${r.need ?? "(unstated)"}`);
    }
  }
  console.log(`\nThe blocker-dispatcher agent addresses these; loop:state and the mac tick keep them visible until resolved (mark status:"resolved" via scripts/raise-hand.mjs --resolve <id>).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
