// An image build that depends on one un-retried network fetch will flake, and a
// vulnerability scan that cannot fail is not a scan.
//
//   node scripts/check-image-build-hardening.mjs              # the real tree
//   node scripts/check-image-build-hardening.mjs --self-test  # the gate must be able to fail
//
// WHY THIS EXISTS (docs/COMPANY_BUILD_PLAN.md row 59, docs/BUILD_BACKLOG.md
// "grype `|| true` hides a scanner crash")
//
// 1. `corepack enable pnpm` only writes shims; corepack downloads pnpm lazily, the
//    first time `pnpm` runs. Each image stage therefore fetched
//    registry.npmjs.org/pnpm/-/pnpm-<v>.tgz inside `pnpm install`, with no retry.
//    On PR #287 the builder fetch succeeded and the runtime fetch four seconds
//    later died in undici (`assert(!this.paused)`) — a network blip that read as a
//    build break. The fix pre-fetches the PINNED pnpm (`corepack install -g
//    pnpm@<v>`) inside a bounded retry loop, in the same RUN as `corepack enable`,
//    so the later `pnpm install` resolves from corepack's cache. The pin must equal
//    package.json's `packageManager`; a different version would be fetched again,
//    un-retried, by the install — the defect back with a green gate over it.
//
// 2. The tempting alternative — carry corepack's cache forward from the builder —
//    is exactly what the runtime stage of Dockerfile.api deliberately DELETES: the
//    cached pnpm bundles its own `tar` below the GHSA-23hp-3jrh-7fpw fix. The strip
//    (npm + corepack + a FOUND, not guessed, corepack cache, then a FATAL if any
//    bundled tar survives) must stay, and must run AFTER the last corepack/pnpm
//    step of that stage, or the retry re-creates the cache the strip removed.
//
// 3. supply-chain.yml ran grype with `|| true`. With no `--fail-on`, grype exits
//    non-zero only when grype itself fails (findings exit 0), so `|| true` could
//    only ever swallow a crash — the step then "reported" over a scan that never
//    ran. A grype invocation may now either be bare (the step's `bash -e` fails
//    it) or capture the status into a variable that a later line tests and
//    `exit 1`s on. Findings stay report-only, explicitly: no `--fail-on` on a
//    step that handles its own status (a bare `--fail-on` scan is a gate, and
//    fine), and never `continue-on-error`.
//
// WHAT THIS DOES NOT PROVE: that the image builds. It reads text. The deploy-stack
// and supply-chain CI jobs run the real `docker build`; this is the cheap check
// that holds the shape between those runs.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(resolve(repo, f), "utf8");

/** Dockerfile instructions with `\` continuations joined, each with its first line number. */
export function instructionsOf(text) {
  const out = [];
  let buf = null;
  text.split("\n").forEach((raw, i) => {
    if (buf === null) {
      if (/^\s*(#|$)/.test(raw)) return;
      buf = { line: i + 1, text: "" };
    } else if (/^\s*#/.test(raw)) {
      return;
    }
    const cont = /\\\s*$/.test(raw);
    buf.text += (buf.text ? " " : "") + raw.replace(/\\\s*$/, "").trim();
    if (!cont) { out.push(buf); buf = null; }
  });
  if (buf) out.push(buf);
  return out;
}

/** Group instructions into stages by FROM. */
function stagesOf(text) {
  const stages = [];
  for (const ins of instructionsOf(text)) {
    const from = ins.text.match(/^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i);
    if (from) { stages.push({ image: from[1], as: from[2] ?? null, line: ins.line, runs: [] }); continue; }
    if (stages.length && /^RUN\s/i.test(ins.text)) stages.at(-1).runs.push(ins);
  }
  return stages;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rule 1: every `corepack enable` RUN pre-fetches the pinned pnpm in a bounded retry. */
export function checkCorepackRetry(file, text, pinnedVersion) {
  const problems = [];
  for (const ins of instructionsOf(text)) {
    if (!/^RUN\s/i.test(ins.text) || !/\bcorepack\s+enable\b/.test(ins.text)) continue;
    const at = `${file}:${ins.line}`;
    const install = ins.text.match(/\bcorepack\s+install\s+-g\s+pnpm@(\S+?)(?=\s|;|&|$)/);
    if (!install) {
      problems.push(`${at} runs \`corepack enable\` without pre-fetching pnpm (\`corepack install -g pnpm@<v>\`) — the download then happens lazily inside \`pnpm install\`, un-retried`);
      continue;
    }
    if (pinnedVersion && install[1] !== pinnedVersion) {
      problems.push(`${at} pre-fetches pnpm@${install[1]} but package.json packageManager pins pnpm@${pinnedVersion} — the install would fetch ${pinnedVersion} again, un-retried`);
    }
    // Bounded: a literal `for x in 1 2 …; do … corepack install … done` with a
    // sleep between attempts and a hard `exit 1` once the attempts run out.
    const loop = ins.text.match(/\bfor\s+(\w+)\s+in\s+((?:\d+\s+)+)?\d+\s*;\s*do\b(.*?)\bdone\b(.*)$/);
    const bounded = loop && new RegExp(`corepack\\s+install\\s+-g\\s+pnpm@${esc(install[1])}`).test(loop[3]) && /\bsleep\b/.test(loop[3]) && /\bexit\s+1\s*$/.test(loop[4].trim());
    if (!bounded) {
      problems.push(`${at} pre-fetches pnpm but not inside a bounded retry (\`for n in 1 2 3 4; do corepack install -g pnpm@<v> && exit 0; …; sleep …; done; …; exit 1\`)`);
    }
  }
  return problems;
}

/** Rule 2: the runtime stage of Dockerfile.api strips npm + corepack + its cache, then proves no tar survived. */
export function checkCorepackStrip(file, text) {
  const problems = [];
  const stages = stagesOf(text);
  const runtime = stages.at(-1);
  if (!runtime) return [`${file}: no stages found`];
  const stripIdx = runtime.runs.findIndex((r) =>
    /rm\s+-rf\s+\/usr\/local\/lib\/node_modules\/npm\b/.test(r.text) &&
    /rm\s+-rf\s+\/usr\/local\/lib\/node_modules\/corepack\b/.test(r.text) &&
    /find\s+\/\s+-xdev\s+-type\s+d\s+-name\s+corepack\b/.test(r.text) &&
    /node_modules\/tar\/package\.json/.test(r.text) && /\bexit\s+1\b/.test(r.text));
  if (stripIdx < 0) {
    problems.push(`${file}:${runtime.line} (${runtime.as ?? runtime.image}) — the npm/corepack/corepack-cache strip with its surviving-tar FATAL is missing. It closes GHSA-23hp-3jrh-7fpw; a retry fix must not undo it (plan row 59)`);
    return problems;
  }
  const lastPm = runtime.runs.reduce((acc, r, i) => (/\b(?:corepack|pnpm)\b/.test(r.text) && i !== stripIdx ? i : acc), -1);
  if (lastPm > stripIdx) {
    problems.push(`${file}:${runtime.runs[lastPm].line} runs corepack/pnpm AFTER the cache strip at :${runtime.runs[stripIdx].line} — it re-creates the cache the strip removed`);
  }
  return problems;
}

/** Rule 3: a grype scan in a workflow can fail on a scanner crash. */
export function checkGrypeExit(file, text) {
  const problems = [];
  const lines = text.split("\n");
  // Step boundaries: a `- name:` / `- uses:` list item at any indent.
  const stepStart = (i) => { for (let j = i; j >= 0; j--) if (/^\s*-\s+(name|uses|run|id):/.test(lines[j])) return j; return 0; };
  const stepEnd = (i) => { const ind = lines[stepStart(i)].search(/-/); for (let j = i + 1; j < lines.length; j++) { const m = lines[j].match(/^(\s*)-\s+\w+:/); if (m && m[1].length <= ind) return j; if (/^\S/.test(lines[j])) return j; } return lines.length; };
  lines.forEach((line, i) => {
    const code = line.replace(/\s#.*$/, "");
    if (!/^\s*grype\s+(?!db\b|version\b|--version\b)\S/.test(code)) return;
    const at = `${file}:${i + 1}`;
    const s0 = stepStart(i), s1 = stepEnd(i);
    const step = lines.slice(s0, s1);
    if (step.some((l) => /^\s*continue-on-error:\s*true\b/.test(l))) {
      problems.push(`${at} — the grype step sets continue-on-error: a scanner crash would be swallowed`);
    }
    // A bare `--fail-on` scan is a GATE (scheduled-verification.yml's critical
    // gate) and fails on findings by design. Only one that ALSO handles its own
    // status is report-only — there a findings exit and a crash look alike.
    if (/--fail-on\b/.test(code) && /\|\|/.test(code)) {
      problems.push(`${at} — grype runs with --fail-on in a REPORT-only step (its status is handled): findings would now exit non-zero, indistinguishable from a crash. Gate findings in their own step`);
    }
    if (/(\|\|\s*(true|:|exit\s+0)\b|;\s*true\s*$)/.test(code)) {
      problems.push(`${at} — grype ends in a swallow (\`|| true\` or equivalent): with no --fail-on, only a scanner crash exits non-zero, so this can only hide one`);
      return;
    }
    const cap = code.match(/\|\|\s*(\w+)=\$\?\s*$/);
    if (cap) {
      const v = esc(cap[1]);
      const tested = lines.slice(i + 1, s1).some((l) => new RegExp(`\\$\\{?${v}\\}?"?\\s+-ne\\s+0\\b[^\\n]*\\bexit\\s+1\\b`).test(l));
      if (!tested) problems.push(`${at} — grype's status is captured into $${cap[1]} but no later line in the step fails on it (\`if [ "$${cap[1]}" -ne 0 ]; then …; exit 1; fi\`)`);
    } else if (/\|\|/.test(code)) {
      problems.push(`${at} — grype's failure branch is neither a status capture nor absent: \`${code.trim()}\``);
    }
  });
  return problems;
}

function pinnedPnpm(pkgText) {
  const m = String(JSON.parse(pkgText).packageManager ?? "").match(/^pnpm@([^+\s]+)/);
  return m ? m[1] : null;
}

export function checkTree(files) {
  const problems = [];
  const pinned = pinnedPnpm(files["package.json"]);
  if (!pinned) problems.push("package.json has no pnpm packageManager pin — nothing to hold the Dockerfile pre-fetch to");
  const dockerfiles = Object.keys(files).filter((f) => /(^|\/)Dockerfile(\.|$)/.test(f));
  if (!dockerfiles.includes("Dockerfile.api")) problems.push("Dockerfile.api not found");
  for (const f of dockerfiles) problems.push(...checkCorepackRetry(f, files[f], pinned));
  if (files["Dockerfile.api"]) problems.push(...checkCorepackStrip("Dockerfile.api", files["Dockerfile.api"]));
  const wf = ".github/workflows/supply-chain.yml";
  if (!files[wf]) problems.push(`${wf} not found`);
  else if (!/^\s*grype\s+sbom:/m.test(files[wf])) problems.push(`${wf} no longer runs a grype sbom scan — this gate has nothing to hold; update it deliberately`);
  for (const f of Object.keys(files).filter((f) => /^\.github\/workflows\/.*\.ya?ml$/.test(f))) problems.push(...checkGrypeExit(f, files[f]));
  return problems;
}

function loadTree() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n");
  const want = tracked.filter((f) => f === "package.json" || /(^|\/)Dockerfile(\.|$)/.test(f) || /^\.github\/workflows\/.*\.ya?ml$/.test(f));
  return Object.fromEntries(want.map((f) => [f, read(f)]));
}

function selfTest() {
  const real = loadTree();
  const cases = [];
  const mutate = (name, f, fn, expect) => cases.push({ name, files: { ...real, [f]: fn(real[f]) }, expect });
  const api = "Dockerfile.api", sc = ".github/workflows/supply-chain.yml";
  mutate("bare corepack line", api, (t) => t.replace(/^RUN corepack enable pnpm .*$/m, "RUN corepack enable pnpm"), /without pre-fetching/);
  mutate("retry unbounded (no exit 1)", api, (t) => t.replace(/^(RUN corepack enable pnpm .*); exit 1$/m, "$1"), /bounded retry/);
  mutate("pre-fetch version drifts from packageManager", api, (t) => t.replace(/corepack install -g pnpm@[\d.]+/, "corepack install -g pnpm@9.0.0"), /packageManager pins/);
  mutate("corepack cache strip removed", api, (t) => t.replace(/find \/ -xdev -type d -name corepack[^\n]*\n/, ""), /strip .* is missing/);
  mutate("pnpm step after the strip", api, (t) => t.replace(/^RUN chown -R node:node \/app$/m, "RUN pnpm --version\nRUN chown -R node:node /app"), /AFTER the cache strip/);
  mutate("planted || true on grype", sc, (t) => t.replace(/(grype sbom:\S+ -o json --file grype-report\.json) \|\| gs=\$\?/, "$1 || true"), /swallow/);
  mutate("captured status never tested", sc, (t) => t.replace(/^\s*if \[ "\$gs" -ne 0 \].*\n/m, ""), /no later line/);
  mutate("continue-on-error on the grype step", sc, (t) => t.replace(/(- name: Vulnerability scan[^\n]*\n)/, "$1        continue-on-error: true\n"), /continue-on-error/);
  mutate("--fail-on in the report step", sc, (t) => t.replace(/(grype sbom:\S+) -o json/, "$1 --fail-on high -o json"), /--fail-on/);
  let failed = 0;
  const base = checkTree(real);
  if (base.length) { failed++; console.error(`  ✗ the real tree must pass:\n    ${base.join("\n    ")}`); }
  else console.log("  ✓ the real tree passes");
  for (const c of cases) {
    const got = checkTree(c.files);
    const changed = Object.keys(c.files).some((f) => c.files[f] !== real[f]);
    if (!changed) { failed++; console.error(`  ✗ ${c.name}: the mutation did not apply (fixture drifted)`); continue; }
    if (got.some((p) => c.expect.test(p))) console.log(`  ✓ ${c.name} → caught`);
    else { failed++; console.error(`  ✗ ${c.name}: NOT caught (${got.join(" | ") || "no problems reported"})`); }
  }
  console.log(failed ? `\nimage-build-hardening self-test: ${failed} FAILED` : `\nimage-build-hardening self-test: ${cases.length + 1}/${cases.length + 1} passed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  const problems = checkTree(loadTree());
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(`\nimage-build-hardening: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log("  ✓ every `corepack enable` pre-fetches the pinned pnpm in a bounded retry");
  console.log("  ✓ Dockerfile.api's runtime stage still strips npm + corepack + its cache after the last pnpm step");
  console.log("  ✓ no grype scan can swallow a scanner crash");
  console.log("\nimage-build-hardening: ok");
}
