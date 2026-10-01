// Security-controls-matrix status gate — a status word is a claim, and a claim
// needs something that can fail.
//
// WHY THIS EXISTS. docs/COMPANY_BUILD_PLAN.md row 49 made the questionnaire
// pack's denylist promise true, and left one residual: "SECURITY_CONTROLS_MATRIX's
// status column still has no drift gate". docs/SECURITY_CONTROLS_MATRIX.md is the
// page an assessor reads to learn what the public core ENFORCES. A row can say
// "Implemented (public core)" while the file it cites has been renamed or the
// proof it names deleted, and nothing noticed.
//
// WHAT IS GATED, per control row (every table headed `| Control | ... | Status | Where |`):
//   1. The Status cell (bold markers stripped) is one of the four words the
//      matrix's own "Status legend" table defines. A word outside the legend
//      fails — an assessor cannot read a status the legend does not define.
//   2. A row whose status is "Implemented (public core)" must:
//      a. cite at least one repo path, and every cited path must exist
//         (`lib/x/{a,b}.ts` brace forms expand; `path:NN` line suffixes are
//         stripped; a bare `file.ts` resolves beside the cell's previous full
//         path, else to the ONE tracked file of that basename — ambiguous or
//         absent fails);
//      b. be bound to a proof script that exists in package.json `scripts`:
//         the row's own `proof:*` citation(s) if it has any, otherwise the
//         matrix-wide binding the doc itself states — the closing note's
//         "Everything marked Implemented (public core) ... is exercised by
//         `pnpm run proof:<x>`". If that sentence is gone or names a missing
//         script, every row leaning on it fails (fail-closed).
//
// KNOWN FAILURES. The matrix is an owner-gated surface (compliance docs in
// scripts/check-owner-gated-surfaces.mjs); this gate does not edit it. Rows the
// real matrix failed on the day the gate landed are listed in KNOWN_FAILURES,
// quoted on EVERY run, and a stale entry (the row now passes, or is gone) fails
// the gate so the list cannot outlive its reason. A NEW failure is never
// tolerated. Empty is the goal state; the owner decides how each is resolved.
//
// SELF-TEST (`--self-test`, also run first on every normal invocation): copy the
// real doc to a temp file, plant (a) a status word outside the legend, (b) an
// Implemented row citing a missing path, (c) an Implemented row citing a missing
// proof, (d) a deleted closing-note binding — each must exit 1 with the row
// quoted; and a planted VALID Implemented row must not add a failure.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOC = "docs/SECURITY_CONTROLS_MATRIX.md";
const IMPLEMENTED = "Implemented (public core)";
const ROW_FLOOR = 40; // the parser must find the real rows; fewer means it broke

/** Failures present on the real matrix when the gate landed (2026-10-01).
 *  Key = the row's Control cell, verbatim. Each needs an owner decision. */
const KNOWN_FAILURES = new Map([
  ["Real authentication provider, sessions, MFA/step-up assurance",
    "status `**Implemented in THIS repo**` is not a legend status — owner decides which legend word (or a new legend row) applies"],
  ["Durable, retained audit storage and log retention policy",
    "status `**Partially implemented in THIS repo** — …` is not a legend status — owner decides which legend word (or a new legend row) applies"],
]);

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
const unbold = (s) => s.replace(/\*\*/g, "").trim();

export function parseMatrix(text) {
  const lines = text.split("\n");
  const legend = new Set();
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\|/.test(lines[i])) continue;
    const head = cells(lines[i]).map(unbold);
    if (!/^\|\s*-/.test(lines[i + 1] ?? "")) continue;
    const isLegend = head.length === 2 && head[0] === "Status" && head[1] === "Meaning";
    const sIdx = head.indexOf("Status");
    const wIdx = head.indexOf("Where");
    const isControls = head[0] === "Control" && sIdx > 0 && wIdx > 0;
    if (!isLegend && !isControls) continue;
    let j = i + 2;
    for (; j < lines.length && /^\|/.test(lines[j]); j += 1) {
      const c = cells(lines[j]);
      if (isLegend) legend.add(unbold(c[0]));
      else rows.push({ line: j + 1, raw: lines[j], control: c[0], status: unbold(c[sIdx] ?? ""), where: c[wIdx] ?? "" });
    }
    i = j - 1;
  }
  const closing = /Everything marked \*\*Implemented \(public core\)\*\*[\s\S]{0,400}?is exercised by\s+`pnpm run (proof:[\w:.-]+)`/.exec(text);
  return { legend, rows, defaultProof: closing ? closing[1] : null };
}

function expandBraces(p) {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt.trim() + p.slice(m.index + m[0].length)));
}

const PATHISH = /^[\w.@{},/-]+$/;
const FILEEXT = /\.(ts|tsx|mjs|cjs|js|json|md|ya?ml|swift|sql|sh)$/;

/** Backticked tokens in a Where cell that name repo paths (not identifiers, not `/v1`). */
export function citedPaths(where) {
  const out = [];
  for (const m of where.matchAll(/`([^`]+)`/g)) {
    const tok = m[1].replace(/:\d+$/, "");
    if (/^pnpm run /.test(tok) || /^proof:/.test(tok)) continue;
    if (!PATHISH.test(tok) || tok.startsWith("/")) continue;
    if (tok.includes("/") || FILEEXT.test(tok) || /^\.[\w-]+$/.test(tok)) out.push(tok);
  }
  return out;
}

export function citedProofs(where) {
  return [...where.matchAll(/`(?:pnpm run )?(proof:[\w:.-]+)`/g)].map((m) => m[1]);
}

function resolver(root, tracked) {
  const byBase = new Map();
  for (const f of tracked) {
    const b = f.split("/").pop();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  return (tok, lastDir) => {
    if (tok.includes("/") || tok.startsWith(".")) return existsSync(join(root, tok)) ? tok : null;
    if (lastDir && existsSync(join(root, lastDir, tok))) return `${lastDir}/${tok}`;
    const hits = byBase.get(tok) ?? [];
    return hits.length === 1 ? hits[0] : null;
  };
}

/** The source file a proof script runs, following the root -> workspace-package
 *  delegation (`pnpm --filter @workspace/<pkg> run <name>` -> `tsx ./src/x.ts`).
 *  null when it cannot be resolved to an existing file — fail-closed. */
export function proofSource(name, { root = ROOT, scripts, readPkg = defaultReadPkg }) {
  let cmd = scripts[name];
  let dir = "";
  for (let hop = 0; hop < 3 && typeof cmd === "string"; hop += 1) {
    const d = /pnpm --filter (@workspace\/[\w-]+) run ([\w:.-]+)/.exec(cmd);
    if (d) {
      const pkg = readPkg(root, d[1]);
      if (!pkg) return null;
      dir = pkg.dir;
      cmd = pkg.scripts[d[2]];
      continue;
    }
    for (const tok of cmd.split(/\s+/)) {
      if (!/\.(ts|mjs|cjs|js)$/.test(tok)) continue;
      const rel = join(dir, tok).replace(/^\.\//, "");
      return existsSync(join(root, rel)) ? rel : null;
    }
    return null;
  }
  return null;
}

function defaultReadPkg(root, name) {
  const short = name.replace(/^@workspace\//, "");
  for (const dir of [short, `lib/${short}`, `artifacts/${short}`]) {
    const f = join(root, dir, "package.json");
    if (!existsSync(f)) continue;
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    if (pkg.name === name) return { dir, scripts: pkg.scripts ?? {} };
  }
  return null;
}

export function checkMatrix(text, { root = ROOT, tracked, scripts }) {
  const { legend, rows, defaultProof } = parseMatrix(text);
  const resolve = resolver(root, tracked);
  const fails = [];
  const structural = [];
  if (legend.size === 0) structural.push("no Status legend table found");
  if (!legend.has(IMPLEMENTED)) structural.push(`legend does not define "${IMPLEMENTED}"`);
  for (const r of rows) {
    const why = [];
    if (!legend.has(r.status)) why.push(`status "${r.status}" is not in the Status legend (${[...legend].join(" | ")})`);
    if (r.status === IMPLEMENTED) {
      const own = citedProofs(r.where);
      const proofs = own.length ? own : defaultProof ? [defaultProof] : [];
      if (proofs.length === 0) why.push("no proof bound: the row cites none and the closing note's matrix-wide `pnpm run proof:*` binding is missing");
      let ownSources = 0;
      for (const p of proofs) {
        const tag = own.length ? "" : " (matrix-wide binding)";
        if (!Object.hasOwn(scripts, p)) { why.push(`proof \`${p}\` is not a package.json script${tag}`); continue; }
        if (proofSource(p, { root, scripts })) { if (own.length) ownSources += 1; }
        else why.push(`proof \`${p}\`${tag} does not resolve to an existing source file`);
      }
      // A row's own cited proof counts as its repo-path citation: the proof's
      // source file is the thing in the tree that verifies the control.
      const paths = citedPaths(r.where);
      if (paths.length === 0 && ownSources === 0) why.push("cites no repo path (and no proof of its own whose source file exists)");
      let lastDir = null;
      for (const tok of paths) {
        for (const p of expandBraces(tok)) {
          const hit = resolve(p, lastDir);
          if (!hit) why.push(`cited path \`${p}\` does not exist (or is ambiguous)`);
          // a bare sibling resolves beside the CITED directory, even when the cited file is missing
          const at = (hit ?? p).includes("/") ? (hit ?? p) : null;
          if (at) lastDir = at.slice(0, at.lastIndexOf("/"));
        }
      }
    }
    if (why.length) fails.push({ ...r, why });
  }
  return { rows, legend, defaultProof, fails, structural };
}

function realContext() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
  return { root: ROOT, tracked, scripts };
}

function run(docPath) {
  const text = readFileSync(docPath, "utf8");
  const res = checkMatrix(text, realContext());
  let bad = res.structural.length;
  for (const s of res.structural) console.error(`FAIL  ${s}`);
  if (res.rows.length < ROW_FLOOR) { console.error(`FAIL  parsed ${res.rows.length} control rows (< floor ${ROW_FLOOR}) — the parser broke`); bad += 1; }
  const known = [];
  for (const f of res.fails) {
    if (KNOWN_FAILURES.has(f.control)) { known.push(f); continue; }
    bad += 1;
    console.error(`FAIL  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}`);
  }
  const failing = new Set(res.fails.map((f) => f.control));
  for (const [control] of KNOWN_FAILURES) {
    if (!failing.has(control)) { bad += 1; console.error(`FAIL  KNOWN_FAILURES entry "${control}" no longer fails (or the row is gone) — remove it`); }
  }
  for (const f of known) {
    console.log(`KNOWN (owner decision needed)  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}\n      - declared: ${KNOWN_FAILURES.get(f.control)}`);
  }
  const impl = res.rows.filter((r) => r.status === IMPLEMENTED).length;
  console.log(`security-controls-matrix: ${res.rows.length} rows, ${impl} "${IMPLEMENTED}", matrix-wide proof ${res.defaultProof ?? "MISSING"}; ${bad} new failure(s), ${known.length} known (owner decision needed)`);
  return bad === 0 ? 0 : 1;
}

function selfTest() {
  const real = readFileSync(join(ROOT, DOC), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "sg-matrix-"));
  const anchor = "| Typed request/response contracts |";
  if (!real.includes(anchor)) throw new Error(`self-test anchor row missing: ${anchor}`);
  const plant = (row) => real.replace(anchor, `${row}\n${anchor}`);
  const cases = [
    ["pass: the real doc", real, 0],
    ["pass: a valid planted Implemented row", plant("| Planted valid control | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:signalgrid-core` |"), 0],
    ["fail: status word outside the legend", plant("| Planted bad status | ASVS 5.0 | **Mostly done** | `lib/signalgrid-core/src/policy.ts` |"), 1],
    ["fail: Implemented row citing a missing path", plant("| Planted missing path | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/no-such-file.ts` |"), 1],
    ["fail: Implemented row citing a missing proof", plant("| Planted missing proof | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:no-such-proof` |"), 1],
    ["fail: Implemented row citing no path", plant("| Planted no path | ASVS 5.0 | Implemented (public core) | the core, somewhere |"), 1],
    ["fail: a KNOWN_FAILURES entry outlives its reason", real.replace("| **Implemented in THIS repo** |", "| Private-core (planned) |"), 1],
    ["fail: matrix-wide proof binding deleted", real.replace(/is exercised by\s+`pnpm run proof:[\w:.-]+`/, "is exercised by the core proof"), 1],
  ];
  let ok = true;
  try {
    for (const [name, text, want] of cases) {
      const f = join(dir, "SECURITY_CONTROLS_MATRIX.md");
      writeFileSync(f, text);
      const r = spawnSync(process.execPath, [SELF, "--doc", f], { cwd: ROOT, encoding: "utf8" });
      // a failure must QUOTE the offending row (or name the stale entry), never just exit 1
      const quoted = want === 1 ? /FAIL {2}\S+:\d+\n {6}\|.*\|\n {6}- /.test(r.stderr) || /KNOWN_FAILURES entry ".+" no longer fails/.test(r.stderr) : true;
      const pass = r.status === want && quoted;
      if (!pass) ok = false;
      console.log(`${pass ? "ok  " : "BAD "} self-test ${name} (exit ${r.status}, want ${want})${pass ? "" : `\n${r.stderr}`}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return ok;
}

const argv = process.argv.slice(2);
const docArg = argv.indexOf("--doc");
if (docArg !== -1) process.exit(run(argv[docArg + 1]));
const stOk = selfTest();
if (argv.includes("--self-test")) process.exit(stOk ? 0 : 1);
if (!stOk) { console.error("FAIL  self-test — the gate cannot fail, so its verdict proves nothing"); process.exit(1); }
process.chdir(ROOT);
process.exit(run(DOC));
