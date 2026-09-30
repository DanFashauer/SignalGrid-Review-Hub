import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Plan row 143. This used to read `PHASE_SUMMARY_FILE ?? "docs/AUTOMATION_PHASE_TEMPLATE.md"`,
// and the variable was set nowhere, so every PR was checked against the archived
// template's own bullet list — which is exactly the list required — and passed,
// whatever the PR said. The workflow now writes the PR body to a file and names it
// here. Unset, missing, empty, or pointing at the template REFUSES: a fallback can
// never read as a pass.
//
// The sections are the live PR template's (`.github/pull_request_template.md`), not
// the archived one's: its "Merge lane" heading appears in no PR template this repo
// ships, so requiring it would fail every honest PR.
const TEMPLATE = "docs/AUTOMATION_PHASE_TEMPLATE.md";
const requiredSections = [
  "Summary",
  "What changed",
  "Validation",
  "Public-safety note",
  "Remaining risks",
];

/** Pure, for the self-test. A section counts when a line starts with it, optionally
 *  behind markdown heading hashes or a bullet — `## Summary` or `- Summary`. */
function missingSections(text: string): string[] {
  return requiredSections.filter(
    (section) => !new RegExp(`(^|\\n)[ \\t]*(#{1,6}[ \\t]+|-[ \\t]*)?${section}\\b`, "i").test(text),
  );
}

type Resolved = { ok: true; path: string } | { ok: false; why: string };
function resolveSummary(repoRoot: string, env: string | undefined): Resolved {
  if (!env || env.trim() === "") {
    return { ok: false, why: "PHASE_SUMMARY_FILE is unset — there is no summary under review, and no fallback is ever a pass" };
  }
  const path = resolve(repoRoot, env);
  if (path === resolve(repoRoot, TEMPLATE)) {
    return { ok: false, why: `PHASE_SUMMARY_FILE is the static template ${TEMPLATE}; it carries the required list by construction` };
  }
  return { ok: true, path };
}

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

if (process.argv.includes("--self-test")) {
  const full = "## Summary\nx\n## What changed\nx\n## Validation\nx\n## Public-safety note\nx\n## Remaining risks\nx\n";
  const checks: Array<readonly [string, boolean]> = [
    ["a PR body with every live-template heading passes", missingSections(full).length === 0],
    ["the old bullet form still counts", missingSections("- Summary\n- What changed\n- Validation\n- Public-safety note\n- Remaining risks\n").length === 0],
    ["a body with no summary, validation or safety note fails", missingSections("## What changed\nx\n## Remaining risks\nx\n").join() === "Summary,Validation,Public-safety note"],
    ["an empty body fails on every section", missingSections("").length === requiredSections.length],
    ["a heading mentioned mid-line does not count", missingSections(full.replace("## Validation", "see Validation")).includes("Validation")],
    ["unset PHASE_SUMMARY_FILE refuses", !resolveSummary(repoRoot, undefined).ok],
    ["blank PHASE_SUMMARY_FILE refuses", !resolveSummary(repoRoot, "  ").ok],
    ["the static template refuses", !resolveSummary(repoRoot, TEMPLATE).ok],
    ["the static template refuses by absolute path", !resolveSummary(repoRoot, resolve(repoRoot, TEMPLATE)).ok],
    ["a real summary file resolves", resolveSummary(repoRoot, "/tmp/pr-body.md").ok],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`\nphase-summary-check self-test ${failed === 0 ? "pass" : "FAIL"} (${checks.length - failed}/${checks.length})`);
  process.exit(failed === 0 ? 0 : 1);
}

console.log("Phase summary check");
console.log(`required=${requiredSections.join(", ")}`);
const resolved = resolveSummary(repoRoot, process.env.PHASE_SUMMARY_FILE);
if (!resolved.ok) {
  console.error(`summary=refused (${resolved.why})`);
  process.exit(1);
}
console.log(`file=${resolved.path}`);
const text = existsSync(resolved.path) ? readFileSync(resolved.path, "utf8") : "";
if (text.trim() === "") {
  console.error("summary=fail (the summary file is missing or empty)");
  process.exit(1);
}
const missing = missingSections(text);
console.log(`summary=${missing.length === 0 ? "pass" : "fail"}`);
if (missing.length > 0) {
  console.error(`missing=${missing.join(", ")}`);
  process.exitCode = 1;
}
