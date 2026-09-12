#!/usr/bin/env node
// LightRAG — the KEY-FREE half only (DR-041): a local retrieval index over `docs/`, naive mode,
// local embeddings, no generative model of any kind. Pinned (commit 2db12a3c = lightrag-hku 1.5.8,
// MIT, measured 2026-09-12). The GRAPH is NOT built: it costs exactly 2 LLM calls per chunk
// (3,826 calls and >= 12,476,985 input tokens for one index of this repo's docs), rejects a changed
// file under the same path, and is not byte-reproducible. Nothing here calls a model.
//
// The upstream TREE is deliberately not vendored and not cloned into a session: it ships its own
// `.claude/settings.json` SessionStart hook, and 26 of its modules call `pipmaster` to pip-install
// packages at IMPORT time. `pip install` from the pinned sha takes the PACKAGE only — the hook and
// the repo tree never land. `lightrag/base.py:43` still runs `load_dotenv(dotenv_path=".env")` at
// import, so `docs-retrieval.mjs` runs python with cwd OUTSIDE this repository; a repo `.env` is
// unreachable from it. No server is installed (`lightrag-hku[api]` binds 0.0.0.0 and admits a guest
// token when no key is set) and no hook is written. The venv and the index live OUTSIDE the tree.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const VERSION = "1.5.8", PIN = "2db12a3caf9e702718fffd0593b99413a50edba5";
const SPEC = `lightrag-hku @ git+https://github.com/HKUDS/LightRAG@${PIN}`;
const FASTEMBED = "fastembed==0.8.0", MODEL = "BAAI/bge-small-en-v1.5", DIM = 384;
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const DIR = resolve(process.env.LIGHTRAG_DIR ?? `${process.env.HOME}/signalgrid-lightrag/key-free`);
// `CI` is set by every major provider; `GITHUB_ACTIONS` is belt-and-braces for this repo's workflows.
const IN_CI = process.env.CI === "true" || process.env.CI === "1" || !!process.env.GITHUB_ACTIONS;
const refuse = (why) => { console.error(`lightrag:install refused — ${why}`); process.exit(1); };
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit", cwd: DIR_SAFE() }).status === 0;
function DIR_SAFE() { return existsSync(DIR) ? DIR : undefined; }
if (IN_CI) refuse("this is CI. The index is a local research aid, never a build input; no gate, proof or doc figure may read it. Nothing was done.");
const py = spawnSync("python3", ["-c", "import sys;print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
if (py.status !== 0) refuse("`python3` is not on PATH. Nothing was done.");
const [maj, min] = py.stdout.trim().split(".").map(Number);
if (maj !== 3 || min < 10) refuse(`python3 is ${py.stdout.trim()}; lightrag-hku ${VERSION} requires >= 3.10 (pyproject.toml). Nothing was done.`);
const inTree = (d) => d === ROOT || d.startsWith(ROOT + sep);
if (inTree(DIR)) refuse(`LIGHTRAG_DIR=${DIR} is inside the repo tree (${ROOT}); the venv and the index must live outside it — an untracked file in the tree flips \`provenance.workingTreeClean\` on every later sim result. Nothing was done.`);
try {
  mkdirSync(DIR, { recursive: true });
  // the string check above cannot see a symlink; re-check the REAL path before anything is written
  if (inTree(realpathSync(DIR))) refuse(`LIGHTRAG_DIR resolves (through a symlink) to ${realpathSync(DIR)}, inside the repo tree. Nothing was written.`);
} catch (err) { refuse(`could not prepare ${DIR}: ${err.message}. Nothing was installed.`); }
const VENV = `${DIR}/venv`, PY = `${VENV}/bin/python`, MODELS = `${DIR}/models`;
mkdirSync(MODELS, { recursive: true });
if (!existsSync(PY) && !sh("python3", "-m", "venv", VENV)) refuse(`\`python3 -m venv ${VENV}\` failed. Nothing was installed.`);
if (!existsSync(PY)) refuse(`${PY} is missing after venv creation. Nothing was installed.`);
const t0 = Date.now();
if (!sh(PY, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", SPEC, FASTEMBED))
  refuse(`the pinned install failed (${SPEC} + ${FASTEMBED}); there is no unpinned fallback. Nothing was registered.`);
// Warm the embedding model INTO ${DIR}/models so the first query needs no network, and prove in the
// same breath that the key-free half really is key-free: this embeds with no API key in the process.
const warm = [
  "import json,os,sys",
  "from fastembed import TextEmbedding",
  `m = TextEmbedding(model_name=${JSON.stringify(MODEL)}, cache_dir=os.environ["LIGHTRAG_MODELS"])`,
  "v = list(m.embed(['signalgrid embedding warm-up']))[0]",
  "import lightrag",
  "print(json.dumps({'lightrag': lightrag.__version__, 'embedding_dim': len(v), 'python': '%d.%d.%d' % sys.version_info[:3]}))",
].join("\n");
const w = spawnSync(PY, ["-c", warm], { encoding: "utf8", cwd: DIR, env: { ...process.env, LIGHTRAG_MODELS: MODELS, HF_HUB_OFFLINE: "0" } });
if (w.status !== 0) refuse(`the embedding model ${MODEL} could not be fetched into ${MODELS}: ${(w.stderr || "").trim().split("\n").slice(-3).join(" ")}. Nothing was registered.`);
let warmed;
try { warmed = JSON.parse(w.stdout.trim().split("\n").pop()); } catch { refuse(`the warm-up produced no readable receipt: ${w.stdout.trim().slice(-200)}`); }
if (warmed.lightrag !== VERSION) refuse(`the venv holds lightrag ${warmed.lightrag}, not the pinned ${VERSION}. Nothing was registered.`);
if (warmed.embedding_dim !== DIM) refuse(`${MODEL} embedded to ${warmed.embedding_dim} dimensions, not ${DIM}. Nothing was registered.`);
const seconds = Math.round((Date.now() - t0) / 100) / 10;
const count = spawnSync(PY, ["-m", "pip", "list", "--format=freeze"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).length;
// A receipt, not a config: LightRAG is configured entirely by docs-retrieval.mjs's call, which passes
// NO generative model. There is nothing to turn off here because nothing outbound is turned on.
writeFileSync(`${DIR}/install-receipt.json`, JSON.stringify({
  pin: PIN, version: warmed.lightrag, python: warmed.python, embeddingModel: MODEL, embeddingDim: warmed.embedding_dim,
  packages: count, mode: "naive-only", generativeModel: null, server: false, hooks: false, graph: false,
  installSeconds: seconds, installedAt: new Date().toISOString(),
}, null, 2) + "\n");
console.log(`lightrag ${warmed.lightrag} installed (pinned ${PIN.slice(0, 8)}, python ${warmed.python}, ${count} packages, ${seconds}s) — venv ${VENV}, model ${MODEL} (${warmed.embedding_dim}-dim) cached in ${MODELS}.`);
console.log(`NO generative model, no API key, no server, no hook, no graph. Index with: LIGHTRAG_DIR=${DIR} pnpm run docs:retrieve -- --reindex`);
