// role-work-queue.mjs — what each role should read next, derived not guessed.
//
//   node scripts/role-work-queue.mjs                 # every role, worst gap first
//   node scripts/role-work-queue.mjs <role-id>       # one role's ordered queue
//   node scripts/role-work-queue.mjs --self-test
//
// WHY THIS EXISTS. `check-surface-ownership.mjs` proves every file has an owner:
// 2,347 tracked, 0 unowned. `check-review-coverage.mjs` reports that 389 of them
// have actually been READ by that owner. Both numbers were true at once, and the
// distance between them is the whole problem — assignment is complete, scanning
// is at 17%, and "assigned" reads like "handled" to anyone who only sees the
// first gate.
//
// Every defect found on 2026-08-25 — an audit ledger that could fingerprint two
// records identically, an IdP key rotation that took authentication down for ten
// minutes, a contract advertising six evidence sources and implementing two —
// came out of the 17% that had been read. None came from a gate. The unread 83%
// is not known-good; it is unexamined, and those are different words.
//
// So this turns the gap into a work list. For each role: the files it owns, the
// files it has read, and the remainder ORDERED so the next shift starts at the
// highest-consequence file rather than wherever somebody's eye landed.
//
// REPORTED, NEVER FATAL. A queue that fails the build would make the honest act
// of declaring a new surface into a red build, which is how a repository learns
// to declare less. The ratchet in `check-review-coverage.mjs` is what holds the
// number; this says where to spend the next hour.
//
// The surface matcher is IMPORTED from check-surface-ownership.mjs rather than
// re-implemented. A second copy of a matching rule is a second source of truth,
// and this repository spent 2026-08-25 fixing two of those.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUSIONS, globToRe } from "./check-surface-ownership.mjs";
import { isReviewable } from "./check-review-coverage.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Consequence ordering. Not a risk model — a reading order, so a shift opens the
 * file where a defect would cost most rather than the first one alphabetically.
 *
 * The launch surface outranks everything because a fail-open there reaches a
 * verdict. Decision and connector code outrank tests, which outrank fixtures and
 * generated output, which outrank prose. Within a tier, larger files first:
 * more lines is more places to hide, and a long file nobody has read is the
 * least examined thing in the tier.
 */
export function consequenceRank(path) {
  // FIRST QUESTION IS WHETHER THERE IS ANYTHING TO READ AT ALL, and the first
  // version of this function did not ask it. Ranking by path prefix alone sent
  // qa-engineer to `.gitkeep` and a tsconfig at the top of its queue, and
  // docs-writer to a PNG — every one of them matched a high-consequence prefix
  // and none of them is reviewable surface. A queue whose first five entries are
  // unreadable is one nobody opens twice.
  //
  // Carriers of logic rank by what they are, not merely where they live. A
  // tsconfig inside the decision core is still a tsconfig.
  if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|swift|kt|kts|rs|sh|bash|py|sql|ya?ml)$/.test(path)) {
    return /\.md$/.test(path) ? 6 : 7; // prose, then everything with no logic in it
  }
  if (/^lib\/signalgrid-core\/src\//.test(path)) return 0;
  if (/^artifacts\/api-server\/src\//.test(path)) return 1;
  if (/^lib\/integrations\/src\/integrations\/(graph|local-authority|device-management-health)\//.test(path)) return 1;
  if (/\.(test|spec)\.[tj]s$/.test(path) || /\/tests?\//.test(path)) return 4;
  if (/^lib\/.*\/src\//.test(path)) return 2;
  if (/^scripts\/.*\.mjs$/.test(path)) return 3;
  if (/^native\/|^firmware\//.test(path)) return 3;
  return 5;
}

export function queueFor(role, tracked, readPaths) {
  const surfaces = (role.surface ?? []).map(globToRe);
  const excl = EXCLUSIONS.map(([g]) => globToRe(g));
  // `isReviewable` is imported from the coverage gate rather than restated, so
  // "what counts as a file somebody must read" has exactly one definition.
  const owned = tracked.filter((f) => isReviewable(f) && surfaces.some((re) => re.test(f)) && !excl.some((re) => re.test(f)));
  const unread = owned.filter((f) => !readPaths.has(f));
  unread.sort((a, b) => consequenceRank(a) - consequenceRank(b) || b.length - a.length || a.localeCompare(b));
  return { id: role.id, activated: Boolean(role.activated), owns: owned.length, read: owned.length - unread.length, unread };
}

function selfTest() {
  const checks = [];
  const tracked = ["lib/signalgrid-core/src/policy.ts", "docs/NOTES.md", "lib/other/src/a.ts", "scripts/x.mjs", "lib/signalgrid-core/tsconfig.json", "artifacts/api-server/src/.gitkeep"];
  const role = { id: "r", surface: ["lib/**", "docs/**", "scripts/**"], activated: true };

  let q = queueFor(role, tracked, new Set());
  // Five of the six fixtures are reviewable; the .gitkeep is not, and is dropped
  // before ranking rather than ranked last.
  checks.push(["a role with nothing read queues every REVIEWABLE file it owns", q.owns === 5 && q.unread.length === 5]);
  checks.push(["a .gitkeep is not queued at all — it is not reviewable surface", !q.unread.includes("artifacts/api-server/src/.gitkeep")]);
  // The defect that motivated the fix: ranking by path prefix put a tsconfig at
  // the very top because it lives inside the decision core. It is still worth
  // reading eventually; it must not outrank the code it configures.
  const iTsconfig = q.unread.indexOf("lib/signalgrid-core/tsconfig.json");
  const iPolicy = q.unread.indexOf("lib/signalgrid-core/src/policy.ts");
  checks.push(["a tsconfig does NOT outrank the core code it configures", iTsconfig > iPolicy]);
  checks.push(["the decision core is ordered FIRST — highest consequence, not alphabetical", q.unread[0] === "lib/signalgrid-core/src/policy.ts"]);
  // Prose ranks after every carrier of logic, and ahead of files with none.
  checks.push(["prose ranks after all code", q.unread.indexOf("docs/NOTES.md") > q.unread.indexOf("scripts/x.mjs")]);
  checks.push(["...and ahead of a file with no logic in it", q.unread.indexOf("docs/NOTES.md") < iTsconfig]);

  q = queueFor(role, tracked, new Set(["lib/signalgrid-core/src/policy.ts"]));
  checks.push(["a file already read leaves the queue", q.read === 1 && !q.unread.includes("lib/signalgrid-core/src/policy.ts")]);

  q = queueFor({ id: "z", surface: [], activated: false }, tracked, new Set());
  checks.push(["a role owning no surface has an empty queue, not a crash", q.owns === 0 && q.unread.length === 0]);

  // Non-vacuity: the ranker must actually discriminate, or every "ordered" claim
  // above passes against a function that returns a constant.
  const ranks = new Set(tracked.map(consequenceRank));
  checks.push(["the ranker discriminates — it is not a constant", ranks.size > 1]);

  const failed = checks.filter(([, k]) => !k);
  for (const [l, k] of checks) console.log(`  ${k ? "✓" : "✗"} ${l}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const readPaths = new Set(JSON.parse(readFileSync(join(repo, "docs/agent/review-coverage.json"), "utf8")).reviews.map((r) => r.path));
const roles = JSON.parse(readFileSync(join(repo, "docs/agent/org-roster.json"), "utf8")).roles;

const only = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
const queues = roles.map((r) => queueFor(r, tracked, readPaths)).filter((q) => q.owns > 0);
queues.sort((a, b) => b.unread.length - a.unread.length);

if (only) {
  const q = queues.find((x) => x.id === only);
  if (!q) {
    console.error(`no role "${only}" owns any surface. Roles with a queue: ${queues.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`${q.id} — owns ${q.owns}, read ${q.read}, ${q.unread.length} unread${q.activated ? "" : "  (NEVER ACTIVATED)"}\n`);
  console.log("Next, highest consequence first:");
  for (const f of q.unread.slice(0, 25)) console.log(`  ${f}`);
  if (q.unread.length > 25) console.log(`  … and ${q.unread.length - 25} more`);
  process.exit(0);
}

const totalUnread = new Set(queues.flatMap((q) => q.unread)).size;
console.log(`Role work queue — ${totalUnread} distinct file(s) owned by somebody and read by nobody.\n`);
console.log("  ROLE                          OWNS  READ  UNREAD  STATE");
for (const q of queues.slice(0, 15)) {
  console.log(
    `  ${q.id.padEnd(29)}${String(q.owns).padStart(4)}${String(q.read).padStart(6)}${String(q.unread.length).padStart(8)}  ${q.activated ? "active" : "NEVER ACTIVATED"}`,
  );
}
console.log(`\n  node scripts/role-work-queue.mjs <role-id>   # that role's ordered queue`);
console.log("  Reported, never fatal. check-review-coverage.mjs holds the number; this says where to spend the next hour.");
