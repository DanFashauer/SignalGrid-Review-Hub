// Shipped-import gate — which scripts run ALONE inside a container, and does every relative import they make ship beside them?
//
//   node scripts/check-shipped-imports.mjs                 # the gate
//   node scripts/check-shipped-imports.mjs --self-test     # the model, both directions
//   node scripts/check-shipped-imports.mjs --mutants       # applies this gate's recorded mutants to a CLEAN tree and prints the tally
//
// WHY. A script bind-mounted or COPYed into a container holds only what ships beside it, so a relative import nothing ships
// is ERR_MODULE_NOT_FOUND at start-up. The fixture IdP did exactly that when it began importing scripts/lib/is-main.mjs: its
// compose overlay mounted the one file and the Prod stack smoke went red. The model is in scripts/lib/shipped-imports.mjs
// (one container per compose service and per Dockerfile stage; the import is satisfied only by the repo file it means).
//
// SCOPE. The model is separable from the entry-guard conversion (PR #1586) and has its own findings; it opened as its own
// PR when it produced most of that PR's review findings. Every shipped-import shape below that is not modelled is either
// REPORTED or a NOT-scanned problem, never a silent pass.
//
// WHAT IT DOES NOT MODEL (the same list is in the gate header, the PR body and the backlog row): compose `extends`,
// `profiles`, `configs:` and `dockerfile_inline`; services merged across ALL tracked compose files rather than per
// `-f` combination; bind-mount sources read relative to the repo root, not to the compose file's own directory;
// `$VAR`/`$ARG` in a source, destination or WORKDIR and `..` sources leaving the repo (reported as "not modelled"; a
// non-literal volume TARGET, a short volume entry that does not parse and `volumes_from` are NOT-scanned problems);
// COPY flags other than --from, --chown, --chmod and --link (`--exclude`, `--parents`: reported as NOT scanned);
// ADD of a URL, a git source or a local archive (reported as NOT scanned); COPY --from an external image (reported
// as not modelled); `.dockerignore`; heredoc COPY (reported as not modelled); files present only in a base image;
// every non-bind mount (named volume, absolute host path, tmpfs) treated as hiding everything the image holds under
// its target; bare-specifier, `require`, `createRequire` and `new URL` references; imports read only from
// scripts/**/*.{mjs,cjs,js}; a RUN is not modelled, so a copied script that is never run is still checked; the
// container's command and entrypoint (a volume over the directory an entry file lives in hides it, unreported). A
// dynamic import whose argument is not a plain string literal, and a specifier written with an escape, are reported.
//
// This gate's entry guard is written out (not imported from a helper): it must run even if a shared helper breaks.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf, makeTree, parseCompose, shippedImportProblems } from "./lib/shipped-imports.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = "scripts/check-shipped-imports.mjs";

/** Scratch directories this process made; removed on exit and on SIGINT/SIGTERM so an interrupted run leaks none. */
const SCRATCH = new Set();
const scratchDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  SCRATCH.add(dir);
  return dir;
};
const dropScratch = (dir) => {
  rmSync(dir, { recursive: true, force: true });
  SCRATCH.delete(dir);
};
const dropAllScratch = () => {
  for (const d of [...SCRATCH]) dropScratch(d);
};


const COMPOSE_NAME = /(?:^|\/)(?:[^/]*compose[^/]*)\.ya?ml$/i;
const DOCKERFILE_NAME = /(?:^|\/)(?:[^/]*(?:dockerfile|containerfile)[^/]*)$/i;

/** Pure: which tracked paths are compose files and which are Dockerfiles/Containerfiles (any directory, any name holding the word). */
export function classifyDeploy(all) {
  return { compose: all.filter((f) => COMPOSE_NAME.test(f)), docker: all.filter((f) => DOCKERFILE_NAME.test(f)) };
}

/** Pure: read each deploy file; one that cannot be read is a problem, never a skip. */
export function loadDeploy(names, read) {
  const items = [];
  const problems = [];
  for (const name of names) {
    try {
      items.push({ name, text: read(name) });
    } catch (err) {
      problems.push(`${name}: tracked deploy file unreadable (${err && err.code}) - NOT scanned`);
    }
  }
  return { items, problems };
}

function deployFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const all = out.split("\0").filter(Boolean);
  return { all, ...classifyDeploy(all) };
}

/** The live shipped-import check. */
function liveShipped({ all: files, read: readFn } = {}) {
  const found = deployFiles();
  const all = files ?? found.all;
  const { compose, docker } = files ? classifyDeploy(files) : found;
  const read = readFn ?? ((f) => readFileSync(join(repoRoot, f), "utf8"));
  const c = loadDeploy(compose, read);
  const d = loadDeploy(docker, read);
  const r = shippedImportProblems({ composes: c.items, dockerfiles: d.items, tree: makeTree({ files: all, read }) });
  // The container the CI compose smoke depends on, by name: a refactor that makes it vanish must not pass on the floors alone.
  const fixtureIdp = (r.shipped.get("compose service idp") ?? []).includes("scripts/fixture-idp.mjs");
  return { ...r, fixtureIdp, problems: [...c.problems, ...d.problems, ...r.problems], composeFiles: c.items.length, dockerFiles: d.items.length };
}


/**
 * The scan, pure: `ship` is the model's result (liveShipped()). Floors: a scan that finds fewer compose files,
 * Dockerfiles, containers or shipped scripts than this tree has, or no fixture-IdP container, has drifted.
 */
export function scan({ ship }) {
  const problems = [];
  const notes = [];
  for (const p of ship.problems) problems.push(p);
  if (ship.composeFiles < 3 || ship.dockerFiles < 2 || ship.containers < 4 || ship.shippedScripts < 3 || ship.fixtureIdp !== true) {
    problems.push(
      `shipped-import scan found only ${ship.composeFiles} compose file(s), ${ship.dockerFiles} Dockerfile(s), ${ship.containers} container(s), ` +
        `${ship.shippedScripts} shipped script(s), fixture IdP container ${ship.fixtureIdp === true ? "present" : "ABSENT"} - the derivation has drifted`,
    );
  }
  for (const d of ship.dropped ?? []) notes.push(`not modelled: ${d}`);
  return { problems, notes };
}

async function selfTest() {
  const checks = [];


  // SHIPPED ALONE, per container. A tiny tree: scripts/a.mjs imports ./lib/h.mjs, which imports nothing.
  const T = { "scripts/a.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/lib/h.mjs": "export const h = 1;\n", "scripts/lib/other.mjs": "export const o = 2;\n", "scripts/dyn.mjs": "const m = await import(`./x/${n}.mjs`);\n", "scripts/data.mjs": 'import d from "./d.json" with { type: "json" };\n', "scripts/d.json": "{}\n", "scripts/up.mjs": 'import { h } from "../scripts/lib/h.mjs";\n' };
  const treeOf = (extra = {}, drop = []) => {
    const files = { ...T, ...extra };
    for (const d of drop) delete files[d];
    return makeTree({ files: Object.keys(files), read: (f) => { if (!(f in files)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files[f]; } });
  };
  const ship = (composes, dockerfiles = [], tree = treeOf()) =>
    shippedImportProblems({ composes: composes.map((text, i) => ({ name: `c${i}.yml`, text })), dockerfiles: dockerfiles.map((text, i) => ({ name: `D${i}`, text })), tree });
  const svc = (name, vols) => `  ${name}:\n    volumes:\n${vols.map((v) => `      - ${v}`).join("\n")}\n`;
  const compose = (...services) => `services:\n${services.join("")}`;
  const A = "./scripts/a.mjs:/app/a.mjs:ro";
  const H = "./scripts/lib/h.mjs:/app/lib/h.mjs:ro";
  const n = (r) => r.problems.length;
  checks.push(["SHIPPED ALONE: an import the container does not hold is a problem", n(ship([compose(svc("idp", [A]))])) === 1]);
  checks.push(["…and is fine once the import is mounted beside the script", n(ship([compose(svc("idp", [A, H]))])) === 0]);
  // M1: another container's mount must not satisfy this one
  checks.push(["M1 the import mounted on a DIFFERENT service does not count", n(ship([compose(svc("idp", [A]), svc("api", [H]))])) === 1]);
  checks.push(["M1 an unrelated sidecar in ANOTHER compose file mounting the helper does not count", n(ship([compose(svc("idp", [A])), compose(svc("sidecar", [H]))])) === 1]);
  checks.push(["M1 an overlay for the SAME service name is merged (the -f case), in either file order", n(ship([compose(svc("idp", [A])), compose(svc("idp", [H]))])) === 0 && n(ship([compose(svc("idp", [H])), compose(svc("idp", [A]))])) === 0]);
  checks.push(["M1 a Dockerfile stage copying the script to ./ is judged alone, whatever a compose service mounts", n(ship([compose(svc("idp", [A, H]))], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n"])) === 1]);
  checks.push(["M1 the file at the resolved path must BE the repo file (a different file mounted at that path)", n(ship([compose(svc("idp", [A, "./scripts/lib/other.mjs:/app/lib/h.mjs:ro"]))])) === 1]);
  // L1: layouts that are correct
  checks.push(["L1 a directory mount ./scripts/lib:/app/lib is enough", n(ship([compose(svc("idp", [A, "./scripts/lib:/app/lib:ro"]))])) === 0]);
  checks.push(["L1 COPY scripts/lib/ ./lib/ is enough", n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n"])) === 0]);
  checks.push(["L1 the helper arriving by COPY --from=<stage> is enough", n(ship([], ["FROM node AS b\nWORKDIR /app\nCOPY scripts/a.mjs ./scripts/\nCOPY scripts/lib/ ./scripts/lib/\nFROM node\nWORKDIR /srv\nCOPY --from=b /app/scripts/a.mjs /app/scripts/lib/h.mjs /srv/\n"])) === 1 && n(ship([], ["FROM node AS b\nWORKDIR /app\nCOPY scripts/a.mjs ./scripts/\nCOPY scripts/lib/ ./scripts/lib/\nFROM node\nWORKDIR /srv\nCOPY --from=b /app/scripts/a.mjs /srv/a.mjs\nCOPY --from=b /app/scripts/lib/ /srv/lib/\n"])) === 0]);
  checks.push(["L1 a .json import served by a .json mount is enough", n(ship([compose(svc("idp", ["./scripts/data.mjs:/app/data.mjs", "./scripts/d.json:/app/d.json"]))])) === 0 && n(ship([compose(svc("idp", ["./scripts/data.mjs:/app/data.mjs"]))])) === 1]);
  checks.push(["L1 a single-file rename COPY scripts/a.mjs /app/server.mjs places it at that path, not under it", n(ship([], ["FROM node\nCOPY scripts/a.mjs /app/server.mjs\nCOPY scripts/lib/h.mjs /app/lib/h.mjs\n"])) === 0]);
  checks.push(["L1 WORKDIR /srv with an absolute /srv/lib/ destination", n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs /srv/\nCOPY scripts/lib/h.mjs /srv/lib/\n"])) === 0]);
  // M2: syntaxes that must be READ
  checks.push(["M2 compose long syntax (type: bind, source, target)", n(ship(["services:\n  idp:\n    volumes:\n      - type: bind\n        source: ./scripts/a.mjs\n        target: /app/a.mjs\n"])) === 1 && n(ship(["services:\n  idp:\n    volumes:\n      - type: bind\n        source: ./scripts/a.mjs\n        target: /app/a.mjs\n      - type: bind\n        source: ./scripts/lib/h.mjs\n        target: /app/lib/h.mjs\n"])) === 0]);
  checks.push(["M2 compose flow-style volumes: [..]", n(ship(["services:\n  idp:\n    volumes: [./scripts/a.mjs:/app/a.mjs, ./scripts/lib/h.mjs:/app/lib/h.mjs]\n"])) === 0 && n(ship(["services:\n  idp:\n    volumes: [./scripts/a.mjs:/app/a.mjs]\n"])) === 1]);
  checks.push(["M2 ${PWD}/ sources are repo-relative", n(ship([compose(svc("idp", ["${PWD}/scripts/a.mjs:/app/a.mjs"]))])) === 1]);
  checks.push(["M2 a ../ source that leaves the repo is dropped and reported, not guessed", ship([compose(svc("idp", ["../scripts/a.mjs:/app/a.mjs"]))]).dropped.length === 1]);
  checks.push(["M2 Dockerfile ADD, lowercase copy, JSON-array COPY and backslash continuations are read", n(ship([], ["FROM node\nworkdir /app\nadd scripts/a.mjs ./\ncopy [\"scripts/lib/h.mjs\", \"./lib/h.mjs\"]\n"])) === 0 && n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs \\\n  ./\n"])) === 1]);
  checks.push(["M2 a glob COPY scripts/*.mjs ./ ships what it matches", n(ship([], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs scripts/*.mjs ./\nCOPY scripts/lib/ ./lib/\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 a relative destination follows WORKDIR (not a hard-coded /app)", n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 0 && n(ship([], ["FROM node\nWORKDIR /srv\nCOPY scripts/a.mjs ./\nWORKDIR /app\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 1]);
  checks.push(["M2 a $ARG in a COPY is dropped and reported", ship([], ["FROM node\nARG X\nCOPY scripts/${X}.mjs ./\n"]).dropped.length === 1]);
  checks.push(["M2 a non-literal dynamic import(`./${x}`) in a shipped script is a problem", n(ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))])) === 1]);
  checks.push(["M2 a ../ import that IS shipped is satisfied (scripts/up.mjs at /app/x reaching /app/scripts/lib/h.mjs)", n(ship([compose(svc("idp", ["./scripts/up.mjs:/app/x/up.mjs", "./scripts/lib/h.mjs:/app/scripts/lib/h.mjs"]))])) === 0]);
  checks.push(["M2 a ../ import is resolved (scripts/up.mjs reaching scripts/lib/h.mjs)", n(ship([compose(svc("idp", ["./scripts/up.mjs:/app/x/up.mjs"]))])) === 1]);
  // L3: fail closed
  checks.push(["L3 unparseable compose YAML is a problem, not silence", n(ship(["services: [unclosed\n"])) === 1]);
  checks.push(["L3 binary-junk compose and Dockerfile content is a problem", n(ship(["services:\n\u0000\u0001\n"])) === 1 && n(ship([], ["FROM node\n\u0000"])) === 1]);
  checks.push(["L3 a shipped script the tree cannot read is a problem", n(ship([compose(svc("idp", [A, H]))], [], treeOf({}, ["scripts/a.mjs"]))) >= 0 && n(shippedImportProblems({ composes: [{ name: "c.yml", text: compose(svc("idp", [A])) }], dockerfiles: [], tree: makeTree({ files: ["scripts/a.mjs"], read: () => { throw Object.assign(new Error("x"), { code: "EACCES" }); } }) })) === 1]);

  // ROUND 5. Each case below pins a defect the round-4 refute found.
  const dock = (text, extra) => ship([], [text], extra);
  const ENTRY = 'FROM node AS b\nWORKDIR /app\nCOPY scripts/ /scripts/\n';
  checks.push(["M1 COPY --from with a RELATIVE source resolves from the stage root, not its WORKDIR", n(dock(ENTRY + "FROM node\nCOPY --from=b scripts/a.mjs /srv/a.mjs\n")) >= 1 && n(dock(ENTRY + "FROM node\nCOPY --from=b /scripts/a.mjs /srv/a.mjs\nCOPY --from=b /scripts/lib/ /srv/lib/\n", treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 FROM <earlier stage> inherits that stage's files and WORKDIR", n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM base AS final\nCOPY scripts/lib/other.mjs /tmp/o.mjs\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 a helper shipped in the BASE stage reaches a runtime stage that adds only the entry", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/lib/ ./lib/\nFROM base AS final\nCOPY scripts/a.mjs ./\n"], treeOf({}, ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"]))) === 0]);
  checks.push(["M2 …and the entry copied only in the base stage is still seen (a runtime stage that inherits it, without the helper, fails)", n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: D0\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/a.mjs ./\nFROM base AS final\nRUN true\n"])) >= 1]);
  checks.push(["M3 a compose build: Dockerfile under ANY name is read from the tree; a missing one is a problem", ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: containers/api.build\n")], [], treeOf({ "containers/api.build": "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n" })).problems.every((x) => x.includes("shipped alone")) && n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: containers/api.build\n")], [], treeOf({ "containers/api.build": "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n" }))) === 1 && ship([compose("  idp:\n    build:\n      dockerfile: nope.build\n")]).problems.some((x) => x.includes("NOT scanned"))]);
  checks.push(["M3 a typo'd target: is a problem, not a skip", ship([compose("  idp:\n    build:\n      dockerfile: D0\n      target: runtmie\n")], ["FROM node AS runtime\nCOPY scripts/a.mjs /app/a.mjs\n"]).problems.some((x) => x.includes("NOT scanned"))]);
  checks.push(["M4 YAML merge keys (<<: *base) are resolved", n(ship(["x-base: &base\n  volumes:\n    - ./scripts/a.mjs:/app/a.mjs\nservices:\n  idp:\n    <<: *base\n"])) === 1 && n(ship(["x-base: &base\n  volumes:\n    - ./scripts/a.mjs:/app/a.mjs\n    - ./scripts/lib/h.mjs:/app/lib/h.mjs\nservices:\n  idp:\n    <<: *base\n"])) === 0]);
  checks.push(["M5 `COPY x .` takes the source's basename (and a second COPY does not overwrite it)", n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs .\nCOPY scripts/lib/h.mjs ./lib/\n")) === 0 && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs .\nCOPY scripts/d.json .\n")) === 1 && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs /app\nCOPY scripts/lib/h.mjs ./lib/\n")) === 0]);
  checks.push(["M6 a builder stage of a compose-built Dockerfile is a container too", n(ship([compose("  web:\n    build:\n      dockerfile: D0\n")], ["FROM node AS builder\nWORKDIR /app\nCOPY scripts/a.mjs ./\nFROM nginx\nCOPY scripts/d.json /usr/share/d.json\n"])) === 1]);
  checks.push(["M8 a bind mount WINS over an image file at the same path", n(ship([compose(svc("idp", ["./scripts/lib/other.mjs:/app/lib/h.mjs:ro"]) + "    build:\n      dockerfile: D0\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/\n"])) === 1]);
  checks.push(["M8 a mounted DIRECTORY hides the image files under it", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    volumes:\n      - ./scripts/other:/app/lib\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs ./lib/h.mjs\n"], treeOf({ "scripts/other/other.mjs": "export const o = 1;\n" }))) === 1]);
  checks.push(["L4 a `$` in a plain-quoted specifier is read (import \"./lib/$helper.mjs\")", n(ship([compose(svc("idp", ["./scripts/dollar.mjs:/app/dollar.mjs"]))], [], treeOf({ "scripts/dollar.mjs": 'import "./lib/$helper.mjs";\n' }))) === 1]);
  checks.push(["L4 a dynamic import with a non-literal argument is reported (not mangled into a path)", ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))]).problems.every((x) => x.includes("cannot resolve")) && n(ship([compose(svc("idp", ["./scripts/dyn.mjs:/app/dyn.mjs"]))])) === 1]);
  checks.push(["L5 continuations, lowercase instructions and ADD each place the files (a model that reads nothing ships none)", ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/h.mjs \\\n  /app/lib/h.mjs\n", "from node\nworkdir /app\ncopy scripts/a.mjs ./\ncopy scripts/lib/h.mjs ./lib/h.mjs\n", "FROM node\nWORKDIR /app\nADD scripts/a.mjs ./\nADD scripts/lib/h.mjs ./lib/h.mjs\n"].every((d) => ship([], [d]).shippedScripts === 2 && n(ship([], [d])) === 0)]);
  checks.push(["L5 compose build: shows the image files in the service (host identity by FULL path, not basename)", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n")], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/other/h.mjs ./lib/h.mjs\n"], treeOf({ "scripts/other/h.mjs": "export const h = 3;\n" }))) === 1]);
  checks.push(["L5 an unreadable deploy file is a problem (loadDeploy)", loadDeploy(["c.yml"], () => { throw Object.assign(new Error("x"), { code: "EACCES" }); }).problems.length === 1 && loadDeploy(["c.yml"], () => "x").problems.length === 0]);
  checks.push(["L5 deploy discovery finds every spelling (compose.yaml, nested overrides, *.Dockerfile, Containerfile)", (() => {
    const c = classifyDeploy(["compose.yaml", "docker-compose.yaml", "deploy/docker-compose.override.yml", "docker/compose.dev.yml", "scripts/idp.Dockerfile", "Containerfile", "Dockerfile.api", "scripts/x.mjs"]);
    return c.compose.length === 4 && c.docker.length === 3;
  })()]);
  checks.push(["L5 COPY --from an external image is reported as not modelled", ship([], ["FROM node\nCOPY --from=nginx:latest /etc/x /x\n"]).dropped.some((x) => x.includes("not an earlier stage"))]);
  checks.push(["L7 a compose file with no services mapping, or scalar text, or NUL-free binary is a problem", ["version: \"3\"\n", "just text\n", "services: idp\n", "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008 services:\n"].every((t) => n(ship([t])) === 1) && n(ship([], ["FROM node\n\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\n"])) === 1]);
  const BUILDER = "FROM node AS Builder\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM node\n";
  checks.push(["L8 FROM node AS Builder / --from=builder match case-insensitively (no false positive, nothing dropped)", n(dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\nCOPY --from=builder /app/lib/ /srv/lib/\n")) === 0 && !dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\n").dropped.length && n(dock(BUILDER + "COPY --from=builder /app/a.mjs /srv/a.mjs\n")) === 1]);
  const SLIM = ["scripts/dyn.mjs", "scripts/data.mjs", "scripts/up.mjs"];
  const ctxTree = treeOf({ "scripts/xa/entry.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/xa/lib/h.mjs": "export const h = 1;\n", "scripts/xb/entry.mjs": 'import { h } from "./lib/h.mjs";\n' }, SLIM);
  const twoCtx = (a, b) => compose(`  da:\n    build:\n      context: ${a}\n      dockerfile: ../../D0\n  db:\n    build:\n      context: ${b}\n      dockerfile: ../../D0\n`);
  const DCOPY = "FROM node\nWORKDIR /app\nCOPY . ./\n";
  checks.push(["D1 two services building the SAME Dockerfile from different contexts are judged on their own files", n(ship([twoCtx("scripts/xa", "scripts/xb")], [DCOPY], ctxTree)) === 1 && n(ship([twoCtx("scripts/xb", "scripts/xa")], [DCOPY], ctxTree)) === 1 && n(ship([compose("  da:\n    build:\n      context: scripts/xa\n      dockerfile: ../../D0\n")], [DCOPY], ctxTree)) === 0]);
  checks.push(["D4 COPY --exclude and --parents fail closed (NOT scanned); --chown/--chmod/--link are modelled", ship([], ["FROM node\nCOPY --exclude=is-main.mjs scripts/lib/ ./lib/\n"]).problems.some((x) => x.includes("not modelled - NOT scanned")) && ship([], ["FROM node\nCOPY --parents scripts/a.mjs /app/\n"]).problems.some((x) => x.includes("not modelled - NOT scanned")) && n(dock("FROM node\nWORKDIR /app\nCOPY --chown=1:1 --chmod=755 --link scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n")) === 0]);
  const IMG = "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n";
  const withVol = (vols) => compose(`  idp:\n    build:\n      dockerfile: D0\n    volumes:\n${vols}`);
  checks.push(["D6 a non-bind mount hides what the image holds under its target (volume nocopy, named, absolute host path, tmpfs)", [
    withVol("      - type: volume\n        source: libvol\n        target: /app/lib\n        volume:\n          nocopy: true\n"),
    withVol("      - libvol:/app/lib\n"),
    withVol("      - /opt/x:/app/lib\n"),
    compose("  idp:\n    build:\n      dockerfile: D0\n    tmpfs:\n      - /app/lib\n"),
  ].every((c) => n(ship([c], [IMG])) >= 1) && n(ship([withVol("      - datavol:/var/data\n")], [IMG])) === 0]);
  checks.push(["D5 import-looking text inside another string or template is not an import", n(ship([compose(svc("idp", ["./scripts/qs.mjs:/app/qs.mjs"]))], [], treeOf({ "scripts/qs.mjs": "const example = 'import x from \"./missing.mjs\"';\nconst t = `from \"./also-missing.mjs\"`;\nconst u = \"import('./nope.mjs')\";\n" }))) === 0]);
  checks.push(["R5-A parent directories of a destination are directories (COPY x /app after COPY y /app/other/)", n(dock("FROM node\nCOPY scripts/other/ /app/other/\nCOPY scripts/lib/ /lib/\nCOPY scripts/e.mjs /app\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/other/o.mjs": "export const o = 1;\n" }, SLIM))) >= 1 && n(dock("FROM node\nCOPY scripts/lib/ /app/lib/\nCOPY scripts/e.mjs /app\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n' }, SLIM))) === 0]);
  // R5-C survivors, each as a case
  checks.push(["R5-C a string build: context is read (build: ./containersx -> containersx/Dockerfile is not tracked)", ship([compose("  idp:\n    build: ./containersx\n")]).problems.some((x) => x.includes("containersx/Dockerfile") && x.includes("NOT scanned")) && n(ship([compose("  idp:\n    build: .\n")], [], treeOf({ Dockerfile: "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs scripts/lib/h.mjs /app/\n" }))) >= 1]);
  checks.push(["R5-C a build Dockerfile the tree lists but cannot read is a problem naming the reason", shippedImportProblems({ composes: [{ name: "c.yml", text: compose("  idp:\n    build:\n      dockerfile: bad.build\n") }], dockerfiles: [], tree: makeTree({ files: ["bad.build"], read: () => { throw Object.assign(new Error("x"), { code: "EISDIR" }); } }) }).problems.some((x) => x.includes("unreadable (EISDIR)"))]);
  checks.push(["R5-C FROM <Base> and target: <Runtime> match stage names case-insensitively; COPY --from=<index> resolves", n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n      target: Runtime\n")], ["FROM node AS base\nWORKDIR /app\nCOPY scripts/lib/ ./lib/\nFROM Base AS runtime\nCOPY scripts/a.mjs ./\n"], treeOf({}, SLIM))) === 0 && (() => { const r = dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM node\nCOPY --from=0 /app/ /srv/\n", treeOf({}, SLIM)); return r.problems.length === 0 && r.dropped.length === 0 && r.shippedScripts === 6; })()]);
  checks.push(["R5-C heredoc COPY, WORKDIR $VAR and dockerfile_inline are reported as not modelled; a Dockerfile with no FROM is a problem", ship([], ["FROM node\nCOPY <<EOF /x\nhi\nEOF\n"]).dropped.some((x) => x.includes("heredoc")) && ship([], ["FROM node\nWORKDIR $X\n"]).dropped.some((x) => x.includes("WORKDIR $X")) && ship([compose("  idp:\n    build:\n      dockerfile_inline: |\n        FROM node\n")]).dropped.some((x) => x.includes("dockerfile_inline")) && ship([], ["COPY a b\n"]).problems.some((x) => x.includes("no FROM"))]);
  // the LIVE computation behind the fixture-IdP floor, and a dropped read problem, through the same path the CLI uses
  const liveAll = deployFiles().all;
  const liveRead = (f) => readFileSync(join(repoRoot, f), "utf8");
  checks.push(["R5-C LIVE: the fixture-IdP floor is computed (an overlay cut down to `image: node` loses the container)", liveShipped({ all: liveAll, read: liveRead }).fixtureIdp === true && liveShipped({ all: liveAll, read: (f) => (f === "scripts/fixture-idp.compose.yml" ? "services:\\n  idp:\\n    image: node\\n" : liveRead(f)) }).fixtureIdp === false]);
  checks.push(["R5-C LIVE: an unreadable compose file reaches the gate's problems (not dropped on the way)", liveShipped({ all: liveAll, read: (f) => { if (f === "docker-compose.sim.yml") throw Object.assign(new Error("x"), { code: "ELOOP" }); return liveRead(f); } }).problems.some((x) => x.includes("docker-compose.sim.yml") && x.includes("NOT scanned"))]);

  // dynamic literal import, comments, case, and the scan's own reporting
  checks.push(["a literal dynamic import(\"./lib/h.mjs\") in a shipped script is read", n(ship([compose(svc("idp", ["./scripts/dynlit.mjs:/app/dynlit.mjs"]))], [], treeOf({ "scripts/dynlit.mjs": 'const m = await import("./lib/h.mjs");\n' }))) === 1]);
  checks.push(["an import quoted in a comment or a string is not an import", n(ship([compose(svc("idp", ["./scripts/quoted.mjs:/app/quoted.mjs"]))], [], treeOf({ "scripts/quoted.mjs": '// import { h } from "./lib/nothere.mjs";\nconst s = "import x from \\"./lib/nothere2.mjs\\"";\n' }))) === 0]);
  checks.push(["paths are case-sensitive: only a lib/ mount exists, the import says ./Lib/", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", "./scripts/Lib/h.mjs:/app/lib/h.mjs"]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n', "scripts/Lib/h.mjs": "export const h = 1;\n" }))) === 1]);
  checks.push(["paths are case-sensitive (a different file mounted at the folded path)", n(ship([compose(svc("idp", ["./scripts/cs.mjs:/app/cs.mjs", H]))], [], treeOf({ "scripts/cs.mjs": 'import { h } from "./Lib/h.mjs";\n' }))) === 1]);

  // THE SCAN, as the CLI reports it
  const okShip = { problems: [], composeFiles: 3, dockerFiles: 2, containers: 4, shippedScripts: 3, fixtureIdp: true, dropped: [] };
  const scanOf = (over = {}) => scan({ ship: okShip, ...over });
  checks.push(["SCAN: a shipped-import problem is REPORTED by the scan (not only by the self-test)", scanOf({ ship: { ...okShip, problems: ["c: boom"] } }).problems.includes("c: boom")]);
  checks.push(["SCAN: a shipped-import scan below ANY of its floors is a problem", ["shippedScripts", "containers", "composeFiles", "dockerFiles"].every((k) => scanOf({ ship: { ...okShip, [k]: 1 } }).problems.length === 1) && scanOf({ ship: { ...okShip, fixtureIdp: false } }).problems.length === 1]);
  checks.push(["SCAN: a \"not modelled\" drop is surfaced as a note, never swallowed", scanOf({ ship: { ...okShip, dropped: ["x: COPY $A ./"] } }).notes.some((x) => x.includes("not modelled"))]);
  const imp = (t) => importsOf(t);
  checks.push(["CX2 every non-literal dynamic import is unresolved: concatenation, a template with an expression, an identifier; literals are read", imp('await import("./lib/" + name + ".mjs");\n').unresolved.length === 1 && imp("await import(`./lib/` + n);\n").unresolved.length === 1 && imp("await import(`./lib/${n}.mjs`);\n").unresolved.length === 1 && imp("await import(name);\n").unresolved.length === 1 && imp('await import("./lib/h.mjs");\n').unresolved.length === 0 && imp('await import("./lib/h.mjs");\n').rel[0] === "./lib/h.mjs" && imp("await import(`./lib/h.mjs`);\n").unresolved.length === 0]);
  const bsvc = (df, extra = "") => `  s3:\n    build:\n      dockerfile: ${df}\n${extra}`;
  checks.push(["CX3 two compose files that disagree on a service's build key are a NOT-scanned problem (the -f order is unknown), never a union", ship([compose(bsvc("D0")), compose(bsvc("D1"))], ["FROM node\\nWORKDIR /app\\nCOPY scripts/lib/ ./lib/\\n".replace(/\\n/g, "\n"), "FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\n"], treeOf({}, SLIM)).problems.some((x) => x.includes("-f order is unknown")) && n(ship([compose(bsvc("D0")), compose(bsvc("D0", "      args:\n        X: 1\n"))], ["FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n"], treeOf({}, SLIM))) === 0 && n(ship([compose(bsvc("D0")), compose("  s3:\n    build:\n      target: x\n")], ["FROM node AS x\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n"], treeOf({}, SLIM))) === 0]);
  // R6-C trailing slashes
  checks.push(["R6-C a trailing-slash destination or WORKDIR is a known directory (fail-open and false-positive plants from the refute)", n(dock("FROM node\nCOPY scripts/other/ /app/\nCOPY scripts/lib/ /lib/\nCOPY scripts/e.mjs /app\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/other/o.mjs": "export const o = 1;\n" }, SLIM))) >= 1 && n(dock("FROM node\nWORKDIR /app/\nCOPY scripts/lib/ /lib/\nCOPY scripts/e.mjs /app\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n' }, SLIM))) >= 1 && n(dock("FROM node\nWORKDIR /app/\nCOPY scripts/e.mjs .\nCOPY scripts/lib/ ./lib/\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n' }, SLIM))) === 0]);
  checks.push(["Y13 every ancestor of a destination is a directory, not only the immediate parent", n(dock("FROM node\nCOPY scripts/other/ /app/a/b/\nCOPY scripts/lib/ /lib/\nCOPY scripts/e.mjs /app\n", treeOf({ "scripts/e.mjs": 'import { h } from "./lib/h.mjs";\n', "scripts/other/o.mjs": "export const o = 1;\n" }, SLIM))) >= 1]);
  // R6-D / Y09 / Y19 hides
  checks.push(["R6-D an anonymous short-form volume hides its target; Y09 tmpfs options are stripped; Y19 a trailing-slash target is normalised", (r1 => r1.problems.length >= 1 && !r1.problems.some((x) => x.includes("does not parse")))(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    volumes: [/app/lib]\n")], [IMG])) && n(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    tmpfs:\n      - /app/lib:size=1m\n")], [IMG])) >= 1 && n(ship([withVol("      - libvol:/app/lib/\n")], [IMG])) >= 1]);
  checks.push(["Y01 the builder stage of each build context is its own container (the other-stage id carries the context)", n(ship([twoCtx("scripts/xa", "scripts/xb")], ["FROM node AS b\nCOPY . /src/\nFROM node\nRUN true\n"], ctxTree)) === 1 && n(ship([twoCtx("scripts/xb", "scripts/xa")], ["FROM node AS b\nCOPY . /src/\nFROM node\nRUN true\n"], ctxTree)) === 1]);
  checks.push(["Y17 the fixture-IdP floor needs fixture-idp.mjs IN the idp container (the helper alone is not it)", liveShipped({ all: liveAll, read: (f) => (f === "scripts/fixture-idp.compose.yml" ? liveRead(f).replace(/^.*fixture-idp\.mjs:\/app.*$/m, "") : liveRead(f)) }).fixtureIdp === false]);
  // Y24: `from` is not followed by an arbitrary string; Y11: template expressions keep offsets
  checks.push(["Y24 a variable called `from` followed by a string is not an import", importsOf('const from = 1; const s = "./missing.mjs";\n').rel.length === 0]);
  checks.push(["Y11 a template expression before an import does not shift the offsets used to read the specifier", importsOf("const t = `${a}${b}`; import x from \"./m.mjs\";\n").rel[0] === "./m.mjs"]);
  checks.push(["KNOWN MISS: a `/` after `)` is read as a division and can hide an import later on the same line", importsOf('if (x) /"/.test(s); import t from "./m.mjs";\n').rel.length === 0]);

  // ROUND 8: the findings this PR opens with (moved from the entry-guard core, PR #1586) and the refute's shipped-import LOWs.
  const XS = { "scripts/xs/Dockerfile": "FROM node\nWORKDIR /app\nCOPY ../e.mjs /app/e.mjs\n", "scripts/xs/e.mjs": 'import "./missing.mjs";\n', "scripts/e.mjs": "export const e = 1;\n", "scripts/xs/lib/h.mjs": "export const h = 1;\n", "scripts/xo/o.mjs": "export const o = 1;\n", "scripts/xo/lib/h2.mjs": "export const h2 = 1;\n", "scripts/xs/bundle.tar": "x" };
  const xsTree = (more = {}) => treeOf({ ...XS, ...more }, SLIM);
  checks.push(["CX8 a `..` COPY source is clamped inside the build context (as BuildKit does); it cannot read a file outside it", n(ship([compose("  idp:\n    build: ./scripts/xs\n")], [], xsTree())) >= 1 && n(ship([compose("  idp:\n    build:\n      context: .\n      dockerfile: D0\n")], ["FROM node\nWORKDIR /app\nCOPY ../scripts/xs/e.mjs /app/e.mjs\n"], xsTree())) >= 1]);
  const mount = (m) => `  idp:\n    volumes:\n      - ${m}\n`;
  checks.push(["CX9 two compose files that mount DIFFERENT sources at one target are a NOT-scanned problem (the -f order is unknown); the same source twice is fine; a bind and a volume at one target conflict", ship([compose(mount("./scripts/xs/lib:/app/lib")), compose(mount("./scripts/xo:/app/lib"))], [], xsTree()).problems.some((x) => x.includes("mount different sources")) && ship([compose(mount("./scripts/xs/lib:/app/lib")), compose(mount("./scripts/xs/lib:/app/lib"))], [], xsTree()).problems.length === 0 && ship([compose(mount("./scripts/xs/lib:/app/lib")), compose(mount("libvol:/app/lib"))], [], xsTree()).problems.some((x) => x.includes("mounts a volume there"))]);
  const FROMB = "FROM node AS builder\nWORKDIR /out\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\nFROM node\n";
  checks.push(["CX10 a wildcard COPY --from source is expanded against the source stage's files", n(dock(FROMB + "COPY --from=builder /out/a*.mjs /app/\n", treeOf({}, SLIM))) === 1 && n(dock(FROMB + "COPY --from=builder /out/a*.mjs /app/\nCOPY scripts/lib/ /app/lib/\n", treeOf({}, SLIM))) === 0]);
  checks.push(["CX11 a directory COPY WITHOUT a trailing slash still creates its destination as a directory", n(dock("FROM node\nWORKDIR /app\nCOPY scripts/xo /app/bar\nCOPY scripts/xs/e.mjs /app/bar\nCOPY scripts/lib/h.mjs /app/lib/h.mjs\n", xsTree())) >= 1 && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/xo/ /app/bar/\nCOPY scripts/xs/e.mjs /app/bar\nCOPY scripts/lib/h.mjs /app/lib/h.mjs\n", xsTree())) >= 1]);
  checks.push(["CX12 ADD of a local archive, a URL or a git source is NOT scanned (it is fetched or extracted, not copied); ADD of a plain file is modelled", ["ADD scripts/xs/bundle.tar /app/", "ADD https://example.invalid/x.tgz /app/", "ADD git@example.invalid:r.git /app/"].every((l) => ship([], [`FROM node\n${l}\n`], xsTree()).problems.some((x) => x.includes("NOT scanned"))) && n(dock("FROM node\nWORKDIR /app\nADD scripts/a.mjs ./\nADD scripts/lib/ ./lib/\n", treeOf({}, SLIM))) === 0]);
  checks.push(["CX13 a specifier written with an escape is unresolved, in the from, import and import() forms", ['import ".\\x2fhelper.mjs";\n', 'import x from ".\\x2fhelper.mjs";\n', 'await import(".\\x2fhelper.mjs");\n'].every((t) => importsOf(t).unresolved.length === 1 && importsOf(t).rel.length === 0) && importsOf('import "./helper.mjs";\n').rel[0] === "./helper.mjs"]);
  checks.push(["CX13 at gate level: an escaped specifier in a shipped script is a problem", n(ship([compose(svc("idp", ["./scripts/esc.mjs:/app/esc.mjs"]))], [], treeOf({ "scripts/esc.mjs": 'import ".\\x2fmissing.mjs";\n' }, SLIM))) === 1]);
  checks.push(["R7-A a ${VAR} volume target (short or long) and volumes_from are NOT-scanned problems; a literal anonymous volume still hides", ship([compose("  idp:\n    volumes:\n      - libvol:${LIBDIR:-/app/lib}\n")]).problems.some((x) => x.includes("NOT scanned")) && ship([compose("  idp:\n    volumes:\n      - type: volume\n        source: libvol\n        target: ${LIBDIR}\n")]).problems.some((x) => x.includes("NOT scanned")) && ship([compose("  idp:\n    volumes_from: [da]\n")]).problems.some((x) => x.includes("volumes_from")) && (r1 => r1.problems.length >= 1 && !r1.problems.some((x) => x.includes("does not parse")))(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    volumes: [/app/lib]\n")], [IMG]))]);
  const XSF = { "scripts/xs/Dockerfile": "FROM node AS dev\nWORKDIR /app\nCOPY e.mjs ./\nCOPY lib/ ./lib/\nFROM node AS prod\nWORKDIR /app\nCOPY e.mjs ./\nCOPY lib/ ./lib/\n", "scripts/xs/e.mjs": 'import "./lib/h.mjs";\n', "scripts/xs/lib/h.mjs": "export {};\n" };
  checks.push(["R7-B an overlay that sets only `target` leaves the earlier non-root `context` alone", n(ship([compose("  idp:\n    build:\n      context: ./scripts/xs\n"), compose("  idp:\n    build:\n      target: dev\n")], [], xsTree(XSF))) === 0]);
  checks.push(["R7-G/O06 disagreeing `target` values (not only `dockerfile`) are a NOT-scanned problem", ship([compose("  idp:\n    build:\n      context: ./scripts/xs\n      target: dev\n"), compose("  idp:\n    build:\n      target: prod\n")], [], xsTree(XSF)).problems.some((x) => x.includes("sets build.target"))]);
  checks.push(["R7-G/O11 an anonymous volume with a trailing slash hides its target", (r1 => r1.problems.length >= 1 && !r1.problems.some((x) => x.includes("does not parse")))(ship([compose("  idp:\n    build:\n      dockerfile: D0\n    volumes: [/app/lib/]\n")], [IMG]))]);
  checks.push(["R7-G/O17 `from\"x\"` with no space is an import; a member call `loader.import(x)` is not an unresolved import()", importsOf('import t from"./m.mjs";\n').rel[0] === "./m.mjs" && importsOf("loader.import(x);\n").unresolved.length === 0 && importsOf("await import(x);\n").unresolved.length === 1]);

  // THE LIVE TREE
  const liveShip = liveShipped();
  checks.push([`LIVE: every script a compose service or Dockerfile stage ships alone has its relative imports shipped (${liveShip.shippedScripts} shipped over ${liveShip.containers} containers)`, liveShip.problems.length === 0]);
  checks.push(["LIVE: the floors hold (compose files, Dockerfiles, containers and shipped scripts are all found)", liveShip.composeFiles >= 3 && liveShip.dockerFiles >= 2 && liveShip.containers >= 4 && liveShip.shippedScripts >= 3]);

  // THE GATE IMPORTED FROM `node -e` must not run itself (with and without an argv[1])
  const importedGate = (extra) => spawnSyncNode(["--input-type=module", "-e", `await import(${JSON.stringify(import.meta.url)});`, ...extra]);
  checks.push(["the gate's own entry guard does not run the gate when it is imported from `node -e` (dummy argv[1] or none)", [[], ["dummy-arg"]].every((x) => { const r = importedGate(x); return r.status === 0 && r.stdout === "" && r.stderr === ""; })]);

  // --mutants' refusals through injected dependencies (the signal handling is the same code as the entry-guard gate's runner, which has the real-signal cases)
  const mutRun = async (deps) => {
    const log = console.log;
    const err = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      return await runMutants({ root: repoRoot, mutants: [], ...deps });
    } finally {
      console.log = log;
      console.error = err;
    }
  };
  checks.push(["--mutants refuses a dirty working tree", (await mutRun({ gitStatus: () => " M scripts/x.mjs\n", run: async () => ({ status: 0 }) })) === 2]);
  checks.push(["--mutants refuses a failing unmutated baseline", (await mutRun({ gitStatus: () => "", run: async () => ({ status: 1 }) })) === 2 && (await mutRun({ gitStatus: () => "", run: async () => ({ status: 0 }) })) === 0]);
  checks.push(["--mutants: a mutant whose target text is absent is NOT APPLIED and fails the run", (await mutRun({ gitStatus: () => "", run: async () => ({ status: 0 }), mutants: [["absent", "scripts/lib/shipped-imports.mjs", "THIS TEXT IS NOT IN THE FILE", "x"]] })) === 1]);
  checks.push(["--mutants: a child that dies of a signal, exits 130/143 or times out is never counted as killed", await (async () => {
    const pick = (second) => { let calls = 0; return async () => (++calls === 1 ? { status: 0 } : second); };
    const one = [["noop", "scripts/lib/shipped-imports.mjs", "export function makeTree", "export function makeTree"]];
    const r1 = await mutRun({ gitStatus: () => "", mutants: one, run: pick({ status: null, signal: "SIGINT" }) });
    const r2 = await mutRun({ gitStatus: () => "", mutants: one, run: pick({ status: null, timedOut: true }) });
    const r3 = await mutRun({ gitStatus: () => "", mutants: one, run: pick({ status: 143 }) });
    const r4 = await mutRun({ gitStatus: () => "", mutants: one, run: pick({ status: 1 }) });
    return r1 === 1 && r2 === 1 && r3 === 1 && r4 === 0;
  })()]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

function spawnSyncNode(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120000 });
}

/** Mutation set: each entry is a one-spot edit that makes a real defect; `--mutants` applies them one at a time to a CLEAN tree and runs the self-test. */
export const MUTANTS = [
  ["unreadable shipped file is silent", "scripts/lib/shipped-imports.mjs", "problems.push(`${c.id}: ${host} is shipped to ${cpath} but unreadable (${err && err.code}) - its imports were NOT checked`);", "void err;"],
  ["dotdot segments ignored", "scripts/lib/shipped-imports.mjs", "const wantContainer = posix.normalize(posix.join(posix.dirname(cpath), spec));", "const wantContainer = posix.join(posix.dirname(cpath), spec.replace(/\\.\\.\\//g, \"\"));"],
  ["paths case-folded", "scripts/lib/shipped-imports.mjs", "const got = byContainer.get(wantContainer);", "const got = [...byContainer].find(([k]) => k.toLowerCase() === wantContainer.toLowerCase())?.[1];"],
  ["literal dynamic import(..) not read", "scripts/lib/shipped-imports.mjs", "literalAt.add(m.index); // import(\"./y\"), or an uninterpolated template: exactly quote, blank body, quote, then , or )\n    read(m);", "literalAt.add(m.index); // import(\"./y\"), or an uninterpolated template: exactly quote, blank body, quote, then , or )\n    void 0;"],
  ["non-literal dynamic import not reported", "scripts/lib/shipped-imports.mjs", "if (!literalAt.has(m.index)) unresolved.push(", "if (false) unresolved.push("],
  ["COPY --from ignored", "scripts/lib/shipped-imports.mjs", "if (op.fromStage !== null) {", "if (false) {"],
  ["codeOnly dropped in importsOf", "scripts/lib/shipped-imports.mjs", "const marked = codeOnly(text, false);", "const marked = text;"],
  ["containers pooled", "scripts/lib/shipped-imports.mjs", "for (const p of c.pairs) byContainer.set", "for (const p of containers.flatMap((x) => x.pairs)) byContainer.set"],
  ["host-file identity check dropped", "scripts/lib/shipped-imports.mjs", "else if (got !== wantHost)", "else if (false)"],
  ["WORKDIR ignored", "scripts/lib/shipped-imports.mjs", "cur.workdir = clean(rest.startsWith(\"/\") ? rest : posix.join(cur.workdir, rest));", "cur.workdir = \"/app\";"],
  ["overlay merge by service name dropped", "scripts/lib/shipped-imports.mjs", "const cur = services.get(svc) ?? { entries: [], hides: [], build: null, dropped: [] };", "const cur = { entries: [], hides: [], build: null, dropped: [] };"],
  ["compose long syntax ignored", "scripts/lib/shipped-imports.mjs", "bind = v.type === \"bind\" || v.type === undefined;", "bind = false;"],
  ["directory mounts not expanded", "scripts/lib/shipped-imports.mjs", "if (tree.isDir(e.host)) for (const f of tree.under(e.host)) mounts.push", "if (false) for (const f of tree.under(e.host)) mounts.push"],
  ["COPY --from relative source resolved from WORKDIR", "scripts/lib/shipped-imports.mjs", "posix.join(\"/\", s)", "posix.join(src.workdir, s)"],
  ["FROM <stage> does not inherit", "scripts/lib/shipped-imports.mjs", "if (stage.base) {", "if (false) {"],
  ["build Dockerfile only found under Dockerfile* names", "scripts/lib/shipped-imports.mjs", "if (tree.isFile(df)) {", "if (false) {"],
  ["unknown build target is silent", "scripts/lib/shipped-imports.mjs", "if (!stage) problems.push(`compose service ${svc}: build target", "if (false) problems.push(`compose service ${svc}: build target"],
  ["YAML merge keys off", "scripts/lib/shipped-imports.mjs", "{ merge: true }", "{}"],
  ["an existing directory is not a directory destination", "scripts/lib/shipped-imports.mjs", "const intoDir = op.destSlash || op.srcs.length > 1 || res.known.has(op.dest);", "const intoDir = op.destSlash || op.srcs.length > 1;"],
  ["other stages of a compose-built Dockerfile are not containers", "scripts/lib/shipped-imports.mjs", "if (other === stage || containers.some((c) => c.id === id)) continue;", "continue;"],
  ["image files win over bind mounts", "scripts/lib/shipped-imports.mjs", "pairs: [...kept, ...mounts]", "pairs: [...mounts, ...kept]"],
  ["a mounted directory does not hide image files", "scripts/lib/shipped-imports.mjs", "const covered = [...mountedDirs, ...def.hides.map((h) => h.path)];", "const covered = [...def.hides.map((h) => h.path)];"],
  ["non-bind mounts hide nothing", "scripts/lib/shipped-imports.mjs", "const covered = [...mountedDirs, ...def.hides.map((h) => h.path)];", "const covered = [...mountedDirs];"],
  ["the specifier is read from the blanked text, not the original", "scripts/lib/shipped-imports.mjs", "const spec = text.slice(lo, hi);", "const spec = marked.slice(lo, hi);"],
  ["a variable named `from` followed by a string is read as an import (targeted D5)", "scripts/lib/shipped-imports.mjs", "matchAll(/\\bfrom\\s*([\"'])(\\s*)\\1/dg)", "matchAll(/\\bfrom[^\"']*([\"'])(\\s*)\\1/dg)"],
  ["binary detection is NUL-only", "scripts/lib/shipped-imports.mjs", "|| (text.length > 0 && (text.match(/[\\x01-\\x08\\x0e-\\x1f]/g) ?? []).length / text.length > 0.02)", ""],
  ["compose without services is accepted", "scripts/lib/shipped-imports.mjs", "out.problems.push(`${name}: a compose file with no \\`services:\\` mapping - NOT scanned`);", "void 0;"],
  ["stage names are case-sensitive", "scripts/lib/shipped-imports.mjs", "name: f?.[2] ? f[2].toLowerCase() : null", "name: f?.[2] ?? null"],
  ["external --from is not reported", "scripts/lib/shipped-imports.mjs", "res.dropped.push(`COPY --from=${op.fromStage} (not an earlier stage of this Dockerfile)`);", "void 0;"],
  ["ADD ignored", "scripts/lib/shipped-imports.mjs", "if (ins === \"COPY\" || ins === \"ADD\") {", "if (ins === \"COPY\") {"],
  ["instructions case-sensitive", "scripts/lib/shipped-imports.mjs", "const ins = m[1].toUpperCase();", "const ins = m[1];"],
  ["backslash continuations not joined", "scripts/lib/shipped-imports.mjs", "const joinContinuations = (text) => text.replace(/\\\\[ \\t]*\\r?\\n/g, \" \");", "const joinContinuations = (text) => text;"],
  ["globs not expanded", "scripts/lib/shipped-imports.mjs", "if (/[*?]/.test(s)) {", "if (false) {"],
  ["dockerfile_inline is silent", "scripts/lib/shipped-imports.mjs", "dropped.push(\"build.dockerfile_inline\");", "void 0;"],
  ["heredoc COPY is silent", "scripts/lib/shipped-imports.mjs", "cur.dropped.push(`${ins} heredoc ${rest}`);", "void 0;"],
  ["WORKDIR with a variable is silent", "scripts/lib/shipped-imports.mjs", "cur.dropped.push(`WORKDIR ${rest}`);", "void 0;"],
  ["a Dockerfile with no FROM is silent", "scripts/lib/shipped-imports.mjs", "if (stages.length === 0) problems.push(", "if (false) problems.push("],
  ["FROM <Base> is case-sensitive", "scripts/lib/shipped-imports.mjs", "s.name === f?.[1]?.toLowerCase()) ?? null;", "s.name === f?.[1]) ?? null;"],
  ["build target is case-sensitive", "scripts/lib/shipped-imports.mjs", "const want = b.target ? b.target.toLowerCase() : null;", "const want = b.target ? b.target : null;"],
  ["COPY --from=<index> is not resolved", "scripts/lib/shipped-imports.mjs", "|| String(x.index) === op.fromStage", ""],
  ["stage cache ignores the build context (D1)", "scripts/lib/shipped-imports.mjs", "const key = `${stage.uid}@${context}`;", "const key = stage.uid;"],
  ["COPY flags beyond --from/--chown/--chmod/--link are applied as if absent (D4)", "scripts/lib/shipped-imports.mjs", "if (unmodelled.length) {", "if (false) {"],
  ["tmpfs hides nothing (D6)", "scripts/lib/shipped-imports.mjs", "else hides.push(cpath(t.split(\":\")[0]));", ""],
  ["tmpfs options are not stripped (Y09)", "scripts/lib/shipped-imports.mjs", "cpath(t.split(\":\")[0])", "cpath(t)"],
  ["only the immediate parent of a destination is a directory (Y13)", "scripts/lib/shipped-imports.mjs", "for (let d = dir; d !== \"/\" && d !== \".\"; d = posix.dirname(d)) res.known.add(d);", "res.known.add(dir);"],
  ["a stage id without its context (Y01)", "scripts/lib/shipped-imports.mjs", "const id = `${df} stage ${other.name ?? other.index}${ctx === \".\" ? \"\" : ` (context ${ctx})`}`;", "const id = `${df} stage ${other.name ?? other.index}`;"],
  ["hidden targets keep their trailing slash (Y19)", "scripts/lib/shipped-imports.mjs", "const cpath = (t) => posix.normalize(t).replace(/\\/$/, \"\") || \"/\";", "const cpath = (t) => posix.normalize(t);"],
  ["conflicting overlay builds are unioned (CX3)", "scripts/lib/shipped-imports.mjs", "if (merged[k] !== undefined && merged[k] !== def.build[k])", "if (false)"],
  ["a trailing slash is kept on a known directory (R6-C)", "scripts/lib/shipped-imports.mjs", "return n.length > 1 ? n.replace(/\\/+$/, \"\") : n;", "return n;"],
  ["an anonymous short volume is ignored (R6-D)", "scripts/lib/shipped-imports.mjs", "if (/^\\/[^:]*$/.test(v)) {", "if (false) {"],
  ["a `..` COPY source is not clamped to the context (CX8)", "scripts/lib/shipped-imports.mjs", "const rel = norm(posix.join(context, clampToContext(s)));", "const rel = norm(posix.join(context, s.replace(/^\\.\\//, \"\")));"],
  ["mounts at one target from two files are both kept (CX9)", "scripts/lib/shipped-imports.mjs", "if (prev && prev.host !== e.host) problems.push(", "if (false) problems.push("],
  ["a bind and a volume at one target do not conflict (CX9)", "scripts/lib/shipped-imports.mjs", "if (prev && prev.file !== h.file) problems.push(", "if (false) problems.push("],
  ["a wildcard COPY --from source matches nothing (CX10)", "scripts/lib/shipped-imports.mjs", "if (/[*?]/.test(abs)) {", "if (false) {"],
  ["a directory source does not create its destination (CX11)", "scripts/lib/shipped-imports.mjs", "for (const f of tree.under(rel)) res.pairs.push({ host: f, container: posix.join(op.dest, posix.relative(rel, f)) });\n        res.known.add(op.dest);", "for (const f of tree.under(rel)) res.pairs.push({ host: f, container: posix.join(op.dest, posix.relative(rel, f)) });"],
  ["ADD of an archive, URL or git source is copied as one file (CX12)", "scripts/lib/shipped-imports.mjs", "if (ins === \"ADD\" && srcs.some((s) => ADD_UNMODELLED.test(s))) {", "if (false) {"],
  ["an escaped specifier is read as if literal (CX13)", "scripts/lib/shipped-imports.mjs", "if (spec.includes(\"\\\\\")) unresolved.push(", "if (false) unresolved.push("],
  ["volumes_from is silent (R7-A)", "scripts/lib/shipped-imports.mjs", "if (def?.volumes_from !== undefined) bad(\"volumes_from is not modelled\");", ""],
  ["a non-literal long-form target is silent (R7-A)", "scripts/lib/shipped-imports.mjs", "bad(`a volume target ${JSON.stringify(target)} is not a literal absolute path`);\n          continue;", "continue;"],
  ["an unparseable short volume entry is silent (R7-A)", "scripts/lib/shipped-imports.mjs", "bad(`volume entry ${JSON.stringify(v)} does not parse (a non-literal target?)`);", "void 0;"],
  ["an overlay's missing context is defaulted (R7-B)", "scripts/lib/shipped-imports.mjs", "{ context: b.context, dockerfile: b.dockerfile, target: b.target }", "{ context: b.context ?? \".\", dockerfile: b.dockerfile, target: b.target }"],
  ["only a dockerfile disagreement is a problem (O06)", "scripts/lib/shipped-imports.mjs", "for (const k of [\"context\", \"dockerfile\", \"target\"]) {", "for (const k of [\"dockerfile\"]) {"],
  ["an anonymous volume with a trailing slash is ignored (O11)", "scripts/lib/shipped-imports.mjs", "if (/^\\/[^:]*$/.test(v)) {", "if (/^\\/[^:]*[^:/]$/.test(v)) {"],
  ["from\"x\" with no space is not read (O17)", "scripts/lib/shipped-imports.mjs", "matchAll(/\\bfrom\\s*([\"'])(\\s*)\\1/dg)", "matchAll(/\\bfrom\\s+([\"'])(\\s*)\\1/dg)"],
  ["a member import() is an unresolved import (INFO)", "scripts/lib/shipped-imports.mjs", "for (const m of marked.matchAll(/(?<![\\w$.])import\\s*\\(/g)) if (!literalAt.has", "for (const m of marked.matchAll(/import\\s*\\(/g)) if (!literalAt.has"],
  ["scan drops the shipped-import problems", "scripts/check-shipped-imports.mjs", "for (const p of ship.problems) problems.push(p);", ""],
  ["compose-file floor dropped", "scripts/check-shipped-imports.mjs", "ship.composeFiles < 3 ||", "false ||"],
  ["fixture-IdP floor dropped", "scripts/check-shipped-imports.mjs", " || ship.fixtureIdp !== true", ""],
  ["not-modelled notes swallowed", "scripts/check-shipped-imports.mjs", "for (const d of ship.dropped ?? []) notes.push(`not modelled: ${d}`);", ""],
  ["Containerfile not discovered", "scripts/check-shipped-imports.mjs", "(?:dockerfile|containerfile)", "(?:dockerfile)"],
  [".yaml compose not discovered", "scripts/check-shipped-imports.mjs", "compose[^/]*)\\.ya?ml$/i;", "compose[^/]*)\\.yml$/i;"],
  ["unreadable deploy file is silent", "scripts/check-shipped-imports.mjs", "problems.push(`${name}: tracked deploy file unreadable (${err && err.code}) - NOT scanned`);", ""],
  ["the fixture-IdP floor is always satisfied", "scripts/check-shipped-imports.mjs", "const fixtureIdp = (r.shipped.get(\"compose service idp\") ?? []).includes(\"scripts/fixture-idp.mjs\");", "const fixtureIdp = true;"],
  ["compose read problems are dropped by the live scan", "scripts/check-shipped-imports.mjs", "problems: [...c.problems, ...d.problems, ...r.problems]", "problems: [...d.problems, ...r.problems]"],
  ["the gate's own guard runs the gate when imported from node -e", "scripts/check-shipped-imports.mjs", "  } catch {\n    return false;\n  }\n})();", "  } catch {\n    return true;\n  }\n})();"],
  ["a signalled child is counted killed", "scripts/check-shipped-imports.mjs", "const signalled = r.signal || r.status === 130 || r.status === 143;", "const signalled = false;"],
  ["a NOT APPLIED mutant does not fail the run", "scripts/check-shipped-imports.mjs", "return killed === results.length && results.every(([, v]) => v === \"killed\") ? 0 : 1;", "return killed === results.filter(([, v]) => v !== \"NOT APPLIED\").length ? 0 : 1;"],
  ["--mutants accepts a dirty tree", "scripts/check-shipped-imports.mjs", "  if (dirty) {\n    console.error(\"✗ --mutants needs a clean working tree", "  if (false) {\n    console.error(\"✗ --mutants needs a clean working tree"],
  ["--mutants accepts a failing baseline", "scripts/check-shipped-imports.mjs", "  if (baseline.status !== 0) {", "  if (false) {"],
];


/**
 * Apply each mutant to the working tree, run the self-test, restore. Refuses a tree with uncommitted changes and a failing
 * unmutated baseline (a "killed" mutant would prove nothing). While it runs THIS FUNCTION OWNS SIGINT/SIGTERM: it restores
 * the mutated file, kills the child's whole process group, removes the parent-owned scratch directory (which is the child's
 * TMPDIR, so nothing the child made survives even a SIGKILL) and exits 130/143. A child that dies of a signal, exits 130/143
 * through its own handler, or times out is INTERRUPTED/TIMEOUT, never "killed". `deps` is injectable for the self-test:
 * `run()` replaces the child, `childArgv` replaces the command, `mutants` the mutation set.
 */
export async function runMutants(deps = {}) {
  const mutants = deps.mutants ?? MUTANTS;
  const gitStatus = deps.gitStatus ?? (() => execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }));
  const root = deps.root ?? repoRoot;
  const childArgv = deps.childArgv ?? [process.execPath, join(root, GATE), "--self-test"];
  let child = null;
  let childTmp = null;
  const dropChildTmp = () => {
    if (childTmp) dropScratch(childTmp);
    childTmp = null;
  };
  const runSelfTest =
    deps.run ??
    (() =>
      new Promise((resolveRun) => {
        let timedOut = false;
        childTmp = scratchDir("entry-guard-run-");
        // detached: the child leads its own process group, so one kill reaches everything it started
        child = spawn(childArgv[0], childArgv.slice(1), { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, TMPDIR: childTmp } });
        const killGroup = (sig) => {
          try {
            process.kill(-child.pid, sig);
          } catch {
            /* already gone */
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          killGroup("SIGKILL");
        }, deps.timeoutMs ?? 300000);
        child.on("close", (status, signal) => {
          clearTimeout(timer);
          killGroup("SIGKILL"); // anything it left behind
          child = null;
          dropChildTmp();
          resolveRun({ status, signal, timedOut });
        });
      }));
  const dirty = gitStatus().trim();
  if (dirty) {
    console.error("✗ --mutants needs a clean working tree (it edits tracked files and restores them); commit or discard first:");
    console.error(dirty.split("\n").slice(0, 10).map((l) => `    ${l}`).join("\n"));
    return 2;
  }
  const baseline = await runSelfTest();
  if (baseline.status !== 0) {
    console.error("✗ the unmutated self-test does not pass, so a 'killed' mutant would prove nothing; fix that first.");
    return 2;
  }
  const results = [];
  let live = null; // { path, original } while a mutant is applied
  const restore = () => {
    if (live) writeFileSync(live.path, live.original);
    live = null;
  };
  let interrupted = 0;
  const onSignal = (code) => () => {
    interrupted = code;
    restore();
    if (child) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    dropChildTmp();
    console.log(`\nINTERRUPTED (${code === 130 ? "SIGINT" : "SIGTERM"}): the tree was restored; ${results.length} of ${mutants.length} mutants had a verdict. Nothing here is a tally.`);
    if (!deps.keepAlive) process.exit(code);
  };
  const sigint = onSignal(130);
  const sigterm = onSignal(143);
  process.on("SIGINT", sigint);
  process.on("SIGTERM", sigterm);
  try {
    for (const [name, file, from, to] of mutants) {
      if (interrupted) break;
      const path = join(root, file);
      const original = readFileSync(path, "utf8");
      // The MUTANTS literal quotes its own targets; only occurrences OUTSIDE it count.
      const lo = original.indexOf("export const MUTANTS = [");
      const hi = lo < 0 ? -1 : original.indexOf("\n];\n", lo) + 4;
      const hits = [];
      for (let at = original.indexOf(from); at >= 0; at = original.indexOf(from, at + 1)) if (lo < 0 || at < lo || at >= hi) hits.push(at);
      if (hits.length !== 1) {
        results.push([name, "NOT APPLIED"]);
        continue;
      }
      try {
        live = { path, original };
        writeFileSync(path, original.slice(0, hits[0]) + to + original.slice(hits[0] + from.length));
        const r = await runSelfTest();
        if (interrupted) break;
        const signalled = r.signal || r.status === 130 || r.status === 143;
        results.push([name, r.timedOut ? "TIMEOUT" : signalled ? "INTERRUPTED" : r.status !== 0 ? "killed" : "SURVIVED"]);
      } finally {
        restore();
      }
    }
  } finally {
    process.off("SIGINT", sigint);
    process.off("SIGTERM", sigterm);
    restore();
    dropChildTmp();
  }
  for (const [name, verdict] of results) console.log(`  ${verdict === "killed" ? "ok" : "!!"} ${verdict.padEnd(11)} ${name}`);
  const killed = results.filter(([, v]) => v === "killed").length;
  if (interrupted) return interrupted;
  console.log(`\nmutants: ${killed} of ${results.length} killed`);
  return killed === results.length && results.every(([, v]) => v === "killed") ? 0 : 1;
}

// This gate's OWN entry guard is written out, not imported.
const IS_ENTRY = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (IS_ENTRY) {
  if (process.argv.includes("--mutants")) {
    // The runner owns SIGINT/SIGTERM while it runs (it restores the tree first).
    process.exitCode = await runMutants();
  } else {
    process.once("SIGINT", () => {
      dropAllScratch();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      dropAllScratch();
      process.exit(143);
    });
    if (process.argv.includes("--self-test")) process.exitCode = await selfTest();
    else process.exitCode = runGate();
  }
}

/** The plain gate run: the model over the tracked compose files and Dockerfiles; returns the exit code (set as process.exitCode so output flushes). */
function runGate() {
  const ship = liveShipped();
  const { problems, notes } = scan({ ship });
  for (const n of notes) console.log(`  · ${n}`);
  console.log(`\nshipped-imports: ${ship.composeFiles} compose file(s), ${ship.dockerFiles} Dockerfile(s), ${ship.containers} container(s), ${ship.shippedScripts} shipped script(s), ${problems.length} problem(s); self-test runs under --self-test`);
  if (problems.length > 0) {
    console.error(`\nShipped-import gate FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  console.log("Shipped-import gate passed — every script a container ships alone has its relative imports shipped beside it.");
  return 0;
}
