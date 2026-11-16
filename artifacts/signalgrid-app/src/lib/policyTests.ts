/**
 * The server's `passed` flag is `results.every((r) => r.passed)`, which is
 * vacuously `true` on an empty array (`GET /v1/policies/:id/tests` — see
 * `artifacts/api-server/src/routes/v1.ts`). A policy version with zero pinned
 * tests is therefore reported as passing even though nothing ran. This is the
 * single place the console decides how to render that: an empty result set is
 * `"empty"`, never `"passed"`.
 */
export type PolicyTestSetStatus = "passed" | "failing" | "empty";

export function policyTestSetStatus(results: { passed: boolean }[]): PolicyTestSetStatus {
  if (results.length === 0) return "empty";
  return results.every((r) => r.passed) ? "passed" : "failing";
}
