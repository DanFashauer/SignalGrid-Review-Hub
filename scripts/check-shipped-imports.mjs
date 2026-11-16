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
// PR when it produced most of that PR's review findings. A shape the model reads and cannot place is a NOT-scanned problem
// or a reported note; a shape it does not read at all is named in the list below and is a silent pass. Nothing else is.
//
// WHAT IT DOES NOT MODEL (the same list is in the gate header, the library header, the backlog row and the PR body):
// compose `profiles` and `configs:`; compose `secrets:`; the container's `command`, `entrypoint` and node flags (a
// volume over the directory an entry file lives in hides it, and a `--import` loader is not read); services merged
// across ALL tracked compose files rather than per `-f` combination; bind-mount sources read relative to the repo
// root, not to the compose file's own directory; compose files and Dockerfiles found by filename only
// (`compose*.yml`/`.yaml`, `Dockerfile*`, `Containerfile*`), so one named otherwise, or one only a script's `docker
// run -v` or `docker build` line names, is not read; a Dockerfile no compose service builds, read with its own
// directory as the build context; `$VAR`/`$ARG` in a COPY/ADD source, destination or WORKDIR and `..` sources leaving
// the repo (reported as a "not modelled" note); heredoc COPY (a note); COPY --from an external image (a note); COPY
// flags other than --from, --chown, --chmod and --link (NOT scanned); ADD of a URL, a git source or a local archive,
// recognised by extension rather than by content (NOT scanned); `.dockerignore`; files and directories present only
// in a base image (a destination that only the base image holds as a directory is read as a file path); every
// non-bind mount (named volume, absolute host path, tmpfs) treated as hiding everything under its target;
// bare-specifier, absolute and `file:` specifiers, `require`, `createRequire` and `new URL` references; imports read
// only from scripts/**/*.{mjs,cjs,js}; a RUN is not modelled, so a copied script that is never run is still checked.
// NOT-scanned problems, never a pass: compose `extends`, `volumes_from` and `dockerfile_inline`; `volumes:` that is
// not a list; a volume or tmpfs target that is not a literal absolute path or holds a `$`; a short volume entry that
// does not parse; a dynamic import whose argument is not a plain string literal; a specifier written with an escape;
// a local COPY/ADD source that is no tracked path or a wildcard that matches nothing. A COPY --from source that
// matches nothing in the modelled stage is a note, because a RUN may create it. A shape the model does not read at
// all is in this list and is a silent pass.
//
// This gate's entry guard is written out (not imported from a helper): it must run even if a shared helper breaks.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  checks.push(["R5-C heredoc COPY, WORKDIR $VAR and dockerfile_inline are reported as not modelled; a Dockerfile with no FROM is a problem", ship([], ["FROM node\nCOPY <<EOF /x\nhi\nEOF\n"]).dropped.some((x) => x.includes("heredoc")) && ship([], ["FROM node\nWORKDIR $X\n"]).dropped.some((x) => x.includes("WORKDIR $X")) && ship([compose("  idp:\n    build:\n      dockerfile_inline: |\n        FROM node\n")]).problems.some((x) => x.includes("dockerfile_inline") && x.includes("NOT scanned")) && ship([], ["COPY a b\n"]).problems.some((x) => x.includes("no FROM"))]);
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

  // ROUND 2. Each case below pins a shape the round-1 landing refute reproduced as a silent pass, beside its control.
  const Q = { "scripts/q/e.mjs": 'import "./lib/h.mjs";\n', "scripts/q/lib/h.mjs": "export {};\n", "scripts/q/e2.mjs": 'import "./lib/h2.mjs";\n', "scripts/q/lib/h2.mjs": "export {};\n", "scripts/q/other/h.mjs": "export {};\n", "scripts/q/other/h2.mjs": "export {};\n", "scripts/q/Dockerfile": "FROM node\nWORKDIR /app\nCOPY e.mjs ./\nCOPY lib/ ./lib/\n", "scripts/qa/e.mjs": 'import "../qlib/h.mjs";\n', "scripts/qlib/h.mjs": "export {};\n" };
  const qt = (more = {}) => treeOf({ ...Q, ...more });
  const qship = (vols, extra = "") => n(ship([compose(`  idp:\n    volumes:\n${vols.map((v) => `      - ${v}`).join("\n")}\n${extra}`)], [], qt()));
  checks.push(["R1-A a volume, tmpfs or named volume INSIDE a bind-mounted directory hides that directory's files under it (the `.:/app` + `/app/node_modules` pattern); the bare bind is the control", qship(["./scripts/q:/app"]) === 0 && qship(["./scripts/q:/app", "/app/lib"]) >= 1 && qship(["./scripts/q:/app", "libvol:/app/lib"]) >= 1 && qship(["./scripts/q:/app"], "    tmpfs:\n      - /app/lib\n") >= 1]);
  checks.push(["R1-A a second bind nested inside a bind-mounted directory replaces what is under it, in EITHER listing order; the nested bind of the same files is the control", qship(["./scripts/q:/app", "./scripts/q/other:/app/lib"]) >= 1 && qship(["./scripts/q/other:/app/lib", "./scripts/q:/app"]) >= 1 && qship(["./scripts/q:/app", "./scripts/q/lib:/app/lib"]) === 0 && qship(["./scripts/q/lib:/app/lib", "./scripts/q:/app"]) === 0]);
  checks.push(["R1-A mounts are applied parents first (moby SortMounts): a FILE mount under a directory mount wins in either listing order, and across two compose files", qship(["./scripts/q/e.mjs:/app/e.mjs", "./scripts/q/other/h.mjs:/app/lib/h.mjs", "./scripts/q/lib:/app/lib"]) === 1 && qship(["./scripts/q/lib:/app/lib", "./scripts/q/other/h.mjs:/app/lib/h.mjs", "./scripts/q/e.mjs:/app/e.mjs"]) === 1 && qship(["./scripts/q/e.mjs:/app/e.mjs", "./scripts/q/lib/h.mjs:/app/lib/h.mjs", "./scripts/q/lib:/app/lib"]) === 0 && n(ship([compose(svc("idp", ["./scripts/q/e.mjs:/app/e.mjs", "./scripts/q/other/h.mjs:/app/lib/h.mjs"])), compose(svc("idp", ["./scripts/q/lib:/app/lib"]))], [], qt())) === 1]);
  const IMGQ = (cp) => `FROM node\nWORKDIR /app\n${cp}`;
  checks.push(["R1-B a local wildcard that matches a DIRECTORY ships that directory's files (COPY scripts/qa* /app/ is COPY scripts/qa/ /app/); with the helper copied it is clean", n(dock(IMGQ("COPY scripts/qa* /app/\n"), qt())) === 1 && n(dock(IMGQ("COPY scripts/qa/ /app/\n"), qt())) === 1 && n(dock(IMGQ("COPY scripts/qa* /app/\nCOPY scripts/qlib/ /qlib/\n"), qt())) === 0]);
  const FROMQ = (src) => `FROM node AS b\nWORKDIR /out\nCOPY scripts/qa/ ./sub/\nFROM node\nWORKDIR /srv\nCOPY --from=b ${src} /srv/\n`;
  checks.push(["R1-B a COPY --from wildcard that matches a DIRECTORY ships that directory's files (/out/su* is /out/sub/)", n(dock(FROMQ("/out/su*"), qt())) === 2 && n(dock(FROMQ("/out/sub/"), qt())) === 2]);
  const noteOf = (r, what) => r.dropped.filter((x) => x.includes(what)).length;
  checks.push(["R1-B a COPY --from source (wildcard or literal) that matches nothing in the modelled stage is a NOTE, never silent, and a source that does match is not", noteOf(dock("FROM node AS b\nWORKDIR /out\nCOPY scripts/a.mjs ./\nFROM node\nCOPY --from=b /out/*.js /srv/\nCOPY --from=b /out/nothing /srv/\n", qt()), "matches nothing") === 2 && noteOf(dock("FROM node AS b\nWORKDIR /out\nCOPY scripts/a.mjs ./\nFROM node\nCOPY --from=b /out/*.mjs /srv/\nCOPY --from=b /out/a.mjs /srv/\n", qt()), "matches nothing") === 0]);
  checks.push(["R1-B/C a local wildcard that matches nothing, and a local source that is no tracked path, are NOT-scanned problems whatever the prefix (not only scripts/)", dock("FROM node\nCOPY scripts/nothing* /app/\n", qt()).problems.some((x) => x.includes("matches no tracked path")) && dock("FROM node\nCOPY nothere.mjs /app/\n", qt()).problems.some((x) => x.includes("is not a tracked path")) && n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mjs ./\nCOPY scripts/lib/ ./lib/\n", qt())) === 0]);
  const unclaimed = (text) => shippedImportProblems({ composes: [], dockerfiles: [{ name: "scripts/q/Dockerfile", text }], tree: qt() });
  checks.push(["R1-C a Dockerfile no compose service builds is read with its OWN directory as the build context (docker build scripts/q), and its container id says so", n(unclaimed("FROM node\nWORKDIR /app\nCOPY e.mjs ./\n")) === 1 && n(unclaimed("FROM node\nWORKDIR /app\nCOPY e.mjs ./\nCOPY lib/ ./lib/\n")) === 0 && [...unclaimed("FROM node\nWORKDIR /app\nCOPY e.mjs ./\nCOPY lib/ ./lib/\n").shipped.keys()].some((k) => k.includes("(context scripts/q)"))]);
  const dsvc = (extra) => ship([compose(`  idp:\n    build:\n      dockerfile: D0\n${extra}`)], [IMG], qt());
  checks.push(["R1-D a `${VAR}` inside an absolute target is a NOT-scanned problem in tmpfs, long-form tmpfs, a named volume, an absolute host path, a bind and an anonymous volume; the literal tmpfs is the control", ["    tmpfs: [\"/app/${L}\"]\n", "    volumes:\n      - type: tmpfs\n        target: /app/${L}\n", "    volumes:\n      - libvol:/app/${L}\n", "    volumes:\n      - /opt/empty:/app/${L}\n", "    volumes:\n      - ./scripts/q/other:/app/${L}\n", "    volumes: [\"/app/${L}\"]\n"].every((x) => dsvc(x).problems.some((p) => p.includes("NOT scanned"))) && !dsvc("    tmpfs: [/app/lib]\n").problems.some((p) => p.includes("NOT scanned")) && n(dsvc("    tmpfs: [/app/lib]\n")) >= 1]);
  const crashes = (f) => { try { f(); return false; } catch { return true; } };
  checks.push(["R1-F `volumes:` written as a mapping or a number is a named problem, not a TypeError; an empty list and a missing key are the controls", !crashes(() => ship([compose("  idp:\n    volumes:\n      a: b\n")])) && ship([compose("  idp:\n    volumes:\n      a: b\n")]).problems.some((x) => x.includes("volumes is not a list")) && ship([compose("  idp:\n    volumes: 3\n")]).problems.some((x) => x.includes("volumes is not a list")) && n(ship([compose("  idp:\n    volumes: []\n")])) === 0 && n(ship([compose("  idp:\n    image: node\n")])) === 0]);
  checks.push(["R1-E `extends` and `dockerfile_inline` (even beside a tracked Dockerfile in the context) are NOT-scanned problems, not silent passes", ship([compose("  idp:\n    extends:\n      service: other\n    volumes:\n      - ./scripts/q/e.mjs:/app/e.mjs\n")], [], qt()).problems.some((x) => x.includes("extends is not modelled")) && ship([compose("  idp:\n    build:\n      context: ./scripts/q\n      dockerfile_inline: |\n        FROM node\n")], [], qt()).problems.some((x) => x.includes("dockerfile_inline"))]);
  // R1-G: one case per mutant the refute planted that survived.
  checks.push(["R1-G U01 ADD with one URL source among local ones is NOT scanned (some, not every)", dock("FROM node\nWORKDIR /app\nADD scripts/a.mjs https://example.invalid/x.tgz ./\n", qt()).problems.some((x) => x.includes("fetched or extracted"))]);
  checks.push(["R1-G U02 FROM --platform=.. <image> AS <name> still names the stage, so COPY --from=<name> resolves", n(dock("FROM --platform=linux/amd64 node AS b\nWORKDIR /out\nCOPY scripts/a.mjs ./\nFROM node\nWORKDIR /srv\nCOPY --from=b /out/a.mjs ./\n", qt())) === 2]);
  checks.push(["R1-G U03 a shipped .cjs is checked like a .mjs", n(dock("FROM node\nCOPY scripts/c.cjs /app/c.cjs\n", qt({ "scripts/c.cjs": 'import("./missing.cjs");\n' }))) === 1]);
  const floorShip = (over) => ({ problems: [], composeFiles: 5, dockerFiles: 2, containers: 8, shippedScripts: 9, fixtureIdp: true, dropped: [], ...over });
  checks.push(["R1-G U07 the floors are minimums at their edge: 3 containers, 2 compose files, 1 Dockerfile and 2 shipped scripts each fail, the edge itself passes", scan({ ship: floorShip({}) }).problems.length === 0 && scan({ ship: floorShip({ containers: 4, composeFiles: 3, dockerFiles: 2, shippedScripts: 3 }) }).problems.length === 0 && scan({ ship: floorShip({ containers: 3 }) }).problems.length === 1 && scan({ ship: floorShip({ composeFiles: 2 }) }).problems.length === 1 && scan({ ship: floorShip({ dockerFiles: 1 }) }).problems.length === 1 && scan({ ship: floorShip({ shippedScripts: 2 }) }).problems.length === 1]);
  checks.push(["R1-G U08 a directory that is EMPTY in the source stage is still a directory, so a later single-file COPY into it lands inside", n(dock("FROM node AS b\nWORKDIR /out/empty\nFROM node\nWORKDIR /srv\nCOPY --from=b /out/empty /srv/x\nCOPY scripts/a.mjs /srv/x\nCOPY scripts/lib/h.mjs /srv/x/lib/h.mjs\n", qt())) === 0]);
  checks.push(["R1-G U10 `import\"x\"` with no space is an import", importsOf('import"./m.mjs";\n').rel[0] === "./m.mjs"]);
  checks.push(["R1-G U13 import(\"x\", { with: .. }) is read as a literal import", (() => { const r = importsOf('await import("./y.mjs", { with: { type: "json" } });\n'); return r.rel[0] === "./y.mjs" && r.unresolved.length === 0; })()]);
  checks.push(["R1-G U16 a bare $PWD source (no braces) is repo-relative", n(ship([compose(svc("idp", ["$PWD/scripts/a.mjs:/app/a.mjs"]))])) === 1]);
  const GQ = { "scripts/g1.mjs": "export {};\n", "scripts/u.mjs": 'import "./h2.mjs";\n', "scripts/h2.mjs": "export {};\n" };
  checks.push(["R1-G U18 the destination of a local wildcard COPY is a directory, so a later single-file COPY into it lands inside", n(dock("FROM node\nCOPY scripts/g*.mjs /srv/x\nCOPY scripts/u.mjs /srv/x\nCOPY scripts/h2.mjs /srv/x/h2.mjs\n", qt(GQ))) === 0]);
  checks.push(["R1-G U19 ADD of a git@ or ssh: source is NOT scanned", dock("FROM node\nADD git@example.invalid:x/y ./\n", qt()).problems.some((x) => x.includes("fetched or extracted")) && dock("FROM node\nADD ssh://example.invalid/x ./\n", qt()).problems.some((x) => x.includes("fetched or extracted"))]);
  checks.push(["R1-G U20 a Dockerfile with a few percent control characters is binary (the threshold is 2%, not 20%)", dock(`FROM node\n# ${"\u0001".repeat(4)}${"x".repeat(96)}\nCOPY scripts/a.mjs /app/\n`, qt()).problems.some((x) => x.includes("binary content"))]);
  checks.push(["R1-G U23 a tmpfs entry that is not an absolute path is NOT scanned; U12 a scalar tmpfs hides its target", ship([compose("  idp:\n    tmpfs: [app/lib]\n")]).problems.some((x) => x.includes("tmpfs entry")) && (() => { const r = dsvc("    tmpfs: /app/lib\n"); return !r.problems.some((p) => p.includes("NOT scanned")) && n(r) >= 1; })()]);
  checks.push(["R1-G U15 a `?` wildcard matches one character", n(dock("FROM node\nWORKDIR /app\nCOPY scripts/a.mj? ./\nCOPY scripts/lib/ ./lib/\n", qt())) === 0]);
  // The runner itself, run for real over a scratch tree (a regression in THIS copy of runMutants goes uncaught otherwise).
  checks.push(await (async () => {
    const dir = scratchDir("shipped-imports-rr-");
    const mine = scratchDir("shipped-imports-tmp-");
    writeFileSync(join(dir, "sub.txt"), "X\nB\n");
    writeFileSync(join(dir, "amb.txt"), "Q Q\n");
    writeFileSync(join(dir, "child.mjs"), 'import { readFileSync, appendFileSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst d = new URL(".", import.meta.url).pathname;\nconst s = readFileSync(join(d, "sub.txt"), "utf8");\nappendFileSync(join(d, "seen.log"), JSON.stringify(s) + "\\n");\nwriteFileSync(join(process.env.TMPDIR, "marker"), "x");\nprocess.exit(s === "X\\nB\\n" ? 0 : 1);\n');
    const savedTmp = process.env.TMPDIR;
    const savedLog = console.log;
    const savedErr = console.error;
    process.env.TMPDIR = mine;
    console.log = () => {};
    console.error = () => {};
    let code;
    let all;
    try {
      const base = { root: dir, childArgv: [process.execPath, join(dir, "child.mjs")], gitStatus: () => "", keepAlive: true };
      code = await runMutants({ ...base, mutants: [["m1", "sub.txt", "X", "Y"], ["m2", "sub.txt", "B", "C"], ["amb", "amb.txt", "Q", "R"]] });
      const seenFirst = readFileSync(join(dir, "seen.log"), "utf8");
      writeFileSync(join(dir, "seen.log"), "");
      all = await runMutants({ ...base, mutants: [["m1", "sub.txt", "X", "Y"], ["m2", "sub.txt", "B", "C"]] });
      var seen = seenFirst;
    } finally {
      console.log = savedLog;
      console.error = savedErr;
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
    }
    const leaked = readdirSync(mine).length;
    const ok = code === 1 && all === 0 && seen === '"X\\nB\\n"\n"Y\\nB\\n"\n"X\\nC\\n"\n' && readFileSync(join(dir, "sub.txt"), "utf8") === "X\nB\n" && readFileSync(join(dir, "amb.txt"), "utf8") === "Q Q\n" && leaked === 0;
    dropScratch(dir);
    dropScratch(mine);
    return ["R1-G U04/U05/U06 the runner run for real: an ambiguous mutant is NOT APPLIED (not run), each mutant starts from the original file, a fully killed set returns 0, the files are restored and no scratch directory is left", ok];
  })());

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
  ["COPY --from relative source resolved from WORKDIR", "scripts/lib/shipped-imports.mjs", "posix.join(\"/\", s)", "posix.join(src.workdir, s)"],
  ["FROM <stage> does not inherit", "scripts/lib/shipped-imports.mjs", "if (stage.base) {", "if (false) {"],
  ["build Dockerfile only found under Dockerfile* names", "scripts/lib/shipped-imports.mjs", "if (tree.isFile(df)) {", "if (false) {"],
  ["YAML merge keys off", "scripts/lib/shipped-imports.mjs", "{ merge: true }", "{}"],
  ["an existing directory is not a directory destination", "scripts/lib/shipped-imports.mjs", "const intoDir = op.destSlash || op.srcs.length > 1 || res.known.has(op.dest);", "const intoDir = op.destSlash || op.srcs.length > 1;"],
  ["other stages of a compose-built Dockerfile are not containers", "scripts/lib/shipped-imports.mjs", "if (other === stage || containers.some((c) => c.id === id)) continue;", "continue;"],
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
  ["heredoc COPY is silent", "scripts/lib/shipped-imports.mjs", "cur.dropped.push(`${ins} heredoc ${rest}`);", "void 0;"],
  ["WORKDIR with a variable is silent", "scripts/lib/shipped-imports.mjs", "cur.dropped.push(`WORKDIR ${rest}`);", "void 0;"],
  ["a Dockerfile with no FROM is silent", "scripts/lib/shipped-imports.mjs", "if (stages.length === 0) problems.push(", "if (false) problems.push("],
  ["FROM <Base> is case-sensitive", "scripts/lib/shipped-imports.mjs", "s.name === f?.[1]?.toLowerCase()) ?? null;", "s.name === f?.[1]) ?? null;"],
  ["build target is case-sensitive", "scripts/lib/shipped-imports.mjs", "const want = b.target ? b.target.toLowerCase() : null;", "const want = b.target ? b.target : null;"],
  ["COPY --from=<index> is not resolved", "scripts/lib/shipped-imports.mjs", "|| String(x.index) === op.fromStage", ""],
  ["stage cache ignores the build context (D1)", "scripts/lib/shipped-imports.mjs", "const key = `${stage.uid}@${context}`;", "const key = stage.uid;"],
  ["COPY flags beyond --from/--chown/--chmod/--link are applied as if absent (D4)", "scripts/lib/shipped-imports.mjs", "if (unmodelled.length) {", "if (false) {"],
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
  ["unknown build target is silent (dies by its own case, not by a crash)", "scripts/lib/shipped-imports.mjs", "if (!stage) problems.push(`compose service ${svc}: build target \"${b.target}\" is not a stage of ${df} - NOT scanned`);", "if (!stage) void 0;"],
  ["directory mounts are not expanded", "scripts/lib/shipped-imports.mjs", "if (l.kind === \"bind\") for (const f of tree.under(l.host)) layered.push(", "if (false) for (const f of tree.under(l.host)) layered.push("],
  ["a mounted directory hides nothing the image holds", "scripts/lib/shipped-imports.mjs", "layered = layered.filter((p) => !underTarget(p));", "layered = layered.filter((p) => p.container === l.target);"],
  ["volumes and tmpfs hide nothing", "scripts/lib/shipped-imports.mjs", "for (const l of layers) {", "for (const l of layers.filter((x) => x.kind === \"bind\")) {"],
  ["a mount hides only IMAGE files, not what a shallower mount holds (R1-A)", "scripts/lib/shipped-imports.mjs", "const underTarget = (p) => p.container === l.target || p.container.startsWith(`${l.target}/`);", "const underTarget = (p) => image.includes(p) && (p.container === l.target || p.container.startsWith(`${l.target}/`));"],
  ["mounts are applied in listing order, not parents first (R1-A)", "scripts/lib/shipped-imports.mjs", ".sort((x, y) => depth(x.target) - depth(y.target) || x.fi - y.fi || x.seq - y.seq)", ".sort((x, y) => x.fi - y.fi || x.seq - y.seq)"],
  ["a local wildcard drops the directories it matches (R1-B)", "scripts/lib/shipped-imports.mjs", "for (const d of gd) for (const f of tree.under(d))", "for (const d of []) for (const f of tree.under(d))"],
  ["a local wildcard that matches nothing is silent (R1-B)", "scripts/lib/shipped-imports.mjs", "if (gf.length === 0 && gd.length === 0) res.problems.push(", "if (false) res.problems.push("],
  ["a COPY --from wildcard drops the directories it matches (R1-B)", "scripts/lib/shipped-imports.mjs", "for (const d of matchedDirs) for (const hit of", "for (const d of []) for (const hit of"],
  ["a COPY --from wildcard that matches nothing is silent (R1-B)", "scripts/lib/shipped-imports.mjs", "if (matchedFiles.length === 0 && matchedDirs.length === 0) res.dropped.push(", "if (false) res.dropped.push("],
  ["a literal COPY --from source that matches nothing is silent (R1-B)", "scripts/lib/shipped-imports.mjs", "if (hits.length === 0 && !srcKnown.has(abs)) res.dropped.push(", "if (false) res.dropped.push("],
  ["a local COPY source that is no tracked path is silent (R1-C)", "scripts/lib/shipped-imports.mjs", "} else if (!tree.isFile(rel)) {", "} else if (false) {"],
  ["an unclaimed Dockerfile is read with the repo root as its context (R1-C)", "scripts/lib/shipped-imports.mjs", "const ctx = posix.dirname(df);", "const ctx = \".\";"],
  ["a `$` inside a tmpfs target is taken literally (R1-D)", "scripts/lib/shipped-imports.mjs", "!t.startsWith(\"/\") || t.includes(\"$\")) bad(", "!t.startsWith(\"/\")) bad("],
  ["a `$` inside a short volume target is taken literally (R1-D)", "scripts/lib/shipped-imports.mjs", "if (target.includes(\"$\")) {\n        bad(`a volume target ${JSON.stringify(target)} holds a variable`);", "if (false) {\n        bad(`a volume target ${JSON.stringify(target)} holds a variable`);"],
  ["a `$` inside an anonymous volume target is taken literally (R1-D)", "scripts/lib/shipped-imports.mjs", "if (v.includes(\"$\")) bad(", "if (false) bad("],
  ["`volumes:` that is not a list is silent (R1-F)", "scripts/lib/shipped-imports.mjs", "if (!Array.isArray(vols)) bad(", "if (false) bad("],
  ["`extends` is silent (R1-E)", "scripts/lib/shipped-imports.mjs", "if (def?.extends !== undefined) bad(", "if (false) bad("],
  ["dockerfile_inline is silent", "scripts/lib/shipped-imports.mjs", "bad(\"build.dockerfile_inline is not modelled\");", "void 0;"],
  ["tmpfs hides nothing (D6)", "scripts/lib/shipped-imports.mjs", "else hides.push({ path: cpath(t.split(\":\")[0]), seq: seq++ });", "else void 0;"],
  ["an ADD with one URL source among local ones is read as local files (R1-G U01)", "scripts/lib/shipped-imports.mjs", "if (ins === \"ADD\" && srcs.some((s) => ADD_UNMODELLED.test(s))) {", "if (ins === \"ADD\" && srcs.every((s) => ADD_UNMODELLED.test(s))) {"],
  ["FROM flags are not skipped (R1-G U02)", "scripts/lib/shipped-imports.mjs", "/^(?:--\\S+\\s+)*(\\S+)(?:\\s+AS\\s+(\\S+))?/i", "/^(\\S+)(?:\\s+AS\\s+(\\S+))?/i"],
  ["a .cjs script is not checked (R1-G U03)", "scripts/lib/shipped-imports.mjs", "const SCRIPT_EXT = /\\.(?:mjs|cjs|js)$/;", "const SCRIPT_EXT = /\\.(?:mjs|js)$/;"],
  ["the container floor is 2, not 4 (R1-G U07)", "scripts/check-shipped-imports.mjs", "ship.containers < 4", "ship.containers < 2"],
  ["an empty source-stage directory is not a directory (R1-G U08)", "scripts/lib/shipped-imports.mjs", "const isDirSrc = srcKnown.has(abs) || hits.some(", "const isDirSrc = hits.some("],
  ["`import\"x\"` with no space is not read (R1-G U10)", "scripts/lib/shipped-imports.mjs", "/\\bimport\\s*([\"'])(\\s*)\\1/dg", "/\\bimport\\s+([\"'])(\\s*)\\1/dg"],
  ["import(\"x\", { with }) is not read as a literal import (R1-G U13)", "scripts/lib/shipped-imports.mjs", "\\1\\s*[,)]/dg", "\\1\\s*\\)/dg"],
  ["a bare $PWD source is not repo-relative (R1-G U16)", "scripts/lib/shipped-imports.mjs", "/^\\$\\{?PWD\\}?(\\/|$)/", "/^\\$\\{PWD\\}(\\/|$)/"],
  ["the destination of a local wildcard COPY is not a directory (R1-G U18)", "scripts/lib/shipped-imports.mjs", "        res.known.add(op.dest);\n      } else if (tree.isDir(rel)) {", "      } else if (tree.isDir(rel)) {"],
  ["git@ and ssh: ADD sources are read as files (R1-G U19)", "scripts/lib/shipped-imports.mjs", "(?:https?:|ftp:|git@|ssh:|git:)", "(?:https?:|ftp:|git:)"],
  ["the binary threshold is 20%, not 2% (R1-G U20)", "scripts/lib/shipped-imports.mjs", ".length / text.length > 0.02", ".length / text.length > 0.2"],
  ["a tmpfs entry that is not absolute is accepted (R1-G U23)", "scripts/lib/shipped-imports.mjs", "typeof t !== \"string\" || !t.startsWith(\"/\") || t.includes(\"$\")", "typeof t !== \"string\" || t.includes(\"$\")"],
  ["a scalar tmpfs is iterated as a string (R1-G U12)", "scripts/lib/shipped-imports.mjs", "[].concat(def?.tmpfs ?? [])", "(def?.tmpfs ?? [])"],
  ["a `?` wildcard is not one character (R1-G U15)", "scripts/lib/shipped-imports.mjs", ".replace(/\\?/g, \"[^/]\")", ""],
  ["the runner applies a mutant whose target is ambiguous (R1-G U04)", "scripts/check-shipped-imports.mjs", "if (hits.length !== 1) {", "if (hits.length < 1) {"],
  ["the runner does not restore the file between mutants (R1-G U05)", "scripts/check-shipped-imports.mjs", "      } finally {\n        restore();\n      }", "      } finally {\n        live = null;\n      }"],
  ["the runner leaks each child's scratch directory (R1-G U06)", "scripts/check-shipped-imports.mjs", "          child = null;\n          dropChildTmp();\n          resolveRun(", "          child = null;\n          resolveRun("],
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
        childTmp = scratchDir("shipped-imports-run-");
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
