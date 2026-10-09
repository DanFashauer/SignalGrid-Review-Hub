// scripts/lib/scratch-git.mjs — the one way a self-test spawns git inside a SCRATCH repository.
//
// A gate's --self-test builds a throwaway repo (mkdtemp + git init) and drives git in it. Run from
// a git hook, a worktree helper or a developer's shell, the caller's environment can carry
// GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE, and git then ignores the scratch directory and acts on
// the REAL repository (measured 2026-10-08: check-surface-review-coverage wrote a commit into a
// victim repo this way). A machine whose global config has commit.gpgsign=true with an absent
// signer fails every scratch `git commit` the same way. This helper removes the repo-location
// variables, pins identity (env and `-c`), and sets signing and hooks off by `-c`, which beats any
// config file. "Hermetic" here means exactly that: it does not isolate GIT_CONFIG_GLOBAL/SYSTEM.
//
// What it deliberately does NOT do: blank GIT_CONFIG_GLOBAL or GIT_CONFIG_NOSYSTEM. A caller may
// need to control the global config on purpose (check-gitignore-producers pins GIT_CONFIG_GLOBAL to
// prove a machine-global core.excludesFile is not honoured), and a blanket blank would hide a real
// excludesFile interaction. Pass such a variable through `opts.env`.
//
// For a scratch repo only. A git call against the REAL repository does not belong here.

import { spawnSync } from "node:child_process";

// Every variable `git rev-parse --local-env-vars` lists (git 2.x: 15), plus GIT_NAMESPACE.
export const SCRATCH_GIT_SCRUB = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
]);

// Identity env vars beat `-c user.name`, and an EMPTY one is a fatal "empty ident name"; pin them.
const SCRATCH_IDENTITY = Object.freeze({
  GIT_AUTHOR_NAME: "scratch",
  GIT_AUTHOR_EMAIL: "scratch@invalid",
  GIT_COMMITTER_NAME: "scratch",
  GIT_COMMITTER_EMAIL: "scratch@invalid",
});

/** A copy of `base` without the repo-location variables, plus `extra` (applied last). */
export function scratchGitEnv(base = process.env, extra = {}) {
  const env = { ...base };
  for (const k of SCRATCH_GIT_SCRUB) delete env[k];
  return { ...env, ...SCRATCH_IDENTITY, ...extra };
}

/** `args` behind the identity, signing and default-branch overrides every scratch call needs. */
export function scratchGitArgs(args) {
  return [
    "-c", "commit.gpgsign=false",
    "-c", "tag.gpgsign=false",
    "-c", "user.name=scratch",
    "-c", "user.email=scratch@invalid",
    "-c", "init.defaultBranch=main",
    "-c", "core.hooksPath=/dev/null", // a global hooksPath must not run a hook inside a fixture
    ...args,
  ];
}

/** Run git in `dir` (argv array, never a shell, always a timeout). Returns the spawnSync result. */
export function scratchGit(dir, args, opts) {
  return spawnSync("git", ["-C", dir, ...scratchGitArgs(args)], {
    encoding: "utf8",
    env: scratchGitEnv(process.env, opts?.env),
    timeout: opts?.timeout ?? 60000,
    ...(opts?.input === undefined ? {} : { input: opts.input }),
  });
}

/** scratchGit that throws (with git's stderr) on a non-zero exit; returns trimmed stdout. */
export function scratchGitOk(dir, args, opts) {
  const r = scratchGit(dir, args, opts);
  if (r.error || r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${r.error ? r.error.message : (r.stderr || r.stdout || `exit ${r.status}`)}`.trim());
  }
  return (r.stdout ?? "").trim();
}

/**
 * Delete the repo-location variables from `env` IN PLACE (default: this process). A self-test that
 * calls the gate's own production functions (which spawn plain `git` with a scratch cwd) needs
 * this: those calls cannot be rerouted through scratchGit, and an inherited GIT_DIR would point
 * them at the real repository.
 */
export function scrubProcessGitEnv(env = process.env) {
  for (const k of SCRATCH_GIT_SCRUB) delete env[k];
}
