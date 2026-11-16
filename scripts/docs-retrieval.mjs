#!/usr/bin/env node
// Retrieval over the docs corpus (DR-041) — LightRAG naive mode, local embeddings, no key, no LLM.
//
//   pnpm run docs:retrieve -- --reindex              index/refresh the tracked docs set
//   pnpm run docs:retrieve -- "how is the launch profile classified"
//   pnpm run docs:retrieve -- --status               what the index holds, and what has drifted
//   pnpm run docs:retrieve -- --self-test            prove the two refusals still refuse
//
// WHAT IT READS AND WHERE IT WRITES — the whole point of the file.
// It reads ONLY tracked markdown under `docs/`, enumerated by `git ls-files`, so an untracked
// draft or a scratch file can never enter the index. It writes NOTHING inside this repository:
// the venv, the index, the embedding model and the manifest all live under `LIGHTRAG_DIR`
// (default `~/signalgrid-lightrag/key-free`, a subdirectory of the store convention DR-038
// set for the Mac lane's graph-mode install, which this never shares an index with), and an
// in-tree path is refused before a directory is created —
// `provenance.workingTreeClean` in `artifacts/sim-results/*.json` counts UNTRACKED files, so one
// stray index directory would stamp every later simulation result as minted from a dirty tree.
//
// WHAT ITS ANSWER IS. A pointer, never a fact. It returns tracked file paths and the matching
// chunk with line numbers; the agent then READS those files. It is the companion to
// `pnpm run check:absence`, never its replacement: a vector search that returns nothing is not
// evidence that nothing is there.
//
// WHY THE WORKER IS PYTHON. LightRAG is a Python library in a venv outside the tree, so the
// calls live in `scripts/lib/docs-retrieval.py`; this file owns the repository side — the tracked
// set, the refusals, the CLI, the line numbers. See that file's header.
//
// REFRESH IS DELETE-THEN-REINDEX, because LightRAG rejects a changed file re-inserted under a
// BASENAME it already holds ("File name already exists.", measured 2026-09-12). The manifest
// hashes each tracked file so only changed, added and removed paths are touched. The first index
// of the whole corpus is the slow one and it is a one-time cost; a refresh touches only the files
// whose hash moved.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const DIR = resolve(process.env.LIGHTRAG_DIR ?? `${process.env.HOME}/signalgrid-lightrag/key-free`);
const VENV_PY = `${DIR}/venv/bin/python`;
const WORKER = `${ROOT}/scripts/lib/docs-retrieval.py`;
const INDEX = `${DIR}/index`;
const MANIFEST = `${DIR}/docs-manifest.json`;
const MODELS = `${DIR}/models`;
const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5", EMBEDDING_DIM = 384;
const IN_CI = process.env.CI === "true" || process.env.CI === "1" || !!process.env.GITHUB_ACTIONS;

const refuse = (why) => { console.error(`docs:retrieve refused — ${why}`); process.exit(1); };
const inTree = (p) => p === ROOT || p.startsWith(ROOT + sep);

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const topK = (() => {
  const i = argv.indexOf("--top-k");
  return i >= 0 && argv[i + 1] ? Math.max(1, Number(argv[i + 1]) | 0) : 5;
})();
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--top-k") { i += 1; continue; }
  if (argv[i].startsWith("--")) continue;
  positional.push(argv[i]);
}

if (flag("--self-test")) { selfTest(); process.exit(0); }
if (IN_CI) refuse("this is CI. The index is a local research aid, never a build input; no gate, proof or doc figure may read it. Nothing was done.");

// ── refusals, in the order that keeps them true ──────────────────────────────
if (inTree(DIR)) refuse(`LIGHTRAG_DIR=${DIR} is inside the repo tree (${ROOT}); the index must live outside it — an untracked file in the tree flips \`provenance.workingTreeClean\` on every later sim result. Nothing was written.`);
if (!existsSync(VENV_PY)) refuse(`${VENV_PY} is missing — run \`pnpm run lightrag:install\` first (it is refused on CI by design). Nothing was done.`);
if (existsSync(DIR) && inTree(realpathSync(DIR))) refuse(`LIGHTRAG_DIR resolves (through a symlink) to ${realpathSync(DIR)}, inside the repo tree. Nothing was written.`);

// ── the corpus: TRACKED markdown under docs/, and nothing else ───────────────
function trackedDocs() {
  const ls = spawnSync("git", ["-C", ROOT, "ls-files", "-z", "--", "docs"], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (ls.status !== 0) refuse(`\`git ls-files\` failed in ${ROOT}: ${(ls.stderr || "").trim()}`);
  return ls.stdout.split("\0").filter((p) => p.endsWith(".md")).sort();
}
const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const readManifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { files: {}, indexedAt: null });

function runWorker(job) {
  // cwd is LIGHTRAG_DIR, OUTSIDE the repository, because `lightrag/base.py` runs
  // `load_dotenv(dotenv_path=".env")` at import: from there a repo `.env` is unreachable.
  const r = spawnSync(VENV_PY, [WORKER], {
    input: JSON.stringify(job), encoding: "utf8", cwd: DIR, maxBuffer: 1 << 28,
    env: { ...process.env, HF_HOME: MODELS, TOKENIZERS_PARALLELISM: "false" },
  });
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop();
  let out = null;
  try { out = line ? JSON.parse(line) : null; } catch { /* falls through to the refusal below */ }
  if (!out) refuse(`the LightRAG worker produced no readable result (exit ${r.status}).\n${(r.stderr || "").trim().split("\n").slice(-6).join("\n")}`);
  if (out.ok !== true) refuse(`the LightRAG worker refused — ${out.error}`);
  return out;
}

// ── the repo path a chunk came from ──────────────────────────────────────────
// LightRAG stores `file_path` as a BASENAME, so it is not the tracked path and several
// docs share one. The authoritative source is the chunk id, which carries the doc id this
// script assigned (`doc-<relPath>-chunk-NNN`); the tilde-joined stored path is the fallback.
function repoPathOf(chunk) {
  const id = chunk.chunkId || "";
  const cut = id.lastIndexOf("-chunk-");
  if (id.startsWith("doc-") && cut > 4) return id.slice(4, cut);
  return (chunk.storedPath || "unknown_source").replace(/~/g, "/");
}

// ── locate a chunk inside its source file, so the answer is a citable line range ──
function lineSpan(relPath, chunk) {
  let text;
  try { text = readFileSync(resolve(ROOT, relPath), "utf8"); } catch { return null; }
  let at = text.indexOf(chunk);
  if (at < 0) {
    const anchor = (chunk.split("\n").find((l) => l.trim().length > 12) || "").trim().slice(0, 80);
    at = anchor ? text.indexOf(anchor) : -1;
  }
  if (at < 0) return null;
  const start = text.slice(0, at).split("\n").length;
  return { start, end: start + chunk.split("\n").length - 1 };
}

// ── operations ───────────────────────────────────────────────────────────────
if (flag("--status")) {
  const manifest = readManifest();
  const tracked = trackedDocs();
  const current = Object.fromEntries(tracked.map((p) => [p, sha(readFileSync(resolve(ROOT, p), "utf8"))]));
  const changed = tracked.filter((p) => manifest.files[p] && manifest.files[p] !== current[p]);
  const added = tracked.filter((p) => !manifest.files[p]);
  const removed = Object.keys(manifest.files).filter((p) => !current[p]);
  console.log(`docs:retrieve status — index ${INDEX}`);
  console.log(`  indexed: ${Object.keys(manifest.files).length} tracked docs${manifest.indexedAt ? ` (last refreshed ${manifest.indexedAt})` : " (never indexed)"}`);
  console.log(`  tracked now: ${tracked.length}`);
  console.log(`  drift: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
  for (const p of [...changed.map((p) => `changed  ${p}`), ...added.map((p) => `added    ${p}`), ...removed.map((p) => `removed  ${p}`)].slice(0, 20)) console.log(`    ${p}`);
  if (changed.length + added.length + removed.length > 20) console.log(`    … and ${changed.length + added.length + removed.length - 20} more`);
  console.log(changed.length + added.length + removed.length === 0 ? "  the index matches the tracked docs set." : "  stale — refresh with: pnpm run docs:retrieve -- --reindex");
  process.exit(0);
}

if (flag("--reindex")) {
  mkdirSync(INDEX, { recursive: true });
  const manifest = readManifest();
  const tracked = trackedDocs();
  const current = Object.fromEntries(tracked.map((p) => [p, sha(readFileSync(resolve(ROOT, p), "utf8"))]));
  const changed = tracked.filter((p) => manifest.files[p] && manifest.files[p] !== current[p]);
  const added = tracked.filter((p) => !manifest.files[p]);
  const removed = Object.keys(manifest.files).filter((p) => !current[p]);
  const docId = (p) => `doc-${p}`;
  if (changed.length + added.length + removed.length === 0) {
    console.log(`docs:retrieve --reindex: nothing to do — ${tracked.length} tracked docs already indexed at ${manifest.indexedAt}.`);
    process.exit(0);
  }
  console.log(`docs:retrieve --reindex: ${added.length} added, ${changed.length} changed (delete-then-reindex), ${removed.length} removed — ${tracked.length} tracked docs.`);
  const started = Date.now();
  const out = runWorker({
    op: "index", repoRoot: ROOT, workingDir: INDEX, modelsDir: MODELS,
    embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM, topK,
    deleteIds: [...changed, ...removed].map(docId),
    insert: [...changed, ...added].map((p) => ({ docId: docId(p), relPath: p, abs: resolve(ROOT, p) })),
  });
  writeFileSync(MANIFEST, JSON.stringify({ files: current, indexedAt: new Date().toISOString(), index: INDEX }, null, 2) + "\n");
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  console.log(`docs:retrieve --reindex: ${out.inserted.length} documents indexed, ${out.deleted.length} deleted first, ${out.embeddedTexts} texts embedded, ${seconds}s. Manifest ${MANIFEST}.`);
  process.exit(0);
}

const query = positional.join(" ").trim();
if (!query) refuse("no query. Usage: `pnpm run docs:retrieve -- \"your question\"`, or `--reindex`, `--status`, `--self-test`.");
if (!existsSync(MANIFEST)) refuse(`nothing is indexed yet — run \`pnpm run docs:retrieve -- --reindex\` first. Nothing was answered.`);

const started = Date.now();
const answer = runWorker({
  op: "query", repoRoot: ROOT, workingDir: INDEX, modelsDir: MODELS,
  embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM, topK, query,
});
const seconds = Math.round((Date.now() - started) / 10) / 100;
console.log(`docs:retrieve — "${query}"`);
console.log(`  mode ${answer.mode}, ${answer.chunks.length} chunks, ${seconds}s, 0 LLM calls (none is configured).\n`);
if (answer.chunks.length === 0) console.log("  no chunk matched. A vector search returning nothing is NOT proof of absence — run `pnpm run check:absence <topic>` and read the matches yourself.");
answer.chunks.forEach((c, i) => {
  const filePath = repoPathOf(c);
  const span = lineSpan(filePath, c.content);
  const where = span ? `${filePath}:${span.start}-${span.end}` : `${filePath} (line span not resolvable — the chunk is normalized, read the file)`;
  console.log(`  [${i + 1}] ${where}`);
  for (const line of c.content.split("\n").slice(0, 8)) console.log(`      ${line.slice(0, 140)}`);
  if (c.content.split("\n").length > 8) console.log(`      … (${c.content.split("\n").length - 8} more lines — READ the file; this is a pointer, not a fact)`);
  console.log("");
});
console.log("Every line above is a pointer into a TRACKED file. Read it before citing it (DR-041).");

// ── self-test: a guard that cannot fail proves nothing ───────────────────────
function selfTest() {
  const me = fileURLToPath(import.meta.url);
  const run = (env, args) => spawnSync(process.execPath, [me, ...args], { encoding: "utf8", env: { ...process.env, ...env, CI: "" , GITHUB_ACTIONS: "" } });
  let failed = 0;
  const check = (name, cond, detail) => { console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : ` — ${detail}`}`); if (!cond) failed += 1; };
  console.log("docs:retrieve --self-test\n");

  // 1. it refuses to write into the tree, and writes nothing when it refuses
  const inTreeDir = `${ROOT}/.lightrag-self-test-must-not-exist`;
  const a = run({ LIGHTRAG_DIR: inTreeDir }, ["--status"]);
  check("an in-tree LIGHTRAG_DIR is refused", a.status === 1 && /inside the repo tree/.test(a.stderr), `exit ${a.status}: ${(a.stderr || a.stdout || "").trim().slice(0, 160)}`);
  check("and nothing was created inside the tree", !existsSync(inTreeDir), `${inTreeDir} exists`);
  const b = run({ LIGHTRAG_DIR: inTreeDir }, ["--reindex"]);
  check("the same refusal covers --reindex", b.status === 1 && /inside the repo tree/.test(b.stderr) && !existsSync(inTreeDir), `exit ${b.status}, dir exists: ${existsSync(inTreeDir)}`);

  // 2. it refuses when the venv is missing, and names the installer
  const noVenv = `${DIR}-self-test-no-venv`;
  const c = run({ LIGHTRAG_DIR: noVenv }, ["--status"]);
  check("a missing venv is refused and names the installer", c.status === 1 && /lightrag:install/.test(c.stderr), `exit ${c.status}: ${(c.stderr || c.stdout || "").trim().slice(0, 160)}`);
  check("and the refusal created no directory either", !existsSync(noVenv), `${noVenv} exists`);

  // 3. the corpus is the TRACKED set — an untracked file under docs/ is not in it
  const tracked = trackedDocs();
  const status = spawnSync("git", ["-C", ROOT, "status", "--porcelain", "--", "docs"], { encoding: "utf8" });
  const untracked = (status.stdout || "").split("\n").filter((l) => l.startsWith("?? ")).map((l) => l.slice(3).trim());
  check("every corpus entry is tracked markdown under docs/", tracked.length > 0 && tracked.every((p) => p.startsWith("docs/") && p.endsWith(".md")), `${tracked.length} paths`);
  // Reported honestly: with no untracked file under docs/ this assertion is vacuous, and a
  // check that cannot fail proves nothing. It is not made falsifiable by PLANTING one —
  // writing into the tree is the exact thing this script refuses to do, and a crash between
  // the write and the unlink would leave the stray file that flips sim-result provenance.
  check(`no untracked path reached the corpus (${untracked.length} untracked path(s) under docs/ to test against${untracked.length === 0 ? " — vacuous here" : ""})`,
    untracked.every((p) => !tracked.includes(p)), `untracked and indexed: ${untracked.filter((p) => tracked.includes(p)).join(", ")}`);

  console.log(`\ndocs-retrieval self-test: ${failed === 0 ? "green" : `${failed} FAILED`} (corpus ${tracked.length} tracked docs under docs/)`);
  if (failed > 0) process.exit(1);
}
