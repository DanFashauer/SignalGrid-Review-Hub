// A durable read path must authorize, not merely authenticate.
//
//   node scripts/check-durable-path-authorization.mjs
//
// WHY THIS EXISTS. Three GA read routes were written as:
//
//     const store = getDecisionStore();
//     if (store) {
//       const tenantId = core.context(token(req)).tenant.id;   // AUTHENTICATE only
//       const decisions = await store.listDecisions(tenantId);
//       res.json(...); return;                                  // never authorizes
//     }
//     const decisions = core.listDecisions(token(req));         // authorize("decision:read")
//
// `core.context()` authenticates and stops. `listDecisions`/`getDecision`/`getSnapshot`
// are what call `authorize(principal, "decision:read")` — and the durable branch returns
// before reaching any of them. So the permission held in memory and vanished the moment
// DATABASE_URL was set: dev stricter than prod, which is the wrong way round.
//
// WHY A GATE AND NOT JUST THE FIX. The fix added `authorizedContext(token, permission)`
// and a core proof that a `connector` principal cannot obtain a read context. That proof
// is real, but it proves a property of the CORE — it says nothing about whether the
// ROUTES still call it. A handler could regress to `context()` tomorrow and every
// assertion would stay green. That is the declared-vs-derived trap this repo keeps
// finding: a check that verifies the thing next to the thing that matters.
//
// So this reads the route sources and asserts the wiring directly. It is deliberately
// crude — a textual proximity rule, not a type checker — because the failure it prevents
// is crude: someone reaches for `context()` because it is the shorter name.
//
// WHAT IT CANNOT DO. It sees `core.context(...)` near `store.<method>(`. It cannot prove
// the permission chosen is the RIGHT one, cannot follow a tenantId through a helper, and
// does not look outside the route files. Necessary, not sufficient — same footing as the
// ungated-fetch gate, and said out loud for the same reason.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE_ROOT = "artifacts/api-server/src/routes";

// How many lines after a `core.context(...)` count as "the same block" for the purpose
// of spotting a durable read. Generous on purpose: a false positive here is a one-line
// fix, a false negative is an unauthorized read.
const WINDOW = 14;

// Routes that legitimately take a tenantId from `context()` and touch a store, because
// NO permission in the union covers them. Each needs a reason a reader can check — an
// unexplained entry is how a gate quietly stops gating.
// EMPTY, and getting here took the whole arc this gate exists for. The one
// entry this map ever held was /v1/sessions, excused as "the Permission union
// has no session:* member — a product question, not a typo". The product
// question got answered on 2026-08-16: session:read / session:write joined the
// union, every session route now calls authorize() beside its store access, and
// the exemption came out. The map STAYS, empty, because the next surface that
// legitimately cannot be covered by the union deserves a stated reason here —
// not a silent skip.
const EXEMPT = new Map([]);

const files = execFileSync("git", ["ls-files", ROUTE_ROOT], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

const findings = [];
const exempted = [];
let contextSites = 0;
let durableReads = 0;
let authorizedReads = 0;

for (const file of files) {
  const lines = readFileSync(resolve(repo, file), "utf8").split("\n");
  // Track the nearest preceding `router.<verb>("<path>"` so a finding can name its route.
  let currentRoute = "(unknown route)";
  for (let i = 0; i < lines.length; i += 1) {
    const routeDecl = lines[i].match(/router\.\w+\(\s*"([^"]+)"/);
    if (routeDecl) currentRoute = routeDecl[1];

    if (!/\bcore\.context\s*\(/.test(lines[i])) continue;
    if (/^\s*(\/\/|\*)/.test(lines[i])) continue;
    contextSites += 1;

    // Does this context() feed a durable store read within the window?
    //
    // TWO shapes, and missing the second made the first version of this gate pass
    // vacuously. `const store = getDecisionStore(); ... store.listDecisions(...)` binds
    // the store to a local, but `getSessionStore().get(...)` calls straight through. Only
    // the first matched, so the session routes were invisible — and the exemption below
    // was "covering" cases the detector could never have raised. An exemption for
    // something a gate cannot see is a comment pretending to be a control.
    const window = lines.slice(i, i + WINDOW).join("\n");
    const boundStoreRead = /\bstore\.\w+\s*\(/.test(window);
    const inlineStoreRead = /\bget\w*Store\s*\(\s*\)\s*\.\w+\s*\(/.test(window);
    if (!boundStoreRead && !inlineStoreRead) continue;
    durableReads += 1;

    // What clears a finding: an explicit authorization in the same window —
    // either the core's authorizedContext() (context + permission in one call)
    // or a bare authorize(principal, "...") beside a plain context(). Presence
    // in the window, not order: this gate already states it proves the check
    // EXISTS, not that it is the right one or runs first — that is what the
    // 403 assertions in test/api.test.mjs are for.
    if (/\bauthorizedContext\s*\(/.test(window) || /\bauthorize\s*\(/.test(window)) {
      authorizedReads += 1;
      continue;
    }

    const exemptKey = [...EXEMPT.keys()].find((k) => currentRoute.startsWith(k));
    if (exemptKey) {
      exempted.push(`${currentRoute} (${file}:${i + 1})`);
      continue;
    }
    findings.push({ file, line: i + 1, route: currentRoute, src: lines[i].trim().slice(0, 78) });
  }
}

console.log("Durable-path authorization — a durable read must authorize, not just authenticate\n");
console.log(`  route files scanned:            ${files.length}`);
console.log(`  core.context() sites:           ${contextSites}`);
console.log(`  ...of those, feeding a store read: ${durableReads}`);
console.log(`  ...cleared by an authorize() beside the read: ${authorizedReads}`);
console.log(`  exempt (with a stated reason):  ${EXEMPT.size}`);
for (const [route, reason] of EXEMPT) console.log(`\n  ⚠ EXEMPT — ${route}\n      ${reason}`);
if (exempted.length > 0) for (const e of exempted) console.log(`      matched: ${e}`);

if (contextSites === 0) {
  // Zero matches means the parser stopped describing the routes, not that the routes
  // stopped authenticating. A guard that silently checks nothing is worse than none.
  console.error("\n✗ no core.context() site found in any route file — the detector is stale, not the repo clean.");
  process.exit(1);
}

if (findings.length > 0) {
  console.error(
    `\n✗ ${findings.length} durable read(s) taking a tenantId from core.context(), which only AUTHENTICATES:\n`,
  );
  for (const f of findings) console.error(`    ${f.file}:${f.line}  ${f.route}\n      ${f.src}`);
  console.error(
    "\n  Use core.authorizedContext(token, \"<permission>\") instead. It authenticates AND\n" +
      "  authorizes, throws the same forbidden/403 BEFORE any query runs, and takes the typed\n" +
      "  Permission union so a typo will not compile. If the route genuinely has no matching\n" +
      "  permission, add it to EXEMPT here WITH the reason.",
  );
  process.exit(1);
}

console.log(
  "\n  NOT established: that the permission chosen is the CORRECT one for the route. This is a\n" +
    "  textual proximity scan — it proves no durable read takes its tenant from an\n" +
    "  authenticate-only call, which is necessary, not sufficient.",
);
console.log("\nDurable-path authorization passed — every durable read names a permission.");
