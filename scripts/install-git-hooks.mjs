#!/usr/bin/env node
// Point git at the repo's committed hooks. Runs from the `prepare` lifecycle, so a
// fresh clone gets them on the first `pnpm install` with nothing to remember.
//
// `.git/hooks` is NOT version-controlled, which is why a hook placed there protects
// exactly one machine and silently protects nobody else. `core.hooksPath` moves the
// hook directory into the tree, so the guard travels with the repo.
//
// Deliberately quiet and deliberately non-fatal: a `prepare` script that can fail
// makes `pnpm install` fail, which would be a far worse outcome than an uninstalled
// hook. Every branch below exits 0.
//
//   node scripts/install-git-hooks.mjs

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// CI checks out fresh and never pushes from the workspace, so the hook has nothing
// to guard there — and rewriting git config on a runner is noise at best.
if (process.env.CI) process.exit(0);

try {
  // A tarball install or a vendored copy has no .git; nothing to configure.
  if (!existsSync(resolve(repo, ".git"))) process.exit(0);
  if (!existsSync(resolve(repo, ".githooks/pre-push"))) process.exit(0);

  const current = (() => {
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: repo, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();

  if (current === ".githooks") process.exit(0);

  // Never silently override a hooks path someone else configured deliberately.
  if (current && current !== ".githooks") {
    console.log(`[hooks] core.hooksPath is already "${current}" — leaving it alone.`);
    process.exit(0);
  }

  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: repo });
  console.log("[hooks] pre-push enabled (lockfile check, ~0.5s). Bypass with --no-verify.");
} catch {
  // Not a git checkout, git unavailable, read-only config — none of these are worth
  // failing an install over.
}
process.exit(0);
