import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const PR_TEMPLATE = ".github/pull_request_template.md";
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
  // A heading quoted inside a code fence is an example, not a section.
  const prose = text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, "");
  return requiredSections.filter(
    (section) => !new RegExp(`(^|\\n)[ \\t]*(#{1,6}[ \\t]+|-[ \\t]*)?${section}\\b`, "i").test(prose),
  );
}

/** The PR template's headings are the whole required list, so a body left exactly as
 *  the template (whitespace aside) would pass on headings alone. It is refused. */
function isUnfilledTemplate(text: string, template: string): boolean {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  return template !== "" && norm(text) === norm(template);
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
    ["headings only inside a code fence do not count", missingSections("```\n" + full + "```\n").length === requiredSections.length],
    ["the unfilled PR template is refused", isUnfilledTemplate("## Summary\n\n-\n", "## Summary\n-")],
    ["a filled body is not the template", !isUnfilledTemplate(full, "## Summary\n-")],
  ];
  // END TO END: the pure checks above can all hold while an exit path is dropped (the
  // row-144 defect shape). Re-run THIS script as a child and read real exit codes.
  const scratch = mkdtempSync(join(tmpdir(), "phase-summary-selftest-"));
  const good = join(scratch, "good.md");
  const bad = join(scratch, "bad.md");
  writeFileSync(good, full);
  writeFileSync(bad, "## Summary\nx\n");
  const rc = (value: string | undefined) => {
    const env = { ...process.env };
    delete env.PHASE_SUMMARY_FILE;
    if (value !== undefined) env.PHASE_SUMMARY_FILE = value;
    return spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], { encoding: "utf8", env }).status;
  };
  const e2e: Array<readonly [string, string | undefined, number]> = [
    ["unset", undefined, 1],
    ["the static template", TEMPLATE, 1],
    ["the unfilled PR template", PR_TEMPLATE, 1],
    ["a missing file", join(scratch, "absent.md"), 1],
    ["a body missing sections", bad, 1],
    ["a complete body", good, 0],
  ];
  for (const [name, value, want] of e2e) {
    const got = rc(value);
    checks.push([`end to end: ${name} exits ${want} (got ${got})`, got === want]);
  }
  rmSync(scratch, { recursive: true, force: true });
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
const prTemplatePath = resolve(repoRoot, PR_TEMPLATE);
if (isUnfilledTemplate(text, existsSync(prTemplatePath) ? readFileSync(prTemplatePath, "utf8") : "")) {
  console.error(`summary=fail (the body is ${PR_TEMPLATE} left unfilled)`);
  process.exit(1);
}
const missing = missingSections(text);
console.log(`summary=${missing.length === 0 ? "pass" : "fail"}`);
if (missing.length > 0) {
  console.error(`missing=${missing.join(", ")}`);
  process.exitCode = 1;
}
