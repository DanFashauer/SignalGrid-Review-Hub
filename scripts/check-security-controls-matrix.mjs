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
// WHAT IS GATED (hardened over two review rounds on PR #1349):
//   0. Structure. Every line carrying an unescaped `|` sits in a recognised
//      table (controls `| Control | … | Status | Where |`, the ONE Status legend,
//      or `| Short ref | Framework |`) — GFM renders pipe-less, blockquoted and
//      split rows too, so an unplaced row fails rather than vanishing. Each row's
//      cell count matches its header. Control names are unique. The legend is
//      pinned to exactly EXPECTED_LEGEND.
//   1. The Status cell (bold markers stripped) is a legend word.
//   2. A row whose status reads "implement…" (the legend's Implemented word or
//      any other) must:
//      a. cite at least one repo path, every one a TRACKED file or a tracked
//         directory two or more segments deep — no `..`, no absolute path, no
//         untracked file (`lib/x/{a,b}.ts` braces expand; `path:NN` suffixes are
//         stripped; a bare `file.ts` resolves beside the cell's previous path,
//         else to the ONE tracked file of that basename);
//      b. be bound to a proof script that exists in package.json `scripts` and
//         resolves to a source file: the row's own `proof:*` citation(s), else
//         the closing note's matrix-wide binding ("Everything marked Implemented
//         (public core) ... is exercised by `pnpm run proof:<x>`"). If that
//         sentence is gone, every row leaning on it fails (fail-closed).
//   3. An "Automated (CI bot)" row's cited paths must be tracked too (it need
//      not cite one: several live in GitHub settings).
//
// KNOWN FAILURES. The matrix is an owner-gated surface (compliance docs in
// scripts/check-owner-gated-surfaces.mjs); this gate does not edit it. Rows the
// real matrix failed on the day the gate landed are listed in KNOWN_FAILURES by
// Control + exact Status + exact failure list, each absorbing ONE row, quoted on
// every run. A stale entry fails; any other failure on that row is new. Empty is
// the goal state; the owner decides how each is resolved.
//
// SELF-TEST (`--self-test`, also run first on every normal invocation): copy the
// real doc to a temp file and plant one defect per class above — each must exit
// 1 with the row quoted — plus a VALID Implemented row that must not fail.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOC = "docs/SECURITY_CONTROLS_MATRIX.md";
const IMPLEMENTED = "Implemented (public core)";
const ROW_FLOOR = 40; // the parser must find the real rows; fewer means it broke

/** The legend, pinned (review round 2 of PR #1349). A word added to the legend
 *  would otherwise become a valid status that nothing path-checks; changing the
 *  legend now fails until this list — and the checks each word gets — are
 *  updated in the same change. */
const EXPECTED_LEGEND = [IMPLEMENTED, "Automated (CI bot)", "Private-core (planned)", "Human-owned (planned)"];
/** Statuses whose cited paths must exist. Any status reading "implement…" gets
 *  the FULL Implemented check (paths + proof), legend word or not. */
const IMPLEMENTED_LIKE = /implement/i;
const PATH_CHECKED = new Set(["Automated (CI bot)"]);

/** Failures present on the real matrix when the gate landed (2026-10-01). Each
 *  entry absorbs exactly ONE row whose Control, exact Status and exact failure
 *  list all match — any other failure on that row, a changed status, or a
 *  second row of the same name is a NEW failure. Each needs an owner decision. */
const LEGEND_LIST = EXPECTED_LEGEND.join(" | ");
const KNOWN_FAILURES = [
  {
    control: "Real authentication provider, sessions, MFA/step-up assurance",
    status: "Implemented in THIS repo",
    why: [`status "Implemented in THIS repo" is not in the Status legend (${LEGEND_LIST})`],
    reason: "not a legend status — owner decides which legend word (or a new legend row) applies",
  },
  {
    control: "Durable, retained audit storage and log retention policy",
    status: "Partially implemented in THIS repo — durable storage yes; retention/deletion policy and mechanism not yet (`docs/DATA_RETENTION_AND_PERSONAL_DATA.md`)",
    why: [`status "Partially implemented in THIS repo — durable storage yes; retention/deletion policy and mechanism not yet (\`docs/DATA_RETENTION_AND_PERSONAL_DATA.md\`)" is not in the Status legend (${LEGEND_LIST})`],
    reason: "not a legend status — owner decides which legend word (or a new legend row) applies",
  },
];

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
const unbold = (s) => s.replace(/\*\*/g, "").trim();

/** Tables the matrix may carry that hold no controls. Any OTHER pipe line —
 *  an unknown header, a row split from its table by a blank line, a renamed
 *  Status/Where column — is UNCLAIMED and fails: a row the parser cannot place
 *  is a row nobody gates (found in review round 1 of PR #1349). */
const NON_CONTROL_TABLES = [["Short ref", "Framework"]];

export function parseMatrix(text) {
  const lines = text.split("\n");
  const legend = new Set();
  const legendTables = [];
  const rows = [];
  const unclaimed = [];
  const malformed = [];
  const claimed = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]).map(unbold);
    const isTable = /^\s*\|\s*:?-/.test(lines[i + 1] ?? "");
    const isLegend = head.length === 2 && head[0] === "Status" && head[1] === "Meaning";
    const sIdx = head.indexOf("Status");
    const wIdx = head.indexOf("Where");
    const isControls = head[0] === "Control" && sIdx > 0 && wIdx > 0;
    const isOther = NON_CONTROL_TABLES.some((h) => h.length === head.length && h.every((x, k) => x === head[k]));
    if (!isTable || (!isLegend && !isControls && !isOther)) continue; // left unclaimed: fails below
    claimed.add(i).add(i + 1);
    if (isLegend) legendTables.push(i + 1);
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j += 1) {
      claimed.add(j);
      const c = cells(lines[j]);
      // an escaped pipe or a dropped cell shifts every column after it — never guess
      if (c.length !== head.length) { malformed.push({ line: j + 1, raw: lines[j], want: head.length, got: c.length }); continue; }
      if (isLegend) legend.add(unbold(c[0]));
      else if (isControls) rows.push({ line: j + 1, raw: lines[j], control: c[0], status: unbold(c[sIdx] ?? ""), where: c[wIdx] ?? "" });
    }
    i = j - 1;
  }
  // GFM renders a row without a leading pipe, a pipe-less table, and a table in a
  // blockquote. So EVERY line carrying an unescaped pipe must sit in a recognised
  // table, or it is a row nobody gates (review round 2 of PR #1349).
  lines.forEach((l, k) => { if (!claimed.has(k) && /(^|[^\\])\|/.test(l)) unclaimed.push({ line: k + 1, raw: l }); });
  const closing = /Everything marked \*\*Implemented \(public core\)\*\*[\s\S]{0,400}?is exercised by\s+`pnpm run (proof:[\w:.-]+)`/.exec(text);
  return { legend, legendTables, rows, unclaimed, malformed, defaultProof: closing ? closing[1] : null };
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
    if (/@v?\d/.test(tok)) continue; // a versioned action/package ref (`owner/action@v4`), not a repo path
    if (tok.includes("/") || FILEEXT.test(tok) || /^\.[\w-]+$/.test(tok)) out.push(tok);
  }
  return out;
}

export function citedProofs(where) {
  return [...where.matchAll(/`(?:pnpm run )?(proof:[\w:.-]+)`/g)].map((m) => m[1]);
}

/** Evidence must be IN THE REPOSITORY: a tracked file, or a tracked directory
 *  at least two segments deep (`lib/persistence`, never `lib` or `./`). Paths
 *  with `.`/`..` segments, absolute paths, and anything untracked (node_modules,
 *  .git, build output) resolve to nothing (review round 2 of PR #1349). */
function resolver(root, tracked) {
  const files = new Set(tracked);
  const dirs = new Set();
  for (const f of tracked) {
    const parts = f.split("/");
    for (let k = 1; k < parts.length; k += 1) dirs.add(parts.slice(0, k).join("/"));
  }
  const byBase = new Map();
  for (const f of tracked) {
    const b = f.split("/").pop();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const inRepo = (p) => {
    const segs = p.split("/");
    if (p.startsWith("/") || segs.some((x) => x === "" || x === "." || x === "..")) return null;
    if (files.has(p)) return p;
    return dirs.has(p) && segs.length >= 2 ? p : null;
  };
  return (tok, lastDir) => {
    const t = tok.replace(/\/$/, "").replace(/^\.\/(?=.)/, "");
    if (t.includes("/") || t.startsWith(".")) return inRepo(t);
    if (lastDir && inRepo(`${lastDir}/${t}`)) return `${lastDir}/${t}`;
    const hits = byBase.get(t) ?? [];
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
  const { legend, legendTables, rows, unclaimed, malformed, defaultProof } = parseMatrix(text);
  const resolve = resolver(root, tracked);
  const fails = [];
  const structural = [];
  if (legendTables.length !== 1) structural.push(`expected exactly one Status legend table, found ${legendTables.length}${legendTables.length ? ` (lines ${legendTables.join(", ")})` : ""}`);
  const legendWords = [...legend];
  if (legendWords.length !== EXPECTED_LEGEND.length || !EXPECTED_LEGEND.every((w) => legend.has(w)))
    structural.push(`Status legend is [${legendWords.join(" | ")}], expected exactly [${LEGEND_LIST}] — a legend change must update this gate's checks in the same change`);
  const seen = new Map();
  for (const r of rows) seen.set(r.control, [...(seen.get(r.control) ?? []), r.line]);
  for (const [control, at] of seen) if (at.length > 1) structural.push(`Control "${control}" appears ${at.length} times (lines ${at.join(", ")}) — every control row must be unique\n      ${rows.find((r) => r.line === at[1]).raw}`);
  for (const u of unclaimed) structural.push(`line ${u.line} is a pipe row in no recognised table (Control|…|Status|Where, Status|Meaning, or ${NON_CONTROL_TABLES.map((h) => h.join("|")).join(", ")}) — it would go ungated\n      ${u.raw}`);
  for (const m of malformed) structural.push(`line ${m.line} has ${m.got} cells, its table header has ${m.want} (escaped pipe or missing cell) — columns cannot be trusted\n      ${m.raw}`);
  for (const r of rows) {
    const why = [];
    if (!EXPECTED_LEGEND.includes(r.status)) why.push(`status "${r.status}" is not in the Status legend (${LEGEND_LIST})`);
    if (PATH_CHECKED.has(r.status)) {
      let lastDir = null;
      for (const tok of citedPaths(r.where)) for (const p of expandBraces(tok)) {
        const hit = resolve(p, lastDir);
        if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
        const at = (hit ?? p).includes("/") ? (hit ?? p) : null;
        if (at) lastDir = at.slice(0, at.lastIndexOf("/"));
      }
    }
    if (IMPLEMENTED_LIKE.test(r.status)) {
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
          if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
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
  const used = new Set();
  for (const f of res.fails) {
    const k = KNOWN_FAILURES.findIndex((e, idx) => !used.has(idx) && e.control === f.control && e.status === f.status
      && e.why.length === f.why.length && e.why.every((w, n) => w === f.why[n]));
    if (k !== -1) { used.add(k); known.push({ ...f, reason: KNOWN_FAILURES[k].reason }); continue; }
    bad += 1;
    console.error(`FAIL  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}`);
  }
  KNOWN_FAILURES.forEach((e, idx) => {
    if (!used.has(idx)) { bad += 1; console.error(`FAIL  KNOWN_FAILURES entry "${e.control}" no longer fails exactly as declared (row gone, status changed, or its failures changed) — update or remove it`); }
  });
  for (const f of known) {
    console.log(`KNOWN (owner decision needed)  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}\n      - declared: ${f.reason}`);
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
    // review round 1 of PR #1349: rows the parser cannot place must fail, never vanish
    ["fail: a blank line splits rows from their table", real.replace("\n| Deny-by-default RBAC", "\n\n| Deny-by-default RBAC"), 1],
    ["fail: a controls table's Status column renamed", real.replace("| Control | Framework refs | Status | Where |", "| Control | Framework refs | State | Where |"), 1],
    ["fail: an unrecognised table appended", `${real}\n| Control | Refs | Status | Evidence |\n| --- | --- | --- | --- |\n| Planted bogus | x | Bogus | \`nope.ts\` |\n`, 1],
    ["fail: an escaped pipe shifts a row's columns", plant("| Planted a \\| b control | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 1],
    // review round 2 of PR #1349: KNOWN_FAILURES match exactly; the legend is pinned;
    // evidence must be tracked; a rendered row without a leading pipe is still a row
    ["fail: a known row's status changed", real.replace("| **Implemented in THIS repo** |", "| **Shipped and SOC2 certified** |"), 1],
    ["fail: a known row gains a second failure", real.replace("`lib/webauthn`", "`lib/no-such-dir`"), 1],
    ["fail: a duplicate Control row", plant("| Real authentication provider, sessions, MFA/step-up assurance | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a word added to the legend", real.replace("| **Human-owned (planned)** | A program", "| **Implemented** | done |\n| **Human-owned (planned)** | A program"), 1],
    ["fail: a second legend table", `${real}\n| Status | Meaning |\n| --- | --- |\n| Enforced (production) | done |\n`, 1],
    ["fail: evidence outside the repo (`..`)", plant("| Planted escape | ASVS 5.0 | Implemented (public core) | `lib/../../../../etc/passwd` |"), 1],
    ["fail: evidence that is a top-level dir", plant("| Planted top dir | ASVS 5.0 | Implemented (public core) | `lib/` |"), 1],
    ["fail: evidence that is untracked (node_modules)", plant("| Planted untracked | ASVS 5.0 | Implemented (public core) | `node_modules/typescript/package.json` |"), 1],
    ["fail: a table row without its leading pipe", real.replace("\n| PostgreSQL row-level security", "\nPostgreSQL row-level security").replace("| Private-core (planned) | Private production repo (durable persistence layer) |", "| Bogus | Private production repo (durable persistence layer) |"), 1],
    ["fail: a controls table inside a blockquote", `${real}\n> | Control | Framework refs | Status | Where |\n> | --- | --- | --- | --- |\n> | Planted quoted | x | Bogus | \`nope.ts\` |\n`, 1],
    ["fail: an Automated row citing a missing workflow", real.replace("`.github/workflows/codeql.yml`", "`.github/workflows/no-such.yml`"), 1],
    ["fail: matrix-wide proof binding deleted", real.replace(/is exercised by\s+`pnpm run proof:[\w:.-]+`/, "is exercised by the core proof"), 1],
  ];
  let ok = true;
  try {
    for (const [name, text, want] of cases) {
      const f = join(dir, "SECURITY_CONTROLS_MATRIX.md");
      writeFileSync(f, text);
      const r = spawnSync(process.execPath, [SELF, "--doc", f], { cwd: ROOT, encoding: "utf8" });
      // a failure must QUOTE the offending row (or name the stale entry), never just exit 1
      const quoted = want === 1 ? /FAIL {2}.*\n {6}\S.*\|/.test(r.stderr) || /KNOWN_FAILURES entry ".+" no longer fails/.test(r.stderr) || /FAIL {2}(Status legend is|expected exactly one Status legend)/.test(r.stderr) : true;
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
