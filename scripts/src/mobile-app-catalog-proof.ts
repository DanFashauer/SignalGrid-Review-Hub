// Mobile-app-catalog scanner proof — the hardening delta, asserted (intake row 33).
//
// docs/inspiration/MOBILE_APP_CATALOG_AGENT.md preserves the owner's original
// scanner VERBATIM because the intake audit proved, by execution, five defects
// in it: a JWT under a non-secret-shaped key copied into `identifiers` while
// the output stamped `valuesRedacted: true`; a file symlink followed out of the
// scanned root and its content hashed into the report; wall-clock + absolute
// path non-determinism; unescaped `|` in markdown cells; and unbounded reads.
// scripts/mobile-app-catalog/scan.py is the hardened build. This proof drives
// it over a committed adversarial fixture tree and asserts each fix AGAINST THE
// FAILURE the audit reproduced, not against the code's own description.
//
// python3 policy: this proof FAILS when python3 is missing — it never skips.
// A skipped proof reads as green in a summary line, and "the scanner gate ran"
// would then be an unearned affirmative about the exact tool whose job is
// refusing unearned affirmatives. Preflight's header documents the same.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scannerDir = resolve(dirname(fileURLToPath(import.meta.url)), "../mobile-app-catalog");
const goldenJson = readFileSync(join(scannerDir, "golden/repo-scan.golden.json"), "utf8");
const goldenMd = readFileSync(join(scannerDir, "golden/scan.golden.md"), "utf8");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Mobile-app-catalog scanner proof");

const python = (args: string[]): ReturnType<typeof spawnSync> =>
  spawnSync("python3", args, { cwd: scannerDir, encoding: "utf8" });

// ── the never-skip rule, first ────────────────────────────────────────────────
const probe = python(["--version"]);
check(
  "python3 is present — this proof FAILS rather than skips without it",
  probe.error === undefined && probe.status === 0,
);

// ── the scanner's own in-process seam checks ─────────────────────────────────
const self = python(["scan.py", "--selftest"]);
check("scan.py --selftest passes (credential filter, md escape, redact, DOCTYPE refusal)", self.status === 0);

// ── run over the adversarial fixtures, twice, against the committed golden ───
const out1 = mkdtempSync(join(tmpdir(), "mac-scan-1-"));
const out2 = mkdtempSync(join(tmpdir(), "mac-scan-2-"));
try {
  const args = (out: string): string[] => [
    "scan.py", "fixtures", "--max-file-bytes", "8192",
    "--json-out", join(out, "scan.json"), "--md-out", join(out, "scan.md"),
  ];
  const run1 = python(args(out1));
  check("scan over the fixture tree exits 0", run1.status === 0);
  const run2 = python(args(out2));
  const json1 = readFileSync(join(out1, "scan.json"), "utf8");
  const md1 = readFileSync(join(out1, "scan.md"), "utf8");
  const json2 = readFileSync(join(out2, "scan.json"), "utf8");
  const md2 = readFileSync(join(out2, "scan.md"), "utf8");

  check("JSON output is byte-identical to the committed golden", json1 === goldenJson);
  check("markdown output is byte-identical to the committed golden", md1 === goldenMd);
  check(
    "DETERMINISM: a second run is byte-identical (no wall clock, no machine paths)",
    run2.status === 0 && json2 === json1 && md2 === md1,
  );
  // The negative control for the comparison itself: if a tampered report still
  // "equalled" the golden, the three checks above would be vacuous.
  check("the golden comparison can actually fail (tamper detected)", json1.replace("com.signalgrid.fixture", "com.tampered.fixture") !== goldenJson);

  const report = JSON.parse(json1) as {
    findings: Array<{ path: string; artifact_type: string; identifiers: string[]; source_hash: string; errors: string[] }>;
    findingCount: number;
  };
  const everything = json1 + md1;

  // 1 — the credential leak the audit reproduced. The fixture plants a fake JWT
  // under the non-secret-shaped key "session"; v1 emitted it into identifiers.
  check(
    "SECRET LEAK CLOSED: the planted JWT appears NOWHERE in either output",
    !everything.includes("eyJhbGciOiJub25lIiwidHlwIjoiSldUIiwia2lkIjoiZml4dHVyZSJ9"),
  );
  check(
    "…while the legitimate bundle id on the SAME file still surfaces (the filter is not a blanket)",
    report.findings.some((f) => f.path === "good/app.config.json" && f.identifiers.includes("com.signalgrid.fixture")),
  );
  check(
    "secret-shaped VALUES stay redacted (the v1 property that was sound, kept)",
    !everything.includes("this-value-must-read-as-redacted"),
  );

  // 2 — the symlink escape. OUTSIDE_TARGET.json sits outside the scan root; the
  // fixture links to it and to a directory above the root.
  const link = report.findings.find((f) => f.path === "evil/app-escape-link.json");
  check(
    "SYMLINK ESCAPE CLOSED: the file link is refused loudly — no hash, no identifiers, a recorded error",
    link !== undefined && link.artifact_type === "symlink_refused" &&
      link.source_hash === "" && link.identifiers.length === 0 &&
      link.errors.some((e) => e.includes("SymlinkRefused")),
  );
  check("…and the outside file's content leaked into NEITHER output", !everything.includes("com.leaked.through.symlink"));
  check(
    "…and the DIRECTORY symlink was never traversed (no finding path routes through it)",
    report.findings.every((f) => !f.path.includes("app-dirlink/")),
  );

  // 3 — determinism's other half: nothing machine- or time-shaped in the bytes.
  check(
    "no absolute path in either output (repository_root is the label the caller gave)",
    !everything.includes(scannerDir) && !everything.includes("/home/") && !everything.includes("/tmp/"),
  );

  // 4 — DOCTYPE refusal (verified sound in v1, pinned so it cannot regress).
  const doctype = report.findings.find((f) => f.path === "evil/appconfig-doctype-refused.xml");
  check(
    "DOCTYPE xml is refused per-file with a recorded error and zero identifiers",
    doctype !== undefined && doctype.identifiers.length === 0 &&
      doctype.errors.some((e) => e.includes("DOCTYPE")),
  );

  // 5 — the read cap.
  const oversized = report.findings.find((f) => f.path === "evil/oversized-app-notes.md");
  check(
    "READ CAP: the oversized file is recorded loudly with its content never read (no hash, no identifiers)",
    oversized !== undefined && oversized.source_hash === "" &&
      oversized.identifiers.length === 0 &&
      oversized.errors.some((e) => e.includes("SizeCapExceeded")),
  );
  check("…and nothing from inside the oversized file surfaced", !everything.includes("com.oversized.fixture"));

  check("finding count matches the fixture tree (6: 3 good, 3 refusals)", report.findingCount === 6);

  // A missing root is an error, never an empty success — an empty report over a
  // mistyped path is a measurement never taken.
  const missing = python(["scan.py", "no-such-root", "--json-out", join(out1, "x.json"), "--md-out", join(out1, "x.md")]);
  check("a MISSING scan root exits 2 with an error, not an empty green report", missing.status === 2);
} finally {
  rmSync(out1, { recursive: true, force: true });
  rmSync(out2, { recursive: true, force: true });
}

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
console.log("figures=findings=6");
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
