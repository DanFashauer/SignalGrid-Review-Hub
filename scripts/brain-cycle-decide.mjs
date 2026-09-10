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
// AND the whole cycle is a HARD NO (open nothing) when the expected-lens set itself is empty
// or does not name every veto lens (a board that requires no reviewer, or a manifest that
// forgot the safety net, is untrustworthy), or when ANY expected lens is absent, is not
// explicitly ran:true (a record MISSING `ran` is not a pass), is UNVERIFIED, or has ANY
// record for its name that failed to run (last-write-wins must never hide a ran:false lane
// behind a ran:true one). "A reviewer that did not run = NO" lives HERE, in the orchestrator's
// own logic, deliberately not deferred to a gate (there is no gate that asserts a reviewer
// ran; a permanent-condition check gets scrolled past). This is the loop's one un-gated trust
// anchor, so every direction is proven by a planted-defect self-test below.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyDiff } from "./check-owner-gated-surfaces.mjs";

// The two STRUCTURAL veto lenses. This set is a non-negotiable floor: the config file
// (docs/agent/brain-cycle-config.json — itself owner-gated in check-owner-gated-surfaces.mjs)
// may ADD veto lenses but can NEVER remove, empty, or retarget these two. Without this anchor a
// config of {vetoLenses:[]} or {vetoLenses:["code-reviewer"]} would silently disable vetoedRoute()
// and the consensus veto-shortcut, letting a route win past a real security/fail-closed BLOCK.
export const MANDATORY_VETO_LENSES = Object.freeze(["security-reviewer", "fail-closed-auditor"]);

const DEFAULT_CONFIG = {
  vetoLenses: [...MANDATORY_VETO_LENSES],
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
  const keyOf = (f) => f.proposedRoute || `${f.file}::${f.category}`;
  // Pass 1: CONFIRMED findings from lenses that EXPLICITLY ran build the eligible routes.
  // `ran !== true` (not `=== false`) so a record that OMITS `ran` is treated as not-run.
  for (const lens of lenses) {
    if (!lens || lens.ran !== true) continue;
    for (const f of lens.findings || []) {
      if (!counts(f, cfg)) continue;
      const key = keyOf(f);
      if (!routes.has(key)) routes.set(key, { key, files: new Set(), byLens: new Set(), warnings: 0 });
      const r = routes.get(key);
      if (f.file) r.files.add(f.file);
      r.byLens.add(lens.lens);
    }
  }
  // Pass 2: WARNING-verdict findings raise a route's residual-warning count (the ranking
  // tie-break). Kept separate from Pass 1 because `counts()` admits only CONFIRMED findings,
  // so a WARNING verdict can never be tallied inside that loop — the criterion was dead code
  // until this pass. Only warnings attached to an already-eligible route matter.
  for (const lens of lenses) {
    if (!lens || lens.ran !== true) continue;
    for (const f of lens.findings || []) {
      if (f.verdict !== "WARNING") continue;
      const r = routes.get(keyOf(f));
      if (r) r.warnings += 1;
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
  // Anchor the veto set to the mandatory floor: config may WIDEN it, never shrink/blank/retarget
  // it. An empty, undefined, or bogus config.vetoLenses can therefore never disable the real
  // security-reviewer / fail-closed-auditor vetoes. (belt to the config file being owner-gated.)
  const providedVeto = Array.isArray(cfg.vetoLenses) ? cfg.vetoLenses : [];
  cfg.vetoLenses = [...new Set([...MANDATORY_VETO_LENSES, ...providedVeto])];
  // A non-finite minConfidence (e.g. a config that omitted the key → undefined) would make
  // counts() reject every finding and the cycle go silently "quiet". Fall back to the safe default.
  if (!Number.isFinite(cfg.minConfidence)) cfg.minConfidence = DEFAULT_CONFIG.minConfidence;

  // HARD NO arm 0: an empty expected set means the manifest was absent, unparsable, or named
  // nothing — the board declares no reviewer required, so nothing on it can be trusted. And
  // the expected set MUST name every veto lens; a manifest that forgot the safety net is
  // itself a NO. (readBoard also fails closed on a bad manifest; this is the pure-function
  // backstop for any caller that reaches decide() directly.)
  if (!Array.isArray(expected) || expected.length === 0) {
    return { winner: null, hardNo: true, escalate: false, reason: "HARD NO — empty expected-lens set (missing/unparsable manifest). A board that requires no reviewer is a NO.", ranked: [] };
  }
  const missingVeto = cfg.vetoLenses.filter((v) => !expected.includes(v));
  if (missingVeto.length > 0) {
    return { winner: null, hardNo: true, escalate: false, reason: `HARD NO — the manifest's expected set omits veto lens(es): ${missingVeto.join(", ")}. The safety net must be required to run.`, ranked: [] };
  }

  // Group EVERY record by lens name — NOT last-write-wins — so a duplicate ran:false lane can
  // never be hidden behind a ran:true one of the same name.
  const byName = new Map();
  for (const l of lenses) {
    if (!l || l.lens == null) continue;
    if (!byName.has(l.lens)) byName.set(l.lens, []);
    byName.get(l.lens).push(l);
  }

  // HARD NO arm 1: an expected lens is absent, is not explicitly ran:true (a MISSING `ran` is
  // not a pass), or is UNVERIFIED — checked across ALL of its records. The un-gated trust anchor.
  const notRun = [];
  for (const name of expected) {
    const recs = byName.get(name) || [];
    if (recs.length === 0) { notRun.push(`${name} (absent from board)`); continue; }
    for (const l of recs) {
      if (l.ran !== true) notRun.push(`${name} (ran:${JSON.stringify(l.ran)})`);
      else if (l.verdict === "UNVERIFIED") notRun.push(`${name} (UNVERIFIED)`);
    }
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
  let sawFileless = false;
  for (const r of routes) {
    if (alreadyProposed.has(r.key)) continue; // churn dedup
    const consensus = r.byLens.some((n) => cfg.vetoLenses.includes(n)) || r.byLens.length >= 2;
    if (!consensus) continue; // below the floor
    if (vetoedRoute(r, lenses, cfg)) continue; // a veto BLOCK touches it
    if (r.files.length === 0) { sawFileless = true; continue; } // no diff to classify → cannot prove autonomous → escalate
    const tier = classifyDiff(r.files).tier;
    if (tier !== "autonomous") { sawOwnerGated = true; continue; } // escalate, never auto-pick
    ranked.push(r);
  }

  // Rank: fewest residual warnings, then smallest diff (fewest files), then most lens-confirmations.
  ranked.sort((a, b) => a.warnings - b.warnings || a.files.length - b.files.length || b.byLens.length - a.byLens.length);

  const escalate = sawOwnerGated || sawFileless;
  const escalateReason = () => {
    const bits = [];
    if (sawOwnerGated) bits.push("owner-gated surfaces");
    if (sawFileless) bits.push("a route with no files to classify");
    return `candidate route(s) touch ${bits.join(" and ")}; a human decides.`;
  };

  if (ranked.length === 0) {
    if (escalate) {
      return { winner: null, hardNo: false, escalate: true, reason: `escalate — ${escalateReason()}`, ranked: [] };
    }
    return { winner: null, hardNo: false, escalate: false, reason: "quiet — candidates existed but none cleared consensus + veto + autonomous-tier.", ranked: [] };
  }
  const winReason = `winner: ${ranked[0].key} (${ranked[0].files.length} file(s), ${ranked[0].byLens.length} lens confirmation(s))`;
  // A winner can coexist with a SEPARATE escalation (a different route is owner-gated / fileless).
  // Both facts are returned; the caller must read decision.json, not infer from the exit code alone.
  return { winner: ranked[0], hardNo: false, escalate, reason: escalate ? `${winReason} — but ALSO escalate: ${escalateReason()}` : winReason, ranked };
}

function selfTest() {
  const lens = (name, findings, extra = {}) => ({ lens: name, lane: "cloud", ran: true, verdict: "WARNING", findings, ...extra });
  const finding = (file, extra = {}) => ({ file, category: "correctness", verdict: "CONFIRMED", confidence: 0.9, ...extra });
  // expected MUST name every veto lens (security-reviewer AND fail-closed-auditor) or the whole
  // cycle is a HARD NO — so every board below runs BOTH veto lenses.
  const expected = ["code-reviewer", "signalgrid-reviewer", "security-reviewer", "fail-closed-auditor"];
  const sec = () => lens("security-reviewer", []); // a veto lens that ran clean; required on every board
  const okFile = "docs/GLOSSARY.md"; // autonomous per classifyDiff
  const gatedFile = "scripts/mutation-guard.mjs"; // SAFETY_MACHINERY per classifyDiff

  const fullBoard = (routeFile) => [
    lens("code-reviewer", [finding(routeFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", [finding(routeFile, { proposedRoute: "fix-fossil" })]),
    sec(),
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
    sec(),
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
    sec(),
    lens("fail-closed-auditor", []),
  ], expected });
  check("a lone unconfirmed finding is below the floor", lone.winner === null);
  // ...but one veto-lens confirmation alone DOES meet the floor.
  const vetoConfirms = decide({ lenses: [
    lens("code-reviewer", []),
    lens("signalgrid-reviewer", []),
    sec(),
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
    sec(),
    lens("fail-closed-auditor", []),
  ], expected });
  check("a below-min-confidence finding does not count", lowConf.winner === null);

  // 8. Empty expected set (missing/unparsable manifest) → HARD NO, never a winner. [fail-closed-auditor F1]
  const emptyExpected = decide({ lenses: fullBoard(okFile), expected: [] });
  check("an empty expected set is a HARD NO", emptyExpected.winner === null && emptyExpected.hardNo === true);

  // 9. Expected set that omits a veto lens → HARD NO (the manifest forgot the safety net). [F1]
  const noVetoExpected = decide({ lenses: fullBoard(okFile), expected: ["code-reviewer", "signalgrid-reviewer"] });
  check("expected omitting a veto lens is a HARD NO", noVetoExpected.winner === null && noVetoExpected.hardNo === true);

  // 10. A record that OMITS `ran` is treated as not-run → HARD NO (not a silent pass). [F3]
  const noRanField = fullBoard(okFile).map((l) => {
    if (l.lens !== "fail-closed-auditor") return l;
    const { ran, ...rest } = l; return rest; // drop the ran field entirely
  });
  const missingRan = decide({ lenses: noRanField, expected });
  check("a record missing `ran` is a HARD NO", missingRan.winner === null && missingRan.hardNo === true);

  // 11. Two records for one expected name, one ran:false — must NOT be masked by the ran:true one. [F4]
  const dualLane = [
    ...fullBoard(okFile),
    { lens: "fail-closed-auditor", lane: "mac", ran: false, verdict: "UNVERIFIED", findings: [] },
  ];
  const dual = decide({ lenses: dualLane, expected });
  check("a ran:false duplicate lane is not hidden behind a ran:true one", dual.winner === null && dual.hardNo === true);

  // 12. A confirmed route with NO files (fileless) cannot be classified → escalate, never auto-pick. [F2]
  const filelessLens = (name) => lens(name, [{ category: "process", verdict: "CONFIRMED", confidence: 0.9, proposedRoute: "fileless-route" }]);
  const fileless = decide({ lenses: [
    filelessLens("code-reviewer"), filelessLens("signalgrid-reviewer"), sec(), lens("fail-closed-auditor", []),
  ], expected });
  check("a fileless confirmed route escalates, opens nothing", fileless.winner === null && fileless.escalate === true);

  // 13. An autonomous winner AND a SEPARATE owner-gated route → winner returned WITH escalate:true. [code-reviewer MEDIUM]
  const mixed = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "auto-route" }), finding(gatedFile, { proposedRoute: "gated-route" })]),
    lens("signalgrid-reviewer", [finding(okFile, { proposedRoute: "auto-route" }), finding(gatedFile, { proposedRoute: "gated-route" })]),
    sec(),
    lens("fail-closed-auditor", []),
  ], expected });
  check("a winner alongside an owner-gated route sets escalate:true", mixed.winner && mixed.winner.key === "auto-route" && mixed.escalate === true);

  // 14. The residual-warning tie-break is LIVE: a route with a WARNING finding ranks below a clean one. [code-reviewer HIGH]
  const warnTie = decide({ lenses: [
    lens("code-reviewer", [
      finding(okFile, { proposedRoute: "clean-route" }),
      finding(okFile, { proposedRoute: "warned-route" }),
      { file: okFile, category: "style", verdict: "WARNING", confidence: 0.9, proposedRoute: "warned-route" },
    ]),
    lens("signalgrid-reviewer", [
      finding(okFile, { proposedRoute: "clean-route" }),
      finding(okFile, { proposedRoute: "warned-route" }),
    ]),
    sec(),
    lens("fail-closed-auditor", []),
  ], expected });
  const warnedRoute = warnTie.ranked.find((r) => r.key === "warned-route");
  check("the warnings tie-break ranks the clean route first",
    warnTie.winner && warnTie.winner.key === "clean-route" && warnTie.ranked[0].warnings === 0 && warnedRoute && warnedRoute.warnings === 1);

  // 15. Config CANNOT DISABLE the veto floor: config {vetoLenses:[]} with a real security-reviewer
  //     BLOCK on the route → the BLOCK is still honored, opens nothing. [verification pass, critical]
  const emptyVetoCfg = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("security-reviewer", [{ file: okFile, category: "authz", verdict: "BLOCK", confidence: 0.95 }], { verdict: "BLOCK" }),
    lens("fail-closed-auditor", []),
  ], expected, config: { vetoLenses: [], minConfidence: 0.7 } });
  check("config vetoLenses:[] cannot disable the security-reviewer veto", emptyVetoCfg.winner === null);

  // 16. Config CANNOT RETARGET the veto floor: config {vetoLenses:['code-reviewer']} with a real
  //     fail-closed-auditor BLOCK → still honored (the two structural vetoes are non-negotiable). [critical]
  const retargetVetoCfg = decide({ lenses: [
    lens("code-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    lens("signalgrid-reviewer", [finding(okFile, { proposedRoute: "fix-fossil" })]),
    sec(),
    lens("fail-closed-auditor", [{ file: okFile, category: "fail-open", verdict: "BLOCK", confidence: 0.95 }], { verdict: "BLOCK" }),
  ], expected, config: { vetoLenses: ["code-reviewer"], minConfidence: 0.7 } });
  check("config vetoLenses:['code-reviewer'] cannot disable the fail-closed-auditor veto", retargetVetoCfg.winner === null);

  // 17. A partial config (undefined vetoLenses/minConfidence — what a config file omitting the keys
  //     yields) must NOT crash: the veto floor + default confidence apply, a clean board wins. [medium]
  const partialCfg = decide({ lenses: fullBoard(okFile), expected, config: { vetoLenses: undefined, minConfidence: undefined } });
  check("a partial config (undefined keys) applies the floor+default, no crash", partialCfg.winner && partialCfg.winner.key === "fix-fossil");

  if (fail) return 1;
  console.log("brain-cycle-decide self-test: happy/veto/hardNo(+live)/owner-gated/floor(+veto)/dedup/low-conf/empty-manifest/no-veto/missing-ran/dual-lane/fileless/winner+escalate/warnings-tiebreak/config-empty-veto/config-retarget-veto/config-partial — all green");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  console.error("brain-cycle-decide is a library; run with --self-test, or import { decide }.");
  process.exit(2);
}
