// The connector-emulator evidence manifest may assert only what was measured.
//
//   node scripts/check-connector-emulator-evidence.mjs                 # gate: measure the tree + read the workflow
//   node scripts/check-connector-emulator-evidence.mjs --results <f> --emit <out>
//                                                                      # CI: measure, include the proof output, write the result
//   node scripts/check-connector-emulator-evidence.mjs --self-test
//
// WHY THIS EXISTS (docs/COMPANY_BUILD_PLAN.md row 172). `.github/workflows/connector-emulator-smoke.yml`
// uploads an evidence manifest whose `publicSafety` array said "synthetic fixtures only",
// "no live vendor calls", "no secrets", "no tenant IDs", "no customer data", "no PHI/PII"
// — six string literals in the workflow, written once and re-emitted on every run beside
// a run id and a commit sha. Nothing measured any of them. A reader downstream cannot tell
// a checked property from a typed sentence when the artifact presents both identically,
// and if the harness ever grew a live call the manifest would keep saying it had none.
//
// So the properties are DERIVED here and the workflow emits this script's output instead
// of a literal. Each property names the check that produced it and what it scanned.
//
// WHAT IT MEASURES, and the ceiling of each — stated because the tempting version overclaims:
//   no-network-primitive   the proof entrypoint and every module it reaches by relative
//                          import import only an allowlisted set of node built-ins (no
//                          http/https/net/tls/dgram/dns/http2/child_process, no package)
//                          and contain no fetch/WebSocket/XMLHttpRequest/require/dynamic
//                          import. Static: it proves no network primitive is REACHABLE
//                          from the harness source, which is what "no live vendor calls"
//                          can honestly mean for a process that is never observed on the wire.
//   fixture-inputs-only    the harness's only file read is `readFile(resolve(fixtureDir, …))`
//                          and every fixture it names exists and declares
//                          `generatedFrom: "synthetic-public-safe-fixture"`. That proves the
//                          inputs are the committed files that SAY they are synthetic — it
//                          cannot prove a human told the truth when writing them.
//   no-url                 no http(s) URL in the fixtures or the proof output.
//   no-secret-shape        no PEM key, JWT, AWS/GitHub/`sk-` key, bearer token, or
//                          password/secret-valued field in the fixtures or the output.
//   no-tenant-id-shape     no GUID in the fixtures or the output (Entra tenant IDs are GUIDs).
//   no-pii-shape           no email, SSN-shaped or phone-shaped value in the fixtures or output.
// "no customer data" and "no PHI" are NOT decidable by a scan and are therefore no longer
// asserted; the PII shapes above are what a scan can check, and the property says so.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "scripts/src/connector-emulator-proof.ts";
const FIXTURE_DIR = "fixtures/connectors/emulator";
const WORKFLOW = ".github/workflows/connector-emulator-smoke.yml";
const SELF = "scripts/check-connector-emulator-evidence.mjs";

const ALLOWED_BUILTINS = new Set(["node:crypto", "node:fs", "node:fs/promises", "node:path", "node:url"]);
const CODE_PRIMITIVES = [
  [/\bfetch\s*\(/, "fetch("],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\brequire\s*\(/, "require("],
  [/\bimport\s*\(/, "dynamic import("],
  [/\bprocess\.binding\b/, "process.binding"],
];
const DATA_SHAPES = {
  "no-url": [[/\bhttps?:\/\/[^\s"']+/i, "http(s) URL"]],
  "no-secret-shape": [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "PEM private key"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}/, "JWT"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
    [/\bsk-[A-Za-z0-9]{20,}/, "sk- API key"],
    [/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/, "bearer token"],
    [/"(password|passwd|client_?secret|api_?key|access_?token|refresh_?token)"\s*:\s*"[^"]+"/i, "secret-valued field"],
  ],
  "no-tenant-id-shape": [[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, "GUID"]],
  "no-pii-shape": [
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, "email address"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "SSN-shaped number"],
    [/(?:\+\d{1,3}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, "phone-shaped number"],
  ],
};
const STATEMENTS = {
  "no-network-primitive": "no network primitive is reachable from the emulator proof's source (allowlisted node built-ins only; no fetch/WebSocket/XHR/require/dynamic import)",
  "fixture-inputs-only": "the harness reads only the committed fixture files, each declaring generatedFrom=synthetic-public-safe-fixture",
  "no-url": "no http(s) URL in the fixtures or the proof output",
  "no-secret-shape": "no secret-shaped value (PEM key, JWT, cloud/GitHub/sk- key, bearer token, secret-valued field) in the fixtures or the proof output",
  "no-tenant-id-shape": "no GUID-shaped (tenant-ID-shaped) value in the fixtures or the proof output",
  "no-pii-shape": "no email-, SSN- or phone-shaped value in the fixtures or the proof output",
};

/** Walk the relative-import closure of the entry; return {files, findings}. */
export function scanCode(read, entry = ENTRY) {
  const findings = [];
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text == null) { findings.push(`${file}: unreadable — cannot prove what it imports`); continue; }
    const code = sanitize(text);
    // Specifiers are string contents, which sanitize masks; read them from the raw
    // text but only at positions where the sanitized text still has an import/export.
    const specRe = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*(["'])([^"']+)\1|(?:^|\n)\s*import\s*(["'])([^"']+)\3/g;
    let m;
    while ((m = specRe.exec(text))) {
      const at = m.index + m[0].search(/\S/);
      if (!/^(import|export)/.test(code.slice(at, at + 6))) continue; // inside a comment
      const spec = m[2] ?? m[4];
      if (spec.startsWith(".")) {
        const target = relative(repo, resolve(repo, dirname(file), spec)).replace(/\.js$/, ".ts");
        queue.push(target);
      } else if (!ALLOWED_BUILTINS.has(spec)) {
        findings.push(`${file}: imports "${spec}" — not in the allowlist ${[...ALLOWED_BUILTINS].join(", ")}`);
      }
    }
    for (const [re, label] of CODE_PRIMITIVES) if (re.test(code)) findings.push(`${file}: contains ${label}`);
  }
  return { files: [...seen], findings };
}

/** The harness's file reads must all be `readFile(resolve(fixtureDir, …))`, and the fixtures must say synthetic. */
export function scanInputs(read, files) {
  const findings = [];
  const fixtures = [];
  for (const file of files) {
    const text = read(file) ?? "";
    const code = sanitize(text);
    const reads = [...code.matchAll(/\b(readFile|readFileSync|createReadStream|open|opendir|readdir)\s*\(/g)];
    for (const r of reads) {
      const call = text.slice(r.index, r.index + 60);
      if (!/^readFile\s*\(\s*resolve\s*\(\s*fixtureDir\s*,/.test(call)) findings.push(`${file}: file read outside fixtureDir — ${call.split("\n")[0]}`);
    }
    const dirDecl = text.match(/fixtureDir\s*=\s*resolve\([\s\S]*?["']([^"']+)["']\s*,?\s*\)/);
    if (dirDecl && !dirDecl[1].replace(/^(\.\.\/)+/, "").endsWith(FIXTURE_DIR)) findings.push(`${file}: fixtureDir points at ${dirDecl[1]}, not ${FIXTURE_DIR}`);
    const list = text.match(/fixtureFiles\s*=\s*\[([\s\S]*?)\]/);
    if (list) for (const f of list[1].matchAll(/["']([^"']+\.json)["']/g)) fixtures.push(`${FIXTURE_DIR}/${f[1]}`);
  }
  if (fixtures.length === 0) findings.push(`no fixtureFiles list found in ${files.join(", ")} — cannot name the inputs`);
  for (const f of fixtures) {
    const body = read(f);
    if (body == null) { findings.push(`${f}: named by the harness but missing`); continue; }
    let parsed;
    try { parsed = JSON.parse(body); } catch { findings.push(`${f}: not valid JSON`); continue; }
    if (parsed?.generatedFrom !== "synthetic-public-safe-fixture") findings.push(`${f}: generatedFrom is ${JSON.stringify(parsed?.generatedFrom)}, not "synthetic-public-safe-fixture"`);
  }
  return { fixtures, findings };
}

export function scanData(read, dataFiles) {
  const out = {};
  for (const [id, shapes] of Object.entries(DATA_SHAPES)) {
    const findings = [];
    for (const f of dataFiles) {
      const text = read(f);
      if (text == null) { findings.push(`${f}: unreadable — cannot prove its absence`); continue; }
      for (const [re, label] of shapes) {
        const hit = text.match(re);
        if (hit) findings.push(`${f}: ${label} — ${hit[0].slice(0, 40)}`);
      }
    }
    out[id] = findings;
  }
  return out;
}

export function measure(read, { results } = {}) {
  const code = scanCode(read);
  const inputs = scanInputs(read, code.files);
  const dataFiles = [...inputs.fixtures, ...(results ? [results] : [])];
  const data = scanData(read, dataFiles);
  const props = [
    { id: "no-network-primitive", findings: code.findings, scanned: code.files },
    { id: "fixture-inputs-only", findings: inputs.findings, scanned: [...code.files, ...inputs.fixtures] },
    ...Object.entries(data).map(([id, findings]) => ({ id, findings, scanned: dataFiles })),
  ];
  return props.map((p) => ({
    id: p.id,
    statement: STATEMENTS[p.id],
    result: p.findings.length === 0 ? "pass" : "fail",
    measuredBy: `${SELF}#${p.id}`,
    scanned: p.scanned,
    ...(p.findings.length ? { findings: p.findings } : {}),
  }));
}

/** The workflow must emit this script's measurement and type no property itself. */
export function checkWorkflow(text) {
  const findings = [];
  if (!new RegExp(`node\\s+${SELF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^\\n]*--emit`).test(text)) findings.push(`${WORKFLOW} never runs \`node ${SELF} … --emit\` — the manifest's safety properties would be measured by nothing`);
  if (/publicSafety\s*:\s*\[/.test(text)) findings.push(`${WORKFLOW} assigns publicSafety an array literal — a typed claim, not a measured one`);
  for (const phrase of ["synthetic fixtures only", "no live vendor calls", "no customer data", "no PHI/PII"]) {
    if (text.includes(`'${phrase}'`) || text.includes(`"${phrase}"`)) findings.push(`${WORKFLOW} carries the literal claim "${phrase}"`);
  }
  if (!/publicSafety\s*:[^\n]*(readFileSync|JSON\.parse)/.test(text)) findings.push(`${WORKFLOW} does not read publicSafety from the measured output`);
  return findings;
}

function selfTest() {
  const real = (p) => (existsSync(resolve(repo, p)) ? readFileSync(resolve(repo, p), "utf8") : null);
  const over = (patch) => (p) => (p in patch ? patch[p] : real(p));
  const failing = (props, id) => props.find((p) => p.id === id)?.result === "fail";
  const harness = real("scripts/src/connector-emulator-harness.ts");
  const fx = `${FIXTURE_DIR}/network-trust.json`;
  const fxText = real(fx);
  const wf = real(WORKFLOW);
  const checks = [
    ["the real tree passes every property", measure(real).every((p) => p.result === "pass")],
    ["a fetch( in the harness fails no-network-primitive", failing(measure(over({ "scripts/src/connector-emulator-harness.ts": `${harness}\nexport const x = () => fetch(u);\n` })), "no-network-primitive")],
    ["an import of node:https fails no-network-primitive", failing(measure(over({ "scripts/src/connector-emulator-harness.ts": `import { get } from "node:https";\n${harness}` })), "no-network-primitive")],
    ["a fetch( only in a comment does NOT fail", !failing(measure(over({ "scripts/src/connector-emulator-harness.ts": `${harness}\n// fetch(url) is never called\n` })), "no-network-primitive")],
    ["a read outside fixtureDir fails fixture-inputs-only", failing(measure(over({ "scripts/src/connector-emulator-harness.ts": `${harness}\nexport const y = () => readFile("/etc/hosts", "utf8");\n` })), "fixture-inputs-only")],
    ["a fixture not declaring synthetic fails fixture-inputs-only", failing(measure(over({ [fx]: fxText.replace("synthetic-public-safe-fixture", "exported-from-tenant") })), "fixture-inputs-only")],
    ["a GUID in a fixture fails no-tenant-id-shape", failing(measure(over({ [fx]: fxText.replace('"scenarios"', '"tenant": "72f988bf-86f1-41af-91ab-2d7cd011db47", "scenarios"') })), "no-tenant-id-shape")],
    ["an email in the proof output fails no-pii-shape", failing(measure(over({ "planted/results.json": '{"who":"jane.doe@example.org"}' }), { results: "planted/results.json" }), "no-pii-shape")],
    ["a bearer token in the output fails no-secret-shape", failing(measure(over({ "planted/results.json": '{"h":"Bearer abcdefghijklmnopqrstuvwxyz0123"}' }), { results: "planted/results.json" }), "no-secret-shape")],
    ["a URL in a fixture fails no-url", failing(measure(over({ [fx]: fxText.replace('"scenarios"', '"endpoint": "https://graph.microsoft.com/v1.0", "scenarios"') })), "no-url")],
    ["a missing proof output fails, never passes", measure(real, { results: "planted/absent.json" }).some((p) => p.result === "fail")],
    ["the real workflow passes the workflow check", checkWorkflow(wf).length === 0],
    ["a workflow typing publicSafety as a literal array fails", checkWorkflow(wf.replace(/publicSafety\s*:[^\n]*/, "publicSafety: ['no secrets'],")).length > 0],
    ["a workflow that never runs the measurement fails", checkWorkflow(wf.replaceAll(SELF, "scripts/other.mjs")).length > 0],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const read = (p) => (existsSync(resolve(repo, p)) ? readFileSync(resolve(repo, p), "utf8") : null);
const results = arg("--results");
const emit = arg("--emit");
const props = measure(read, { results });
const wfFindings = emit ? [] : checkWorkflow(read(WORKFLOW) ?? "");
for (const p of props) {
  console.log(`${p.result === "pass" ? "✓" : "✗"} ${p.id} — ${p.statement} (${p.scanned.length} file(s))`);
  for (const f of p.findings ?? []) console.log(`    ${f}`);
}
if (!emit) {
  if (wfFindings.length === 0) console.log(`✓ ${WORKFLOW} emits the measured properties and types none itself`);
  for (const f of wfFindings) console.log(`✗ ${f}`);
}
if (emit) {
  mkdirSync(dirname(resolve(repo, emit)), { recursive: true });
  writeFileSync(resolve(repo, emit), `${JSON.stringify(props, null, 2)}\n`);
  console.log(`wrote ${emit}`);
}
const bad = props.filter((p) => p.result !== "pass").length + wfFindings.length;
console.log(bad === 0 ? "\nconnector-emulator evidence: every asserted property was measured and holds" : `\nconnector-emulator evidence: ${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
