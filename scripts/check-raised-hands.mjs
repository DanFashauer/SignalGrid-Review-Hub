#!/usr/bin/env node
// check-raised-hands — the MONITOR for DR-054's "raise your hand" function.
//
//   node scripts/check-raised-hands.mjs             human report (open raised hands, routed owners, gaps)
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
// REPORT, not a build gate: it exits 0 on any state (an open blocker is not a code defect
// that should block a push). loop:state and the mac tick fold its output in so a raised
// hand is never lost, and its --self-test IS a preflight/CI gate (the routing must work).

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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

function rosterRoleIds() {
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
  const roles = new Set(["devex-tooling-engineer", "mobile-native-engineer", "principal-engineer"]);
  t("a gate blocker routes to devex-tooling-engineer", routeHand({ domain: "gates" }, roles).owner === "devex-tooling-engineer");
  t("an ios blocker routes to mobile-native-engineer", routeHand({ domain: "ios-swift" }, roles).owner === "mobile-native-engineer");
  t("whoCanUnblock=owner resolves to the human owner", routeHand({ whoCanUnblock: "owner (a design call)" }, roles).kind === "human");
  t("whoCanUnblock=other-lane resolves to a lane", routeHand({ whoCanUnblock: "the other lane" }, roles).kind === "lane");
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
  if (fail.length) { for (const f of fail) console.error(`self-test FAIL: ${f}`); process.exit(1); }
  console.log("check-raised-hands self-test: ok");
  return 0;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  if (!existsSync(LEDGER)) mkdirSync(LEDGER, { recursive: true });
  const s = summarize(readLedger(), rosterRoleIds(), Date.now());
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
