// Brain-cycle decision core — the deterministic "brain picks" step (DR-032).
//
//   node scripts/brain-cycle-decide.mjs --self-test   # the fail-closed decision logic, all arms
//
// WHY THIS EXISTS. "The brain picks the best route" must NOT be a model verdict (golden
// rule 2: deterministic, fail-closed). This module reads the audit blackboard the swarm
// wrote (one file per lens) and, with pure code, selects the single winning route or
// opens NOTHING. It never re-judges code; it selects among routes the swarm surfaced and
// ranks them, and it refuses on any uncertainty. `classifyDiff` (imported, never
// re-derived) is the merge-tier authority; this module never decides owner-gated tiers
// are safe — it escalates them.
//
// THE FAIL-CLOSED RULES (a candidate route is eligible only when ALL hold):
//   1. Consensus floor: CONFIRMED by >=1 veto lens, OR by >=2 independent lenses. A lone
//      unconfirmed finding never wins — that floor is what stops a daily cycle opening
//      low-value PRs that train the owner to ignore them.
//   2. Zero veto: no veto lens (security-reviewer, fail-closed-auditor) posted a BLOCK
//      touching the route.
//   3. Autonomous tier: classifyDiff(route.files).tier === "autonomous". Owner-gated
//      routes are ESCALATED, never auto-picked (a robot cannot merge its own safety net).
//   4. Not already proposed: the route is not in an open PR / the already-proposed ledger
//      (churn dedup — a daily cycle re-opening the same finding is the predictable failure).
//
// AND the whole cycle is a HARD NO (open nothing, escalate) when ANY expected lens did not
// post, ran:false, or is UNVERIFIED on a surface a candidate depends on. "A reviewer that
// did not run = NO" lives HERE, in the orchestrator's own logic, deliberately not deferred
// to a gate (there is no gate that asserts a reviewer ran; a permanent-condition check gets
// scrolled past). This is the loop's one un-gated trust anchor, so it is proven by a
// planted-defect self-test below, both directions.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyDiff } from "./check-owner-gated-surfaces.mjs";

const DEFAULT_CONFIG = {
  vetoLenses: ["security-reviewer", "fail-closed-auditor"],
  minConfidence: 0.7,
};

// A finding "counts" only when CONFIRMED (never a bare candidate) and at/above min confidence.
function counts(finding, cfg) {
  return finding && finding.verdict === "CONFIRMED" && (finding.confidence ?? 0) >= cfg.minConfidence;
}

// Group confirmed findings into candidate routes. A route is keyed by its proposedRoute id
// (falling back to file+category) and carries the set of files it would touch and which
// lenses confirmed it.
function candidateRoutes(lenses, cfg) {
  const routes = new Map();
  for (const lens of lenses) {
    if (!lens || lens.ran === false) continue;
    for (const f of lens.findings || []) {
      if (!counts(f, cfg)) continue;
      const key = f.proposedRoute || `${f.file}::${f.category}`;
      if (!routes.has(key)) routes.set(key, { key, files: new Set(), byLens: new Set(), warnings: 0 });
      const r = routes.get(key);
      if (f.file) r.files.add(f.file);
      r.byLens.add(lens.lens);
      if (f.verdict === "WARNING") r.warnings += 1;
    }
  }
  return [...routes.values()].map((r) => ({ ...r, files: [...r.files], byLens: [...r.byLens] }));
}

// Did any veto lens post a BLOCK touching one of the route's files?
function vetoedRoute(route, lenses, cfg) {
  for (const lens of lenses) {
    if (!lens || !cfg.vetoLenses.includes(lens.lens)) continue;
    for (const f of lens.findings || []) {
      if (f.verdict === "BLOCK" && (!f.file || route.files.includes(f.file))) return true;
    }
  }
  return false;
}

// PURE decision. Returns { winner|null, reason, hardNo, escalate, ranked }.
// - expected: the lens names the _manifest.json said should have posted this cycle.
// - alreadyProposed: Set of route keys already open / previously proposed (churn dedup).
export function decide({ lenses = [], expected = [], config = {}, alreadyProposed = new Set() } = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const byName = new Map(lenses.map((l) => [l && l.lens, l]));

  // HARD NO arm 1: an expected lens is absent or ran:false. The un-gated trust anchor.
  const notRun = [];
  for (const name of expected) {
    const l = byName.get(name);
    if (!l) notRun.push(`${name} (absent from board)`);
    else if (l.ran === false) notRun.push(`${name} (ran:false)`);
    else if (l.verdict === "UNVERIFIED") notRun.push(`${name} (UNVERIFIED)`);
  }
  if (notRun.length > 0) {
    return { winner: null, hardNo: true, escalate: false, reason: `HARD NO — expected lens did not run: ${notRun.join(", ")}. A reviewer that did not run is a NO.`, ranked: [] };
  }

  const routes = candidateRoutes(lenses, cfg);
  if (routes.length === 0) {
    return { winner: null, hardNo: false, escalate: false, reason: "quiet — no confirmed candidate route above the consensus floor.", ranked: [] };
  }

  const ranked = [];
  let sawOwnerGated = false;
  for (const r of routes) {
    if (alreadyProposed.has(r.key)) continue; // churn dedup
    const consensus = r.byLens.some((n) => cfg.vetoLenses.includes(n)) || r.byLens.length >= 2;
    if (!consensus) continue; // below the floor
    if (vetoedRoute(r, lenses, cfg)) continue; // a veto BLOCK touches it
    const tier = classifyDiff(r.files).tier;
    if (tier !== "autonomous") { sawOwnerGated = true; continue; } // escalate, never auto-pick
    ranked.push(r);
  }

  // Rank: fewest residual warnings, then smallest diff (fewest files), then most lens-confirmations.
  ranked.sort((a, b) => a.warnings - b.warnings || a.files.length - b.files.length || b.byLens.length - a.byLens.length);

  if (ranked.length === 0) {
    if (sawOwnerGated) {
      return { winner: null, hardNo: false, escalate: true, reason: "escalate — the only candidate route(s) touch owner-gated surfaces; a human decides.", ranked: [] };
    }
    return { winner: null, hardNo: false, escalate: false, reason: "quiet — candidates existed but none cleared consensus + veto + autonomous-tier.", ranked: [] };
  }
  return { winner: ranked[0], hardNo: false, escalate: sawOwnerGated, reason: `winner: ${ranked[0].key} (${ranked[0].files.length} file(s), ${ranked[0].byLens.length} lens confirmation(s))`, ranked };
}

function selfTest() {
  const lens = (name, findings, extra = {}) => ({ lens: name, lane: "cloud", ran: true, verdict: "WARNING", findings, ...extra });
  const finding = (file, extra = {}) => ({ file, category: "correctness", verdict: "CONFIRMED", confidence: 0.9, ...extra });
  const expected = ["code-reviewer", "signalgrid-reviewer", "fail-closed-auditor"];
  const okFile = "docs/GLOSSARY.md"; // autonomous per classifyDiff
  const gatedFile = "scripts/mutation-guard.mjs"; // SAFETY_MACHINERY per classifyDiff

  const fullBoard = (routeFile) => [
    lens("code-reviewer", [finding(routeFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", [finding(routeFile, { proposedRoute: "fix-fossil" })]),
    lens("fail-closed-auditor", []),
  ];

  let fail = 0;
  const check = (name, cond) => { if (!cond) { console.error("SELF-TEST FAIL:", name); fail = 1; } };

  // 1. Happy path: two lenses confirm an autonomous route, no veto → winner.
  const happy = decide({ lenses: fullBoard(okFile), expected });
  check("happy path picks a winner", happy.winner && happy.winner.key === "fix-fossil" && !happy.hardNo);

  // 2. Veto BLOCK on the route → not eligible, open nothing.
  const vetoed = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("fail-closed-auditor", [{ file: okFile, category: "fail-open", verdict: "BLOCK", confidence: 0.95 }], { verdict: "BLOCK" }),
  ], expected });
  check("a veto BLOCK opens nothing", vetoed.winner === null && !vetoed.hardNo);

  // 3. ran:false expected lens → HARD NO. (The un-gated trust anchor, both directions.)
  const boardMissing = fullBoard(okFile).map((l) => l.lens === "fail-closed-auditor" ? { ...l, ran: false } : l);
  const hardNo = decide({ lenses: boardMissing, expected });
  check("a ran:false expected lens is a HARD NO", hardNo.winner === null && hardNo.hardNo === true);
  // ...and the SAME board with the lens actually run is NOT a hard no (proves the arm is real, not always-on).
  check("the same board with the lens run is not a hard no", decide({ lenses: fullBoard(okFile), expected }).hardNo === false);

  // 4. Owner-gated route → escalate, never auto-pick.
  const gated = decide({ lenses: fullBoard(gatedFile), expected });
  check("an owner-gated route escalates, opens nothing", gated.winner === null && gated.escalate === true);

  // 5. Lone unconfirmed (single non-veto lens) → below consensus floor.
  const lone = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", []),
    lens("fail-closed-auditor", []),
  ], expected });
  check("a lone unconfirmed finding is below the floor", lone.winner === null);
  // ...but one veto-lens confirmation alone DOES meet the floor.
  const vetoConfirms = decide({ lenses: [
    lens("code-reviewer", []),
    lens("signalgrid-reviewer", []),
    lens("fail-closed-auditor", [finding(okFile, { proposedRoute: "fix-fossil" })]),
  ], expected });
  check("a single veto-lens confirmation meets the floor", vetoConfirms.winner && vetoConfirms.winner.key === "fix-fossil");

  // 6. Already-proposed route → deduped, not re-picked.
  const dedup = decide({ lenses: fullBoard(okFile), expected, alreadyProposed: new Set(["fix-fossil"]) });
  check("an already-proposed route is deduped", dedup.winner === null);

  // 7. Below-confidence finding does not count.
  const lowConf = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "fix-fossil", confidence: 0.4 })]),
    lens("signalgrid-reviewer", [finding(okFile, { proposedRoute: "fix-fossil", confidence: 0.4 })]),
    lens("fail-closed-auditor", []),
  ], expected });
  check("a below-min-confidence finding does not count", lowConf.winner === null);

  if (fail) return 1;
  console.log("brain-cycle-decide self-test: happy/veto/hardNo(+live)/owner-gated/floor(+veto)/dedup/low-conf — all green");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  console.error("brain-cycle-decide is a library; run with --self-test, or import { decide }.");
  process.exit(2);
}
