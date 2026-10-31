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
// Returns { verdict: "ok" | "skipped-env" | "unverified" | "reported" | "failed", line? }.
// `line` is the matching output line (trimmed) for `unverified` and `reported`.

const UNREAD = /^REPORTED — could not read/;

export function classifyStep({ status, combined, selfSkipsWithout, envSet, surface }) {
  if (status !== 0) return { verdict: "failed" };
  if (selfSkipsWithout && !envSet) return { verdict: /\bSKIPPED\b/.test(combined) ? "skipped-env" : "failed" };
  if (!surface) return { verdict: "ok" };
  const lines = combined.split("\n");
  const unread = lines.find((l) => UNREAD.test(l));
  if (unread) return { verdict: "unverified", line: unread.trim() };
  // search(), not test(): a surface with the g flag would carry lastIndex between lines.
  const hit = lines.find((l) => l.search(surface) !== -1);
  if (hit) return { verdict: "reported", line: hit.trim() };
  return { verdict: "ok" };
}
