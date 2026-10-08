// Self-test for the compile-time exhaustiveness of the device-management-health proof's
// field domains (scripts/src/lib/dmh-domains.ts).
//
// The mechanism is TYPES, and types are only proven by watching the compiler refuse. So this
// gate copies the real contract types and the real domains module into a scratch directory,
// runs `tsc --noEmit` on the unmodified copy (must be clean), then plants two mutants of the
// contract and requires the compiler to reject each one at the domains module:
//   1. a new judged FIELD added to NormalizedDeviceManagementHealth, no domain written;
//   2. a new MEMBER added to MdmCheckInFreshness, left out of that field's tuple.
// A third mutant adds a raw report key with no rawDomains entry. A mutant that compiles is a
// mechanism that has gone slack, and this gate fails.
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = join(root, "lib/integrations/src/integrations/device-management-health/types.ts");
const DOMAINS = join(root, "scripts/src/lib/dmh-domains.ts");
const HELPER = join(root, "scripts/src/lib/exhaustive-domain.ts");
const TSC = join(root, "node_modules/.bin/tsc");

function compile(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "dmh-exh-"));
  try {
    let types = readFileSync(TYPES, "utf8");
    types = mutate(types);
    writeFileSync(join(dir, "types.ts"), types);
    copyFileSync(HELPER, join(dir, "exhaustive-domain.ts"));
    const dom = readFileSync(DOMAINS, "utf8")
      .replace(/"@workspace\/integrations\/device-management-health"/g, '"./types"')
      .replace(/"\.\/exhaustive-domain\.js"/g, '"./exhaustive-domain"');
    writeFileSync(join(dir, "dmh-domains.ts"), dom);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", lib: ["es2022"], types: [], skipLibCheck: true }, files: ["dmh-domains.ts"] }),
    );
    const r = spawnSync(TSC, ["-p", join(dir, "tsconfig.json")], { encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const must = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};

const control = compile((t) => t);
must(control.status === 0, `control (unmodified contract) must compile clean:\n${control.out}`);

const addField = (t) =>
  t.replace("  rootCauseEvidence: RootCauseEvidence;\n", "  rootCauseEvidence: RootCauseEvidence;\n  plantedField: \"a\" | \"b\";\n");
const addMember = (t) =>
  t.replace('export type MdmCheckInFreshness = "fresh" | "stale" | "never" | "unknown";', 'export type MdmCheckInFreshness = "fresh" | "stale" | "never" | "unknown" | "planted_member";');
const addRawKey = (t) => t.replace('  "rootCauseEvidence",\n] as const;', '  "rootCauseEvidence",\n  "plantedRawKey",\n] as const;');

const mutants = [
  ["new judged field with no domain", addField],
  ["new union member missing from its field's tuple", addMember],
  ["new raw report key with no rawDomains entry", addRawKey],
];
for (const [name, fn] of mutants) {
  const mutated = fn(readFileSync(TYPES, "utf8"));
  must(mutated !== readFileSync(TYPES, "utf8"), `mutant "${name}" did not apply (the contract text moved; update this gate)`);
  const r = compile(fn);
  must(r.status !== 0 && r.out.includes("dmh-domains.ts"), `mutant "${name}" compiled — the mechanism is slack:\n${r.out}`);
  console.log(`ok   mutant rejected: ${name}`);
}
console.log("ok   control compiles clean");
console.log(`dmh-domains exhaustiveness self-test: ${mutants.length}/${mutants.length} mutants rejected`);
