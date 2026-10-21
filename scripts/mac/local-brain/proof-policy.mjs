/**
 * SignalGrid Local Brain: proof policy assessment.
 *
 * Returns 'review' only when:
 * - exitCode === 0
 * - tests > 0
 * - pass === tests
 * - fail === 0
 * - skipped === 0
 * - changedFiles is a nonempty array of safe file paths entirely in allowedScope
 * - command is a nonempty string
 * Otherwise returns 'blocked'.
 */

const SAFE_PATH_RE = /^(?:[a-zA-Z0-9_\-\.]+\/)*[a-zA-Z0-9_\-\.]+$/;

function isSafePath(path) {
  if (typeof path !== 'string' || !path.trim()) return false;
  const parts = path.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part.startsWith('..') || part.startsWith('.') && part.length > 1) {
      return false;
    }
  }
  return SAFE_PATH_RE.test(path);
}

function isInScope(paths, scope) {
  for (const path of paths) {
    if (!isSafePath(path)) return false;
    const normalized = path.replace(/\/+/g, '/');
    const parts = normalized.split('/');
    const scopeParts = scope.split('/');
    if (parts.length < scopeParts.length) return false;
    for (let i = 0; i < scopeParts.length; i++) {
      if (parts[i] !== scopeParts[i]) return false;
    }
  }
  return true;
}

export function assessProof(proof, allowedScope) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof) || !isSafePath(allowedScope)) return 'blocked';
  const { exitCode, tests, pass, fail, skipped, command, changedFiles } = proof;

  if (exitCode !== 0) return 'blocked';
  if (!Number.isSafeInteger(tests) || tests <= 0) return 'blocked';
  if (pass !== tests) return 'blocked';
  if (fail !== 0) return 'blocked';
  if (skipped !== 0) return 'blocked';
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return 'blocked';
  if (typeof command !== 'string' || !command.trim()) return 'blocked';

  const allSafe = changedFiles.every(isSafePath);
  if (!allSafe) return 'blocked';

  const allInScope = isInScope(changedFiles, allowedScope);
  if (!allInScope) return 'blocked';

  return 'review';
}
