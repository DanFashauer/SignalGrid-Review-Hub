#!/usr/bin/env node
// Reason-code catalog gate, v2 — rebuilt after the assurance review proved v1
// could not fail: it compared code NAMES only, so every verdict, class,
// worker sentence, section placement and prose count was hand-editable to a
// lie under a green gate, and its fixture cross-check was satisfied by
// construction (the generator repaired the rows before the audit read them).
// The v2 contract is brutal and simple:
//   1. docs/REASON_CODES.md must be BYTE-IDENTICAL to a fresh generation from
//      the engine — every cell in every column is protected at once;
//   2. generation itself fails on parse problems (a non-literal reason-code
//      construction outside the sanctioned tenant pass-through) and on
//      genuine fixture contradictions (checked BEFORE any repair);
//   3. the OpenAPI x-signalgrid-reason-codes list must equal the emit set.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { buildCatalog, buildMarkdown, CODE_LIT, SIMULATOR_ENGINE, SIMULATOR_WRAPPERS } from "./gen-reason-codes.mjs";

const CATALOG = "docs/REASON_CODES.md";
const SPEC = "lib/api-spec/v1-openapi.yaml";
// docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md §2.1 quotes worker-facing copy per code. It
// drifted from the engine on four of its seven rows (plan row 29) because nothing
// compared it: a host-app developer reading §2.1 saw sentences the engine never says.
// Every worker cell there must be byte-equal to the engine's own descriptor text.
const ECOSYSTEM = "docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md";
const ECOSYSTEM_FLOOR = 7;
const FLOOR = 30;
// Bumped DELIBERATELY when the simulator gains a code — never trailed upward to
// whatever today happens to parse. 25 is the measured count at 2026-09-03
// (`node scripts/check-reason-codes.mjs` prints it on every run); the floor exists
// so a parser that quietly collapses to a handful cannot read as agreement, and it
// was 12 while 18 parsed, which is six codes of slack the gate was not watching. It
// rose 18 -> 25 when the remediation-allow wrapper (remediation-allow.ts) joined the
// simulator vocabulary — seven codes the engine never emits (2026-09-03) — and
// 25 -> 31 when the posture-allow wrapper (posture-allow.ts) joined with six more
// (2026-09-05).
const SIM_FLOOR = 31;

// NAMED EXEMPTIONS for simulator↔core codes that differ only by punctuation, case
// or underscore (verdict-core finding V4, 2026-09-02). One concept wearing two
// spellings across two engines is normally a defect — a host-app developer reading
// one catalog and an iOS log reading the other cannot tell they are the same
// finding — so it FAILS by default. An intended pair must be written down HERE,
// with the reason it is intended, and it is printed on every run: an exemption
// nobody sees is the same silence the gate exists to break.
const EXEMPT_NEAR_COLLISIONS = [
  {
    simulator: "DEVICE_NON_COMPLIANT",
    core: "DEVICE_NONCOMPLIANT",
    reason:
      "INTENDED, and not fixable by renaming either side: the simulator's spelling is what " +
      "native/ios/EnterpriseShell/Services/DecisionEngine.swift mirrors byte-for-byte (CLAUDE.md golden rule 1, " +
      "held by scripts/check-decision-port-parity.mjs), and the core's spelling is on the published /v1 vocabulary " +
      "(x-signalgrid-reason-codes) and in the seeded rule tables. Changing either breaks a contract that exists to " +
      "be unbreakable. Recorded here so the divergence is deliberate and visible, never discovered.",
  },
];

export function auditReasonCodes({ catalog, committedMd, specYaml }) {
  const problems = [...catalog.problems, ...catalog.contradictions];
  const { rows } = catalog;
  if (rows.length < FLOOR) {
    problems.push(`vacuity: only ${rows.length} codes parsed from source (floor ${FLOOR}) — the parser, not the engine, changed`);
  }
  const fresh = buildMarkdown(catalog);
  if (committedMd !== fresh) {
    // name the first divergent line so the remedy is obvious
    const a = committedMd.split("\n");
    const b = fresh.split("\n");
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    problems.push(
      `${CATALOG} is not a faithful generation — first divergence at line ${i + 1}: committed ${JSON.stringify((a[i] ?? "<eof>").slice(0, 80))} vs generated ${JSON.stringify((b[i] ?? "<eof>").slice(0, 80))}. Regenerate: node scripts/gen-reason-codes.mjs`,
    );
  }
  // Simulator vocabulary (V4): a collapsed parse must not read as agreement, and a
  // near-collision that nobody has named is a finding, reported as the PAIR.
  const sim = catalog.simulator;
  if (!sim) {
    problems.push("the catalog carries no simulator vocabulary — parseSimulatorVocabulary did not run");
  } else {
    if (sim.codes.length < SIM_FLOOR) {
      problems.push(
        `vacuity: only ${sim.codes.length} simulator reason code(s) parsed from the simulator surface (floor ${SIM_FLOOR}) — the parser, not the source, changed`,
      );
    }
    for (const collision of sim.nearCollisions) {
      const exempt = EXEMPT_NEAR_COLLISIONS.find(
        (e) => e.simulator === collision.simulator && e.core === collision.core,
      );
      if (!exempt) {
        problems.push(
          `near-collision: simulator "${collision.simulator}" and core "${collision.core}" differ only by punctuation/case/underscore — one concept, two spellings, two engines. Rename one, or name the pair with a reason in EXEMPT_NEAR_COLLISIONS.`,
        );
      }
    }
    for (const e of EXEMPT_NEAR_COLLISIONS) {
      if (!sim.nearCollisions.some((c) => c.simulator === e.simulator && c.core === e.core)) {
        problems.push(
          `stale exemption: EXEMPT_NEAR_COLLISIONS names "${e.simulator}"/"${e.core}", which is no longer a near-collision in the tree — delete it, or the next real pair hides behind it`,
        );
      }
    }
  }

  const emitSet = new Set(rows.map((r) => r.code));
  const specList = specYaml.match(/x-signalgrid-reason-codes:\n((?:\s+- [A-Z][A-Z0-9_]{4,}\n)+)/);
  if (!specList) {
    problems.push(`${SPEC} carries no x-signalgrid-reason-codes list — the contract names no engine vocabulary at all`);
  } else {
    const specCodes = new Set([...specList[1].matchAll(/- ([A-Z][A-Z0-9_]{4,})/g)].map((m) => m[1]));
    for (const c of emitSet) if (!specCodes.has(c)) problems.push(`the engine emits ${c}; the OpenAPI x-signalgrid-reason-codes list omits it`);
    for (const c of specCodes) if (!emitSet.has(c)) problems.push(`the OpenAPI x-signalgrid-reason-codes list names ${c}, which no source emits`);
  }
  return problems;
}

// Parse the §2.1 table: `| \`CODE\` | "worker sentence" | operator |`. Fail-closed:
// a missing section, a collapsed table, an unknown code, a code with no engine
// descriptor, or a cell that is not the engine's sentence each FAIL.
export function auditEcosystemWorkerCopy({ catalog, ecosystemMd }) {
  const problems = [];
  const section = /### 2\.1 [^\n]*\n([\s\S]*?)\n### /.exec(ecosystemMd);
  if (!section) return [`${ECOSYSTEM} has no §2.1 section — the worker-copy table cannot be checked`];
  const rows = [...section[1].matchAll(/^\| `([A-Z][A-Z0-9_]{4,})` \| (.*?) \| (.*?) \|$/gm)];
  if (rows.length < ECOSYSTEM_FLOOR) {
    problems.push(`vacuity: only ${rows.length} row(s) parsed from ${ECOSYSTEM} §2.1 (floor ${ECOSYSTEM_FLOOR}) — the parser or the table collapsed`);
  }
  const byCode = new Map(catalog.rows.map((r) => [r.code, r]));
  for (const [, code, cell] of rows) {
    const row = byCode.get(code);
    if (!row) { problems.push(`${ECOSYSTEM} §2.1 names ${code}, which the engine does not emit`); continue; }
    if (!row.worker) { problems.push(`${ECOSYSTEM} §2.1 gives ${code} worker copy, but the engine has no descriptor for it`); continue; }
    const quoted = /^"(.*)"$/.exec(cell);
    const text = quoted ? quoted[1] : cell;
    if (text !== row.worker) {
      problems.push(`${ECOSYSTEM} §2.1 worker cell for ${code} is not the engine's text: ${JSON.stringify(text)} vs ${JSON.stringify(row.worker)} (copy it from ${CATALOG})`);
    }
  }
  return problems;
}

function selfTest() {
  const checks = [];
  const catalog = buildCatalog();
  const committedMd = readFileSync(CATALOG, "utf8");
  const specYaml = readFileSync(SPEC, "utf8");
  let p = auditReasonCodes({ catalog, committedMd, specYaml });
  checks.push(["the committed tree passes", p.length === 0]);
  // Byte-diff catches EVERY mutation class the review executed against v1:
  for (const [label, mutate] of [
    ["a hand-edited VERDICT cell fails", (md) => md.replace("| deny |", "| allow |")],
    ["a hand-edited WORKER sentence fails", (md) => md.replace("Use a different device", "Tap continue to proceed")],
    ["a hand-edited resolution CLASS fails", (md) => md.replace("| manual_only |", "| auto_proposed |")],
    ["a falsified prose COUNT fails", (md) => md.replace(/\*\*\d+ codes\*\*/, "**12 codes**")],
    ["a deleted SECTION fails", (md) => md.replace(/## The descriptor gap, stated[\s\S]*?##/, "##")],
    ["a row MOVED between sections fails", (md) => {
      const line = md.split("\n").find((l) => l.startsWith("| `OFFLINE_STANDING_AGE_UNSTATED`"));
      return line ? md.replace(line + "\n", "").replace("## Draft-policy codes", line + "\n\n## Draft-policy codes") : md;
    }],
  ]) {
    const mutated = mutate(committedMd);
    if (mutated === committedMd) { checks.push([label + " (mutation applied)", false]); continue; }
    p = auditReasonCodes({ catalog, committedMd: mutated, specYaml });
    checks.push([label, p.some((x) => x.includes("not a faithful generation"))]);
  }
  p = auditReasonCodes({ catalog, committedMd, specYaml: specYaml.replace(/x-signalgrid-reason-codes:/, "x-unrelated:") });
  checks.push(["a spec without the engine-code list FAILS", p.some((x) => x.includes("no x-signalgrid-reason-codes"))]);
  p = auditReasonCodes({ catalog: { ...catalog, rows: catalog.rows.slice(0, 5) }, committedMd, specYaml });
  checks.push(["a collapsed parse trips the vacuity floor", p.some((x) => x.includes("vacuity"))]);
  p = auditReasonCodes({ catalog: { ...catalog, contradictions: ["fixture X expects allow for Y, tables produce deny"] }, committedMd, specYaml });
  checks.push(["a fixture contradiction reported by generation FAILS the gate", p.some((x) => x.includes("fixture X"))]);
  // ── simulator vocabulary (V4) ─────────────────────────────────────────────
  checks.push([
    `the live tree's simulator vocabulary parses (${catalog.simulator?.codes.length ?? 0} codes, ${catalog.simulator?.nearCollisions.length ?? 0} near-collision(s))`,
    (catalog.simulator?.codes.length ?? 0) >= SIM_FLOOR,
  ]);
  // A SYNTHETIC near-collision the exemption list does not name must fail.
  //
  // The vector must be a shape the parser can ACTUALLY produce, and the first one
  // written here was not: "TRUST-ESTABLISHED" carries a hyphen, which CODE_LIT's
  // character class excludes, so the self-test was exercising an unreachable
  // string and the gate's real behaviour on a real pair stayed untested. The
  // underscore variant below IS reachable, and the next check proves it against
  // the parser's own regex rather than by eye.
  const SYNTHETIC = { simulator: "TRUST_ESTABLISHED_", core: "TRUST_ESTABLISHED" };
  const litShape = new RegExp(`^${CODE_LIT.source}$`);
  checks.push([
    `the synthetic near-collision vector is a shape CODE_LIT can parse (${SYNTHETIC.simulator})`,
    litShape.test(JSON.stringify(SYNTHETIC.simulator)) && litShape.test(JSON.stringify(SYNTHETIC.core)),
  ]);
  p = auditReasonCodes({
    catalog: {
      ...catalog,
      simulator: {
        ...catalog.simulator,
        nearCollisions: [...catalog.simulator.nearCollisions, SYNTHETIC],
      },
    },
    committedMd,
    specYaml,
  });
  checks.push([
    "an UNNAMED simulator↔core near-collision FAILS the gate, naming the pair",
    p.some((x) => x.includes("near-collision") && x.includes(SYNTHETIC.simulator) && x.includes(SYNTHETIC.core)),
  ]);
  // …and the named one does not, so the exemption is what carries the live pair.
  checks.push([
    "the NAMED exemption (DEVICE_NON_COMPLIANT/DEVICE_NONCOMPLIANT) is the only reason the live tree passes",
    auditReasonCodes({ catalog, committedMd, specYaml }).length === 0 &&
      catalog.simulator.nearCollisions.some(
        (c) => c.simulator === "DEVICE_NON_COMPLIANT" && c.core === "DEVICE_NONCOMPLIANT",
      ),
  ]);
  // An exemption for a pair that is no longer in the tree must be flagged stale.
  p = auditReasonCodes({
    catalog: { ...catalog, simulator: { ...catalog.simulator, nearCollisions: [] } },
    committedMd,
    specYaml,
  });
  checks.push(["a STALE exemption (its pair gone) FAILS the gate", p.some((x) => x.includes("stale exemption"))]);
  // A collapsed simulator parse trips its own floor.
  p = auditReasonCodes({
    catalog: { ...catalog, simulator: { ...catalog.simulator, codes: catalog.simulator.codes.slice(0, 3) } },
    committedMd,
    specYaml,
  });
  checks.push(["a collapsed SIMULATOR parse trips the simulator vacuity floor", p.some((x) => x.includes("simulator reason code(s) parsed"))]);
  // ── §2.1 worker copy (plan row 29) ────────────────────────────────────────
  const ecosystemMd = readFileSync(ECOSYSTEM, "utf8");
  checks.push(["the committed §2.1 worker copy equals the engine", auditEcosystemWorkerCopy({ catalog, ecosystemMd }).length === 0]);
  for (const [label, mutate] of [
    ["restoring an OLD §2.1 worker cell (IDENTITY_DISABLED) FAILS", (md) => md.replace(
      /(\| `IDENTITY_DISABLED` \| )"[^"]*"/, '$1"Your account is disabled. Contact your administrator."')],
    ["a §2.1 row naming a code the engine never emits FAILS", (md) => md.replace("| `POSTURE_STALE` |", "| `DEVICE_POSTURE_STALE` |")],
    ["a collapsed §2.1 table trips its vacuity floor", (md) => md.replace(/^\| `CUSTODY_EXCEPTION` .*\n/m, "")],
    ["a missing §2.1 section FAILS", (md) => md.replace("### 2.1 ", "### 2.x ")],
  ]) {
    const mutated = mutate(ecosystemMd);
    if (mutated === ecosystemMd) { checks.push([label + " (mutation applied)", false]); continue; }
    checks.push([label, auditEcosystemWorkerCopy({ catalog, ecosystemMd: mutated }).length > 0]);
  }
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Direct invocation only — importing this module must not run the gate
// (assurance advisory: an import-time run can exit the importing process).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const catalog = buildCatalog();
  const problems = auditReasonCodes({
    catalog,
    committedMd: readFileSync(CATALOG, "utf8"),
    specYaml: readFileSync(SPEC, "utf8"),
  });
  problems.push(...auditEcosystemWorkerCopy({ catalog, ecosystemMd: readFileSync(ECOSYSTEM, "utf8") }));
  console.log(`Reason-code check — ${catalog.rows.length} engine codes; catalog held to byte-faithful generation`);
  console.log(
    `  simulator vocabulary: ${catalog.simulator.codes.length} code(s) across ${SIMULATOR_ENGINE} + ${SIMULATOR_WRAPPERS.map((w) => w.path).join(" + ")} (${catalog.simulator.simulatorOnly.length} the core never emits) — REPORTED, not a launch surface`,
  );
  for (const c of catalog.simulator.nearCollisions) {
    const exempt = EXEMPT_NEAR_COLLISIONS.find((e) => e.simulator === c.simulator && e.core === c.core);
    console.log(
      `  near-collision ${exempt ? "EXEMPT (named)" : "UNNAMED"}: simulator "${c.simulator}" vs core "${c.core}"${exempt ? ` — ${exempt.reason}` : ""}`,
    );
  }
  if (problems.length > 0) {
    console.error(`Reason-code check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("Reason-code check passed — the committed catalog IS a generation, and the contract names the same vocabulary.");
}
