// Reading a ratchet: genesis has to be PROVEN, never assumed from a failure.
//
// THE DEFECT (found 2026-09-06, in two gates at once). Both `check-doc-orphans.mjs`
// and `check-launch-claims.mjs` read their ceiling like this:
//
//     let prior = {};
//     try { prior = JSON.parse(readFileSync(CEILING, "utf8")); } catch { prior = {}; }
//     const ceiling = prior.someCount;
//
// and then wrote today's count as the new baseline whenever `ceiling` was not a
// number. So a ceiling file that was CORRUPT, UNREADABLE or DELETED was treated as
// "no ceiling yet" — the rise branch could not fire, the gate printed
// "baseline recorded at N" and exited 0, and the ratchet was silently re-armed at
// whatever today's debt happened to be. The comment above one of those arms claimed
// the opposite in the strongest terms ("an unreadable ceiling can never silently
// authorise a rise"), which is how it survived review.
//
// Reproduced end to end in a scratch tree: doc-orphan pin at `maxOrphans: 0`, two
// orphans present → exit 1 (correct). Same tree, pin replaced with `{ this is not
// json` → exit 0, "pin set: maxOrphans=2", ceiling raised 0 → 2.
//
// THE RULE. Four outcomes, and only one of them may rebaseline:
//   · read + parsed + carries the numeric key  → USE the ceiling.
//   · ENOENT and `git log -- <path>` is EMPTY  → GENESIS. Honestly the first run.
//   · ENOENT and the path HAS git history      → REFUSE. A deleted ceiling is not a
//                                                first run; restore it from git.
//   · anything else (parse error, EACCES, a
//     parsed value missing its key)            → REFUSE. Unknown is not absent.
//
// The two halves are borrowed from the gates that already got this right:
// `check-backlog-evidence.mjs:199-207` (ENOENT vs parse-error split) and
// `generate-core-normalization-version.mjs:364-377` (git history as the genesis
// proof, failing CLOSED when git cannot answer).
//
// This module deliberately says NOTHING about whether a ceiling's VALUE is correct,
// and nothing about when a drop should be recorded. It answers one question: may
// this read be treated as "there is no ceiling yet"?

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Pure: what a ratchet read MEANS, given the error code and whether the path has
 * git history. Every branch is reachable from the self-tests of both consumers.
 *
 * @param {{errCode: string|null, hasGitHistory: boolean}} o
 * @returns {{action: "use"|"genesis"|"refuse", why?: string}}
 */
export function ratchetAction({ errCode, hasGitHistory }) {
  if (errCode === null) return { action: "use" };
  if (errCode === "ENOENT") {
    return hasGitHistory
      ? {
          action: "refuse",
          why: "absent from the working tree but PRESENT in git history — a deleted ceiling is not a first run",
        }
      : { action: "genesis", why: "no such file and no git history for it — genuinely the first run" };
  }
  if (errCode === "ESHAPE") {
    return { action: "refuse", why: "parsed, but does not carry the numeric key this ratchet is made of" };
  }
  return { action: "refuse", why: `could not be read as JSON (${errCode}) — an unknown ceiling is not an absent ceiling` };
}

/**
 * Has this path ever existed in git history? Fails CLOSED: if git cannot answer —
 * no git on PATH, not a repository, a pathspec it rejects — we cannot ESTABLISH
 * that the file is new, and "this is the first run" is not a thing to assume,
 * because assuming it authorises a fresh baseline. Report history as present.
 */
export function gitHasHistory(path, cwd = repoRoot) {
  try {
    return (
      execFileSync("git", ["log", "--oneline", "-1", "--", path], {
        cwd,
        encoding: "utf8",
        maxBuffer: 1 << 20,
      }).trim().length > 0
    );
  } catch {
    return true;
  }
}

/**
 * The real read. One syscall, no check-then-read race (CodeQL flagged the two-step
 * form as high severity on `check-backlog-evidence.mjs`, and it is wrong on its own
 * terms: the file can vanish between the check and the read).
 *
 * `key` is the numeric field the ratchet is made of; a file that parses but does not
 * carry it as a number is REFUSED rather than silently read as `undefined`, which
 * `typeof ceiling === "number"` would then have turned into a rebaseline.
 *
 * @param {string} path absolute path to the ratchet JSON
 * @param {string} key the numeric field
 * @param {(p: string) => boolean} hasHistory injectable for the self-tests
 */
export function readRatchetFile(path, key, hasHistory = gitHasHistory) {
  let value = null;
  let errCode = null;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || typeof value[key] !== "number") errCode = "ESHAPE";
  } catch (err) {
    errCode = err && err.code === "ENOENT" ? "ENOENT" : (err && err.code) || "EPARSE";
  }
  const verdict = ratchetAction({ errCode, hasGitHistory: errCode === "ENOENT" ? hasHistory(path) : false });
  return { ...verdict, errCode, value: verdict.action === "use" ? value : null };
}

/** The refusal message every consumer prints, so the two cannot drift apart. */
export function refusalLines(relPath, why, updateHint) {
  return [
    `✗ ${relPath}: ${why}.`,
    "  Refusing to treat an unreadable ceiling as no ceiling — that would record today's count as",
    "  the new baseline and turn a failing build green. Restore it from git:",
    `    git checkout -- ${relPath}`,
    ...(updateHint ? [`  or, if you mean to re-baseline deliberately: ${updateHint}`] : []),
  ];
}
