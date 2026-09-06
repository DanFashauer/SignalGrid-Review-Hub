#!/usr/bin/env node
// Surface ownership — is every file in this repository somebody's?
//
//   node scripts/check-surface-ownership.mjs             # gate: report + ratchet, writes NOTHING
//   node scripts/check-surface-ownership.mjs --write     # move the low-water mark (the SOLE writer)
//   node scripts/check-surface-ownership.mjs --self-test # prove the gate can fail
//
// WHY THIS EXISTS, in the owner's words on 2026-08-24: "scan every single file ...
// then evaluate the roles then activate those roles to match the skills needed to
// complete the necessary tasks and responsibilities."
//
// check-role-coverage.mjs answers "has each role READ its surface". It cannot answer
// the question underneath it: does a surface EXIST for every file? It does not, and
// could not — it iterates ROLES, so a file no role claims is invisible to it. Measured
// on the day this was written: 399 of 2,324 tracked files, 17% of the repository,
// matched no role's surface at all. Among them .claude/ entire — the skills and agents
// that RUN the org — plus two whole applications.
//
// A role cannot review what it does not own. So "nobody is reviewing X" was, for a
// sixth of the tree, not a discipline problem at all: there was nobody to fail to do it.
//
// THE SPLIT, same as every sibling gate:
//   FATAL     — the unowned count going UP. A ratchet, not a bar: a bar invites
//               arguing about the bar, and a ratchet only asks that new code arrives
//               with an owner.
//   REPORTED  — the current unowned set, worst directory first, so the number is
//               visible on every run rather than discovered in a quarterly audit.
//
// EXCLUSIONS ARE DECLARED, NEVER INFERRED. Some files genuinely should not be owned by
// a SignalGrid role: vendored third-party source we do not maintain, and generated
// records that are outputs rather than authored code. Each needs a reason a reader can
// check — an unexplained exclusion is how a gate quietly stops gating. An exclusion
// that stops matching anything is itself reported, so the list cannot fossilise.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER = "docs/agent/org-roster.json";
const RATCHET = "docs/agent/surface-ownership-ratchet.json";

/**
 * Declared not-owned-by-a-ROLE-SURFACE — but never unowned.
 *
 * Each rule is [glob, reason, accountableRole]. The third field exists because the
 * owner said so on 2026-08-24, and he was right: "if the reason is due to no role or
 * skill please acquire that and assign the work". An exclusion whose real reason is
 * "nobody owns this" is the same gap wearing a different label, and the first version
 * of this list had three of them.
 *
 * WHAT CHANGED WHEN THAT WAS RE-EXAMINED, and each was moved OUT of this list into a
 * real role surface:
 *   · third_party/** — 48 files of agents, skills, commands, rules and MCP configs
 *     that this org EXECUTES. VENDORED.md admits they were "surveyed, not audited".
 *     Excluding them as "upstream owns it" was true about authorship and false about
 *     accountability: upstream does not decide whether it is safe for us to run.
 *   · attached_assets/** — 976 lines of enterprise-stack, MDM/UEM and PACS/IAM
 *     convergence research the owner supplied. Excluding it as "a source, not a
 *     maintained surface" meant nobody was accountable for MINING it.
 *   · LICENSE / NOTICE — commercial-counsel existed with zero surfaces the whole time.
 *
 * What legitimately remains here is GENERATED OUTPUT: records a pipeline writes, not
 * source a person authors. Those do not need a reader — but they do need someone
 * accountable for the retention decision, for whether they should be committed at all,
 * and for the pipeline that mints them. So every rule names that role, and the gate
 * FAILS if the name does not resolve in the roster.
 */
export const EXCLUSIONS = [
  ["artifacts/sim-results/**", "generated records of an execution, not authored code", "mac-lane-steward"],
  ["artifacts/sim-requests/**", "generated verification requests; same loop as sim-results", "mac-lane-steward"],
  ["artifacts/live-evidence/**", "generated evidence minted by the Mac lane, not authored source", "mac-lane-steward"],
  ["artifacts/lane-messages/**", "generated cross-lane mail; the protocol is owned, the messages are data", "mac-lane-steward"],
  ["artifacts/agent-heartbeats/**", "generated liveness records written by scheduled routines", "agent-platform-engineer"],
  ["artifacts/build-loop/**", "generated run history appended by the build loop", "devex-tooling-engineer"],
  ["artifacts/connector-emulator/**", "generated emulator results, not authored source", "devex-tooling-engineer"],
  ["artifacts/live-captures/**", "generated vendor-shape captures minted by a live lane", "devex-tooling-engineer"],
  ["artifacts/sbom/**", "generated CycloneDX SBOM, rebuilt by CI on every run", "security-engineer"],
  ["artifacts/scanner-comparison/**", "generated scanner output kept as dated evidence", "security-engineer"],
  ["pnpm-lock.yaml", "generated lockfile; regenerated by pnpm, never hand-edited", "devex-tooling-engineer"],
];

export function globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = esc.replace(/\*\*/g, " ").replace(/\*/g, "[^/]*").replace(/ /g, ".*");
  return new RegExp(`^${body}$`);
}

/** Partition files into owned, declared-excluded and UNACCOUNTED. */
export function partition(files, surfaces, exclusions) {
  const owned = surfaces.map(globToRe);
  const excl = exclusions.map(([g]) => globToRe(g));
  const out = { owned: [], excluded: [], unaccounted: [] };
  for (const f of files) {
    if (owned.some((re) => re.test(f))) out.owned.push(f);
    else if (excl.some((re) => re.test(f))) out.excluded.push(f);
    else out.unaccounted.push(f);
  }
  return out;
}

/** Exclusions matching nothing — a rule kept past its subject is a hole nobody re-reads. */
export function staleExclusions(files, exclusions) {
  return exclusions
    .filter(([g]) => {
      const re = globToRe(g);
      return !files.some((f) => re.test(f));
    })
    .map(([g]) => g);
}

/**
 * Exclusion rules naming a role that does not exist in the roster.
 *
 * FATAL, not reported. An exclusion is a promise that somebody is still accountable for
 * the ground it covers; a promise pointing at a name nobody answers to is exactly the
 * "nobody's problem" this whole gate exists to make impossible.
 */
export function unaccountableExclusions(exclusions, roleIds) {
  return exclusions
    .filter(([, , owner]) => !owner || !roleIds.includes(owner))
    .map(([g, , owner]) => `${g} -> ${owner ?? "(no role named)"}`);
}

/** A count that ROSE is the only fatal condition. */
export function rose(before, now) {
  return typeof before === "number" && now > before;
}

/**
 * How a ratchet read must be classified, given the error code and whether the path has
 * git history. Pure, so `--self-test` drives every branch.
 *
 * WHY THIS IS NOT `existsSync(...) ? JSON.parse(...) : undefined`. It was, and that
 * shape folds three different situations into one: the file is absent because this is
 * the first run, the file is absent because somebody deleted it, and the file is
 * present but corrupt. Only the first is genesis. The other two produced
 * `before === undefined`, and `rose()` — which requires `typeof before === "number"` —
 * then returned false for ANY count, so the gate could not fail and the low-water mark
 * was re-minted at whatever the tree contained. A ratchet whose ceiling can be deleted
 * to reset it is a ratchet in name only.
 */
export function ratchetVerdict({ errCode, hasGitHistory }) {
  if (errCode === null) return { action: "use" };
  if (errCode === "ENOENT") {
    return hasGitHistory
      ? { action: "refuse", why: "absent from the working tree but PRESENT in git history — a deleted low-water mark is not a first run" }
      : { action: "genesis", why: "no such file and no git history for it — genuinely the first run" };
  }
  if (errCode === "ESHAPE") return { action: "refuse", why: "parsed, but carries no numeric `unowned` field — the shape this ratchet is made of" };
  return { action: "refuse", why: `could not be read as JSON (${errCode}) — an unknown ceiling is not an absent ceiling` };
}

/** Has this path ever existed in git history? Fails CLOSED when git cannot answer. */
function pathHasGitHistory(rel) {
  try {
    return execFileSync("git", ["log", "--oneline", "-1", "--", rel], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 20 }).trim().length > 0;
  } catch {
    return true;
  }
}

/** The real read: one syscall, no check-then-read race. */
export function readRatchet(absPath, relPath, hasHistory = pathHasGitHistory) {
  let value = null;
  let errCode = null;
  try {
    value = JSON.parse(readFileSync(absPath, "utf8"));
    if (!value || typeof value !== "object" || typeof value.unowned !== "number") errCode = "ESHAPE";
  } catch (err) {
    errCode = err && err.code === "ENOENT" ? "ENOENT" : (err && err.code) || "EPARSE";
  }
  const verdict = ratchetVerdict({ errCode, hasGitHistory: errCode === "ENOENT" ? hasHistory(relPath) : false });
  return { ...verdict, errCode, unowned: verdict.action === "use" ? value.unowned : null };
}

function tracked() {
  return execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean);
}

function selfTest() {
  const files = [
    "lib/a.ts",
    "third_party/x/y.ts",
    "artifacts/sim-results/r.json",
    "docs/orphan.md",
    "artifacts/app/main.tsx",
  ];
  const surfaces = ["lib/**"];
  const excl = [["third_party/**", "vendored"], ["artifacts/sim-results/**", "generated"]];
  const p = partition(files, surfaces, excl);
  const checks = [
    ["a file inside a role surface is OWNED", p.owned.length === 1 && p.owned[0] === "lib/a.ts"],
    ["a declared-excluded file is not counted as unowned", p.excluded.includes("third_party/x/y.ts")],
    ["a generated-record exclusion works on a nested path", p.excluded.includes("artifacts/sim-results/r.json")],
    ["a file matching NEITHER is UNACCOUNTED — this is the whole point", p.unaccounted.length === 2],
    [
      "...and it names them, so the report is actionable",
      p.unaccounted.includes("docs/orphan.md") && p.unaccounted.includes("artifacts/app/main.tsx"),
    ],
    ["a ** glob crosses directories", globToRe("lib/**").test("lib/deep/nested/x.ts")],
    ["a single * does NOT cross a directory", !globToRe("docs/*.md").test("docs/sub/x.md")],
    ["an exclusion matching nothing is REPORTED as stale", staleExclusions(files, [["gone/**", "r"]]).length === 1],
    ["a live exclusion is not reported stale", staleExclusions(files, [["third_party/**", "r"]]).length === 0],
    ["a RISE in unowned count is fatal", rose(5, 6) === true],
    ["a fall is fine", rose(5, 4) === false],
    ["unchanged is fine", rose(5, 5) === false],
    // `rose(undefined, …)` is false, and that USED to be the whole handling of a
    // missing baseline — which is why an absent or corrupt mark could not fail. It is
    // now unreachable: `runGate` classifies the read first and refuses. Kept as a
    // reminder of why the classifier below has to run BEFORE this comparison.
    ["a non-numeric baseline cannot make `rose` fire, which is why the read is classified first", rose(undefined, 99) === false],
    ["GENESIS: absent AND no git history is the first run", ratchetVerdict({ errCode: "ENOENT", hasGitHistory: false }).action === "genesis"],
    ["DELETED: absent but PRESENT in git history is REFUSED, never genesis", ratchetVerdict({ errCode: "ENOENT", hasGitHistory: true }).action === "refuse"],
    ["CORRUPT: a parse failure is REFUSED, never genesis", ratchetVerdict({ errCode: "EPARSE", hasGitHistory: false }).action === "refuse"],
    ["SHAPE: a file with no numeric `unowned` is REFUSED (undefined would disarm the ratchet)", ratchetVerdict({ errCode: "ESHAPE", hasGitHistory: false }).action === "refuse"],
    ["a readable, well-shaped mark is USED (the classifier is not simply always red)", ratchetVerdict({ errCode: null, hasGitHistory: true }).action === "use"],
    ["LIVE: the committed low-water mark reads as USABLE and carries a number",
      (() => { const r = readRatchet(`${repo}/${RATCHET}`, RATCHET); return r.action === "use" && typeof r.unowned === "number"; })()],
    ["a mark whose file does not parse is refused by the REAL reader, not just the classifier",
      readRatchet(`${repo}/docs/agent/org-roster.json`, "docs/agent/org-roster.json").action === "refuse"],
    ["an exclusion naming a REAL role is accountable",
      unaccountableExclusions([["a/**", "r", "sre"]], ["sre"]).length === 0],
    ["an exclusion naming a role that does not exist is FATAL — the whole point",
      unaccountableExclusions([["a/**", "r", "ghost-role"]], ["sre"]).length === 1],
    ["an exclusion naming NO role at all is fatal — silence is not an owner",
      unaccountableExclusions([["a/**", "r"]], ["sre"]).length === 1],
    ["LIVE: every committed exclusion names a role in the roster",
      unaccountableExclusions(EXCLUSIONS, JSON.parse(readFileSync(`${repo}/${ROSTER}`, "utf8")).roles.map((r) => r.id)).length === 0],
  ];

  // LIVE: the real tree must produce a real partition, or the gate measures nothing.
  const roster = JSON.parse(readFileSync(`${repo}/${ROSTER}`, "utf8")).roles;
  const all = tracked();
  const live = partition(all, roster.flatMap((r) => (Array.isArray(r.surface) ? r.surface : [])), EXCLUSIONS);
  checks.push(["LIVE: the tree partitions into a non-empty owned set", live.owned.length > 0]);
  checks.push([
    "LIVE: owned + excluded + unaccounted accounts for EVERY tracked file",
    live.owned.length + live.excluded.length + live.unaccounted.length === all.length,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (isCli) runGate();

function runGate() {
  const roster = JSON.parse(readFileSync(`${repo}/${ROSTER}`, "utf8")).roles;
  const surfaces = roster.flatMap((r) => (Array.isArray(r.surface) ? r.surface : []));
  const files = tracked();
  const { owned, excluded, unaccounted } = partition(files, surfaces, EXCLUSIONS);

  console.log("Surface ownership — is every file in this repository somebody's?\n");
  console.log(`  tracked files:        ${files.length}`);
  console.log(`  owned by a role:      ${owned.length}`);
  console.log(`  declared-excluded:    ${excluded.length}  (${EXCLUSIONS.length} rules, each with a stated reason)`);
  console.log(`  UNOWNED:              ${unaccounted.length}`);

  if (unaccounted.length > 0) {
    const byDir = new Map();
    for (const f of unaccounted) {
      const d = f.split("/").slice(0, 2).join("/");
      byDir.set(d, (byDir.get(d) ?? 0) + 1);
    }
    console.log("\n  UNOWNED BY DIRECTORY, worst first — nobody can review what nobody owns:");
    for (const [d, n] of [...byDir].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`    ${String(n).padStart(4)}  ${d}`);
    }
    console.log("\n  Fix by giving a role a `surface` glob that covers it, or by adding a DECLARED");
    console.log("  exclusion with a reason. Do not widen a surface a role cannot actually service.");
  }

  const roleIds = roster.map((r) => r.id);
  const unaccountable = unaccountableExclusions(EXCLUSIONS, roleIds);
  if (unaccountable.length > 0) {
    console.error(`\nSurface-ownership check FAILED — ${unaccountable.length} exclusion(s) name no real role:`);
    for (const u of unaccountable) console.error(`  x ${u}`);
    console.error("  An exclusion is a promise that somebody is still accountable for that ground.");
    console.error("  A promise pointing at a name nobody answers to is the gap this gate exists to close.");
    process.exit(1);
  }
  console.log(`  every exclusion names an accountable role: ${[...new Set(EXCLUSIONS.map((e) => e[2]))].sort().join(", ")}`);

  const stale = staleExclusions(files, EXCLUSIONS);
  if (stale.length > 0) {
    console.log(`\n  ⚠ ${stale.length} exclusion(s) matching NO file — a rule kept past its subject:`);
    for (const g of stale) console.log(`    ${g}`);
  }

  // `--write` is the SOLE WRITER of the low-water mark. Until 2026-09-06 every ordinary
  // run wrote it — preflight's, CI's, anybody's — which had two costs. The mark moved
  // without anyone deciding it should (a derivation that broke and reported FEWER
  // unowned files would lock its own error in as the new baseline), and a plain check
  // dirtied a tracked file, which is what `provenance.workingTreeClean` in every
  // sim-result is measuring. A gate reports; a writer writes; they are different verbs.
  const WRITE = process.argv.includes("--write");
  const pin = readRatchet(`${repo}/${RATCHET}`, RATCHET);

  if (WRITE) {
    if (pin.action === "refuse") console.log(`\n  (replacing an unusable low-water mark: ${pin.why})`);
    writeFileSync(
      `${repo}/${RATCHET}`,
      JSON.stringify(
        { note: "Unowned-file low-water mark. Never hand-edit; `check-surface-ownership.mjs --write` writes it.", unowned: unaccounted.length },
        null,
        2,
      ) + "\n",
    );
    console.log(`\n  low-water mark set: unowned=${unaccounted.length}`);
    return;
  }

  if (pin.action === "refuse") {
    console.error(`\nSurface-ownership check FAILED — ${RATCHET}: ${pin.why}.`);
    console.error("  Refusing to treat an unreadable low-water mark as no low-water mark: that would record");
    console.error(`  today's count (${unaccounted.length}) as the new baseline and turn a regression green.`);
    console.error(`  Restore it from git:  git checkout -- ${RATCHET}`);
    process.exit(1);
  }

  if (pin.action === "genesis") {
    console.error(`\nSurface-ownership check FAILED — no low-water mark has ever been recorded (${RATCHET}).`);
    console.error("  A ratchet with no mark measures nothing. Establish it deliberately:");
    console.error("    node scripts/check-surface-ownership.mjs --write");
    process.exit(1);
  }

  const before = pin.unowned;
  if (rose(before, unaccounted.length)) {
    console.error(`\nSurface-ownership check FAILED — unowned files ROSE: ${before} -> ${unaccounted.length}.`);
    console.error("  New code arrived without an owner, or a surface was narrowed out from under files.");
    console.error("  Ownership is allowed to improve and to stand still. It is not allowed to regress.");
    process.exit(1);
  }
  if (unaccounted.length < before) {
    console.log(
      `\n  Unowned FELL from ${before} to ${unaccounted.length}. Re-run with --write to lower the mark so the ` +
        "improvement cannot be undone.",
    );
  }
  console.log(`\nSurface-ownership check passed — unowned did not rise (${unaccounted.length}, mark ${before}).`);
}
