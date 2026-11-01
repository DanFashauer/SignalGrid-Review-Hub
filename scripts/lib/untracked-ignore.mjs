// Which untracked paths verify-all may ignore when it decides whether the MCP checkout is
// dirty. Extracted from scripts/verify-all.mjs so it can be tested (plan row 61).
//
// Known scratch and generated paths do not change which MCP code ran. A lockfile is NOT
// scratch: an untracked uv.lock or poetry.lock changes the resolved dependencies, so it
// must count as untracked source (dirty) — fail-closed.
export const IGNORED_UNTRACKED =
  /(^|\/)(\.venv|venv|node_modules|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|dist|build|\.DS_Store)(\/|$)|\.egg-info(\/|$)/;

/** @param {string} path a `git status --porcelain` path (the part after "?? ") */
export function isIgnoredUntracked(path) {
  return IGNORED_UNTRACKED.test(path);
}
