// Shell lint gate — the one language in this repo with no static analysis.
//
// CodeQL takes JS/TS, `tsc` takes types, gitleaks takes secrets, 55 proofs take
// behaviour. Shell had nothing, and the shell here is not incidental: it includes
// `validate-sim-macos.sh`, which IS the full local suite the Mac lane runs in CI.
//
// WHY A SEVERITY FLOOR RATHER THAN "ALL CLEAN". A gate introduced at zero findings
// on day one is a gate nobody has to think about; a gate introduced with a backlog
// gets a suppression file and then gets ignored. This starts at `warning`, which the
// tree already satisfies, so the FIRST failure is a real regression rather than
// inherited debt. The notes are visible with `--all` and are worth reading, but they
// do not fail a pull request.
//
// The rule this most exists to hold is SC2164 — `cd somewhere` with no `|| exit`.
// A failed `cd` does not stop a script that lacks `set -e`; it keeps running in the
// wrong directory and still prints its summary. That is a status reported rather
// than measured, which is the defect class this repo spends most of its effort on.
import { spawnSync } from "node:child_process";

const ALL = process.argv.includes("--all");
const SEVERITY = ALL ? "style" : "warning";

// FILES ANOTHER LANE OWNS — deferred, NOT excluded, and self-invalidating.
//
// `validate-sim-macos.sh` is the Mac lane's per docs/LANE_COORDINATION.md (its row
// names the file explicitly), and that lane touched it two commits ago. Editing it
// from the cloud lane is the eight-file collision this repo already paid for once.
//
// So its findings are recorded here WITH their codes rather than the file being
// dropped from the scan. Two consequences, both deliberate:
//   · a NEW code appearing in a deferred file still FAILS — the deferral covers
//     what was measured, not the file forever;
//   · a deferred file that becomes CLEAN also fails, because a stale exemption
//     re-permits the gap it was granted for and reads as intentional ever after.
//     That is the rule `check-guard-registries.mjs` established and KNOWN_GAPS
//     proved on a real fix.
const DEFERRED = new Map([
  [
    "validate-sim-macos.sh",
    {
      codes: ["SC2164", "SC2010"],
      reason: "Mac lane owns this file (LANE_COORDINATION.md); coordinate before editing",
    },
  ],
]);

const listed = spawnSync("git", ["ls-files", "*.sh"], { encoding: "utf8" });
if (listed.status !== 0) {
  console.error("✗ could not list shell files");
  process.exit(1);
}
const files = listed.stdout.split("\n").filter(Boolean);

// NON-VACUITY. A glob that matched nothing would make this gate pass forever while
// checking not one line — the shape of "green because nothing ran" this repo treats
// as a failure, not a pass.
if (files.length === 0) {
  console.error("✗ no shell files matched — the gate would be vacuously green");
  process.exit(1);
}

const probe = spawnSync("shellcheck", ["--version"], { encoding: "utf8" });
if (probe.status !== 0) {
  // Not installed is NOT a pass. A skipped check that prints nothing reads exactly
  // like a check that ran and found nothing.
  console.error("✗ shellcheck is not installed — install it (apt-get install shellcheck) or run in CI");
  process.exit(1);
}

const run = spawnSync(
  "shellcheck",
  ["-x", `--severity=${SEVERITY}`, "-f", "gcc", ...files],
  { encoding: "utf8" },
);
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
const findings = out ? out.split("\n").filter((l) => /: (error|warning|note|style):/.test(l)) : [];

// Split findings into deferred (owned elsewhere, codes already recorded) and live.
const parse = (line) => {
  const file = line.split(":")[0];
  const code = (line.match(/\[(SC\d+)\]/) ?? [])[1] ?? "";
  return { file, code, line };
};
const parsed = findings.map(parse);
const live = parsed.filter((f) => !DEFERRED.get(f.file)?.codes.includes(f.code));

// A deferral that no longer describes anything is itself a finding.
const stale = [];
for (const [file, { codes }] of DEFERRED) {
  const seen = new Set(parsed.filter((f) => f.file === file).map((f) => f.code));
  for (const code of codes) {
    if (!seen.has(code)) stale.push(`${file} no longer reports ${code} — remove it from DEFERRED`);
  }
}
if (stale.length > 0) {
  console.error("✗ stale deferrals — an exemption that outlived its subject re-permits the gap:");
  for (const s of stale) console.error(`  - ${s}`);
  process.exit(1);
}

if (live.length > 0) {
  console.error(live.map((f) => f.line).join("\n"));
  console.error(
    `\nShell lint FAILED: ${live.length} finding(s) at severity ${SEVERITY}+ across ${files.length} file(s).`,
  );
  console.error("Fix them, or justify an exception with an inline `# shellcheck disable=SCxxxx` AND a reason.");
  process.exit(1);
}

const deferredCount = parsed.length - live.length;
console.log(`Shell lint passed — ${files.length} script(s) clean at severity ${SEVERITY} and above.`);
if (deferredCount > 0) {
  console.log(`  ${deferredCount} finding(s) DEFERRED, not ignored:`);
  for (const [file, { codes, reason }] of DEFERRED) console.log(`    · ${file} [${codes.join(", ")}] — ${reason}`);
}
if (!ALL) console.log("  (run with --all to see style/info notes, which do not gate)");
