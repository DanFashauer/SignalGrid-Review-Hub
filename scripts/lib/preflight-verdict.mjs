// Pure verdict for ONE finished preflight step. preflight.mjs cannot be imported (it runs
// every step on load), so the classification lives here where
// `check-preflight-ci-parity.mjs --self-test` — already in preflight and CI — can drive it.
//
// Exit 0 is not evidence. Three ways a step exits 0 without having verified anything, or
// while holding a finding, were all printed as a bare "ok":
//   · it SELF-SKIPPED (its input env var unset) — `skipped-env`, or `failed` when the
//     declaration and the behaviour disagree (no SKIPPED printed);
//   · it could not READ what it checks and said so (`REPORTED — could not read …`, the
//     locally-reported form of a check that is fatal in CI) — `unverified`;
//   · it read fine and REPORTED a finding it does not fail on (the step's `surface` regex
//     names that line, e.g. a red-streak count) — `reported`.
//
// The last two are OPT-IN: only a step that declares a `surface` — i.e. says it is
// report-only — can come back `unverified` or `reported`. Every other step exits 0 as `ok`,
// whatever it printed: a self-test that passes may well print a `REPORTED — could not read …`
// line from a fake-fetch case, and calling that step unverified would be a false entry in
// the block whose job is to be trusted.
//
// A fourth way, closed here: a `--self-test` step that exits 0 WITHOUT printing its pass line
// (a module that skips its own body — the symlinked-start defect, a broken guard helper — exits 0
// with no output). Every `--self-test` step now carries an `expect`: a regex the output must
// contain, defaulting to SELF_TEST_EXPECT, overridable per script. No match ⇒ `failed`.
// The SAME function (expectFor) is what scripts/lib/expect-output.mjs applies to the CI step, so
// preflight and CI cannot disagree about what a passing self-test looks like.
//
// Returns { verdict: "ok" | "skipped-env" | "unverified" | "reported" | "failed", line?, reason? }.
// `line` is the matching output line (trimmed) for `unverified` and `reported`;
// `reason` is "missing-expect" when a step exited 0 without the output it must print.

const UNREAD = /^REPORTED — could not read/;

// The pass line a self-test prints. Self-tests are not uniform ("self-test passed (N/N)", "PASS  self-test",
// "N/N passed", "OK: N/N self-test cases …"), so this is the union of those shapes, measured against all
// 148 `--self-test` steps on 2026-11-19. It is deliberately a pass-SHAPED line, not any mention of
// "self-test": a line that only names the self-test (a banner, a usage string) does not satisfy it.
export const SELF_TEST_EXPECT =
  /self-?test[^\n]*(?:pass|green|\bok\b|✓|\d+\/\d+)|(?:pass|green|✓)[^\n]*self-?test|\d+\/\d+ (?:[\w-]+ )*(?:passed|self-?test)|PASS\s+\d+\/\d+|self-?test:\s*\d+\/\d+/i;

// Per-script overrides, for a self-test whose pass line has another shape. Empty today: the default
// covers every current step. Add a row here (script path -> RegExp), never loosen the default.
export const SELF_TEST_EXPECT_OVERRIDES = new Map();

/** The regex a finished step's output must contain, or null when the step declares none.
 *  `cmd` is the argv ([bin, script, ...args]); an explicit `declared` regex wins. A `--self-test`
 *  command always has one, so adopting it is not opt-in. */
export function expectFor(cmd, declared) {
  if (declared instanceof RegExp) return declared;
  if (!Array.isArray(cmd) || !cmd.includes("--self-test")) return null;
  const script = cmd.find((a, i) => i > 0 && /\.(?:mjs|sh|py)$/.test(a));
  return (script && SELF_TEST_EXPECT_OVERRIDES.get(script)) || SELF_TEST_EXPECT;
}

export function classifyStep({ status, combined, selfSkipsWithout, envSet, surface, expect }) {
  if (status !== 0) return { verdict: "failed" };
  if (selfSkipsWithout && !envSet) return { verdict: /\bSKIPPED\b/.test(combined) ? "skipped-env" : "failed" };
  // search(), not test(): an expect with the g/y flag would carry lastIndex between calls.
  if (expect && combined.search(expect) === -1) return { verdict: "failed", reason: "missing-expect" };
  if (!surface) return { verdict: "ok" };
  const lines = combined.split("\n");
  const unread = lines.find((l) => UNREAD.test(l));
  if (unread) return { verdict: "unverified", line: unread.trim() };
  // search(), not test(): a surface with the g flag would carry lastIndex between lines.
  const hit = lines.find((l) => l.search(surface) !== -1);
  if (hit) return { verdict: "reported", line: hit.trim() };
  return { verdict: "ok" };
}
