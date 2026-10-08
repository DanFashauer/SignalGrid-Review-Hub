// Self-test for the compile-time exhaustiveness of the device-management-health proof's
// field domains (scripts/src/lib/dmh-domains.ts).
//
// The mechanism is TYPES, and types are only proven by watching the compiler refuse. So this
// gate copies the real contract types and the real domains module into a scratch directory,
// runs `tsc --noEmit` on the unmodified copy (must be clean), then plants mutants and requires
// the compiler to reject each one at the domains module:
//   - a new judged FIELD added to NormalizedDeviceManagementHealth, no domain written;
//   - a new MEMBER added to EACH of the nine judged fields' types, left out of its tuple
//     (every entry is exercised, not one: slack in any single entry must fail);
//   - a tuple that drops a real member of its own field;
//   - a tuple cross-wired to another field's values;
//   - a new raw report key with no rawDomains entry.
// A mutant that compiles is a mechanism that has gone slack, and this gate fails.
// It also binds the PROOF to the module: the proof must import `domains`/`rawDomains` from
// it and declare no local copy, or the checked module could be bypassed unnoticed.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = join(root, "lib/integrations/src/integrations/device-management-health/types.ts");
const DOMAINS = join(root, "scripts/src/lib/dmh-domains.ts");
const PROOF = join(root, "scripts/src/device-management-health-proof.ts");
const TSC = join(root, "node_modules/.bin/tsc");

function compile(mutateTypes, mutateDomains = (d) => d) {
  const dir = mkdtempSync(join(tmpdir(), "dmh-exh-"));
  try {
    writeFileSync(join(dir, "types.ts"), mutateTypes(readFileSync(TYPES, "utf8")));
    const dom = mutateDomains(readFileSync(DOMAINS, "utf8"))
      .replace(/"@workspace\/integrations\/device-management-health"/g, '"./types"');
    writeFileSync(join(dir, "dmh-domains.ts"), dom);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", lib: ["es2022"], types: [], skipLibCheck: true }, files: ["dmh-domains.ts"] }),
    );
    const r = spawnSync(TSC, ["-p", join(dir, "tsconfig.json")], { encoding: "utf8", timeout: 120000 });
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

const typesSrc = readFileSync(TYPES, "utf8");
const addField = (t) =>
  t.replace("  rootCauseEvidence: RootCauseEvidence;\n", "  rootCauseEvidence: RootCauseEvidence;\n  plantedField: \"a\" | \"b\";\n");
const addRawKey = (t) => t.replace('  "rootCauseEvidence",\n] as const;', '  "rootCauseEvidence",\n  "plantedRawKey",\n] as const;');

// Every judged field of the interface, read from the real contract: `  field: Type;`.
const iface = typesSrc.slice(typesSrc.indexOf("export interface NormalizedDeviceManagementHealth"));
const ifaceBody = iface.slice(0, iface.indexOf("\n}"));
const JUDGED = [...ifaceBody.matchAll(/^ {2}(\w+): ([^;]+);$/gm)]
  .map((m) => m[1])
  .filter((f) => !["sourceSystem", "deviceId", "source"].includes(f));
must(JUDGED.length === 9, `expected nine judged fields in the contract, found ${JUDGED.length}: ${JUDGED.join(", ")}`);

const addMemberTo = (field) => (t) => t.replace(new RegExp(`^( {2}${field}: [^;]+);$`, "m"), '$1 | "planted_member";');
const replaceDomainLine = (field, values) => (d) =>
  d.replace(new RegExp(`^ {2}${field}: .*$`, "m"), `  ${field}: ${values},`);

const mutants = [
  ["new judged field with no domain", addField, (d) => d],
  ["new raw report key with no rawDomains entry", addRawKey, (d) => d],
  ...JUDGED.map((f) => [`new union member missing from ${f}'s tuple`, addMemberTo(f), (d) => d]),
  ["tuple drops a real member of its own field (rootCauseEvidence)", (t) => t, replaceDomainLine("rootCauseEvidence", '["available", "unavailable", "not_supported"]')],
  ["tuple cross-wired to another field's values (rootCauseEvidence <- mdmCheckInFreshness)", (t) => t, replaceDomainLine("rootCauseEvidence", '["fresh", "stale", "never", "unknown"]')],
];
for (const [name, mt, md] of mutants) {
  must(mt(typesSrc) !== typesSrc || md(readFileSync(DOMAINS, "utf8")) !== readFileSync(DOMAINS, "utf8"), `mutant "${name}" did not apply (the contract text moved; update this gate)`);
  const r = compile(mt, md);
  must(r.status !== 0 && r.out.includes("dmh-domains.ts"), `mutant "${name}" compiled — the mechanism is slack:\n${r.out}`);
  console.log(`ok   mutant rejected: ${name}`);
}
console.log("ok   control compiles clean");

// The proof must USE the checked module, not a local copy that bypasses it.
const proof = readFileSync(PROOF, "utf8");
const bound = (src) =>
  /import \{[^}]*\bdomains\b[^}]*\} from "\.\/lib\/dmh-domains\.js"/.test(src) &&
  /import \{[^}]*\brawDomains\b[^}]*\} from "\.\/lib\/dmh-domains\.js"/.test(src) &&
  !/^(?:export )?(?:const|let|var) (?:domains|rawDomains)\b/m.test(src);
must(bound(proof), "the proof must import `domains` and `rawDomains` from ./lib/dmh-domains.js and declare no local copy");
must(!bound(proof + "\nconst domains = {};\n"), "binding check must reject a local `domains` copy (self-test)");
must(!bound(proof.replace('from "./lib/dmh-domains.js"', 'from "./lib/other.js"')), "binding check must reject a proof that stops importing the module (self-test)");
console.log("ok   proof is bound to the checked module (2 binding mutants rejected)");
console.log(`dmh-domains exhaustiveness self-test: ${mutants.length}/${mutants.length} mutants rejected`);
