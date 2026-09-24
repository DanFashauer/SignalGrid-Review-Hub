#!/usr/bin/env node
// check-workspace-cycles.mjs — no workspace package may depend on itself, however
// many hops it takes.
//
// pnpm links every workspace dependency into the dependant's node_modules
// (lib/a/node_modules/@workspace/b -> ../../../b). A cycle in that graph is
// therefore an infinite directory loop ON DISK: a/node_modules/@workspace/b/
// node_modules/@workspace/a/node_modules/... forever. Nothing in pnpm refuses it.
// What refuses it is whatever walks the tree next: on macOS, Node's recursive
// readdir follows the links until ENAMETOOLONG, and on 2026-09-18 that is how
// #819's Mac preflight read "0 files found under lib/" — the PR had added ONE
// type-only dependency, integrations -> incident-playbook, and incident-playbook
// already reached integrations through posture-composition. Linux did not follow
// the links, so every Linux lane was green and the defect read as a Mac problem.
// Thirty-three gates walk lib/ that way. This gate refuses the cycle at the
// package.json, before it is ever linked.
//
// Pure derivation: read the workspace's own package globs from pnpm-workspace.yaml,
// read every package.json under them, take every dependency field whose value is a
// workspace: protocol (or whose name is a workspace package), and look for a cycle.
// A floor guards the derivation: a workspace that "has no packages" is a parse
// failure, not a clean graph.
//
//   node scripts/check-workspace-cycles.mjs              # the gate
//   node scripts/check-workspace-cycles.mjs --self-test  # the gate can fail
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_FLOOR = 20; // 42 at the time of writing: 35 lib, 6 artifacts, scripts
const EDGE_FLOOR = 10; // a workspace whose packages never depend on each other is misread
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** The `packages:` list of pnpm-workspace.yaml — the only YAML this needs. */
export function workspaceGlobs(yamlText) {
  const lines = yamlText.split("\n");
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start < 0) return [];
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
    if (!m) break;
    globs.push(m[1]);
  }
  return globs;
}

/** Directories the globs name. Only `dir/*` and a plain `dir` are supported — pnpm-workspace.yaml uses nothing else here. */
function packageDirs(globs) {
  const dirs = [];
  for (const g of globs) {
    if (g.endsWith("/*")) {
      const parent = join(repo, g.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const name of readdirSync(parent)) {
        const d = join(parent, name);
        if (statSync(d).isDirectory() && existsSync(join(d, "package.json"))) dirs.push(d);
      }
    } else if (existsSync(join(repo, g, "package.json"))) {
      dirs.push(join(repo, g));
    }
  }
  return dirs;
}

/** name -> { dir, deps: Set<name> } for every workspace package, edges to workspace packages only. */
export function workspaceGraph(manifests) {
  const names = new Set(manifests.map((m) => m.name));
  const graph = new Map();
  for (const m of manifests) {
    const deps = new Set();
    for (const field of DEP_FIELDS) {
      for (const [dep, spec] of Object.entries(m[field] ?? {})) {
        if (String(spec).startsWith("workspace:") || names.has(dep)) deps.add(dep);
      }
    }
    graph.set(m.name, deps);
  }
  return graph;
}

/** Every elementary cycle reachable by DFS, each as the path that closes it. */
export function findCycles(graph) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map([...graph.keys()].map((k) => [k, WHITE]));
  const stack = [];
  const cycles = [];
  const visit = (node) => {
    colour.set(node, GREY);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue; // not a workspace package
      const c = colour.get(dep);
      if (c === GREY) {
        cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
      } else if (c === WHITE) {
        visit(dep);
      }
    }
    stack.pop();
    colour.set(node, BLACK);
  };
  for (const node of graph.keys()) if (colour.get(node) === WHITE) visit(node);
  return cycles;
}

function readManifests() {
  const globs = workspaceGlobs(readFileSync(join(repo, "pnpm-workspace.yaml"), "utf8"));
  return packageDirs(globs).map((dir) => {
    const m = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { ...m, name: m.name ?? dir, dir };
  });
}

function selfTest() {
  const failures = [];
  const note = (ok, msg) => { if (!ok) failures.push(msg); };
  const g = (pairs) => new Map(Object.entries(pairs).map(([k, v]) => [k, new Set(v)]));

  note(findCycles(g({ a: ["b"], b: ["c"], c: [] })).length === 0, "an acyclic chain reported a cycle");
  note(findCycles(g({ a: ["b", "c"], b: ["c"], c: [] })).length === 0, "a diamond reported a cycle");

  // The #819 shape: integrations -> incident-playbook -> posture-composition -> integrations.
  const found = findCycles(g({
    "@workspace/integrations": ["@workspace/audit", "@workspace/incident-playbook"],
    "@workspace/incident-playbook": ["@workspace/posture-composition", "@workspace/event-contract"],
    "@workspace/posture-composition": ["@workspace/facility-trust-graph", "@workspace/integrations", "@workspace/event-contract"],
    "@workspace/audit": [], "@workspace/event-contract": [], "@workspace/facility-trust-graph": [],
  }));
  note(found.length === 1, `the #819 cycle was reported ${found.length} time(s), expected 1`);
  note(
    found[0]?.join(" -> ") === "@workspace/integrations -> @workspace/incident-playbook -> @workspace/posture-composition -> @workspace/integrations",
    `the #819 cycle was named as ${JSON.stringify(found[0])}`,
  );
  note(findCycles(g({ a: ["a"] })).length === 1, "a self-dependency was not reported");
  note(findCycles(g({ a: ["zzz-not-a-workspace-package"] })).length === 0, "an edge to a non-workspace package was followed");

  // The graph must be built from the manifests' workspace: edges, and only those.
  const built = workspaceGraph([
    { name: "@workspace/x", dependencies: { "@workspace/y": "workspace:*", zod: "^3" }, devDependencies: { "@workspace/z": "workspace:*" } },
    { name: "@workspace/y", peerDependencies: { "@workspace/x": "workspace:^" } },
    { name: "@workspace/z" },
  ]);
  note([...built.get("@workspace/x")].sort().join(",") === "@workspace/y,@workspace/z", "workspace edges were not taken from every dependency field, or a registry dep leaked in");
  note(findCycles(built).length === 1, "a peerDependency edge did not close a cycle");

  // The parse: the globs are read from the workspace file, not assumed.
  note(workspaceGlobs("packages:\n  - artifacts/*\n  - lib/*\n  - scripts\n\ncatalog:\n  x: 1\n").join(" ") === "artifacts/* lib/* scripts", "the packages: list was not parsed");
  note(workspaceGlobs("catalog:\n  x: 1\n").length === 0, "a workspace file with no packages: list did not read as empty");

  // The floor: the live derivation must actually see the workspace.
  const live = readManifests();
  const edges = [...workspaceGraph(live).values()].reduce((n, s) => n + s.size, 0);
  note(live.length >= PACKAGE_FLOOR, `only ${live.length} workspace packages read (floor ${PACKAGE_FLOOR}) — the globs or the parse have drifted`);
  note(edges >= EDGE_FLOOR, `only ${edges} workspace edges read (floor ${EDGE_FLOOR}) — the dependency fields are not being read`);

  if (failures.length > 0) {
    console.error("✗ SELF-TEST FAILED — this gate is not checking what it claims to check:\n" + failures.map((f) => `    · ${f}`).join("\n"));
    process.exit(1);
  }
  console.log(`workspace-cycles self-test green — ${live.length} packages, ${edges} workspace edges read live; a planted 3-package cycle, a self-edge and a peer edge are all named`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) {
    selfTest();
  } else {
    const manifests = readManifests();
    const graph = workspaceGraph(manifests);
    const edges = [...graph.values()].reduce((n, s) => n + s.size, 0);
    const problems = [];
    if (manifests.length < PACKAGE_FLOOR) problems.push(`only ${manifests.length} workspace packages read (floor ${PACKAGE_FLOOR}) — the workspace globs or the parse have drifted, so no verdict`);
    if (edges < EDGE_FLOOR) problems.push(`only ${edges} workspace edges read (floor ${EDGE_FLOOR}) — the dependency fields are not being read, so no verdict`);
    const cycles = findCycles(graph);
    for (const c of cycles) problems.push(`dependency cycle: ${c.join(" -> ")} — pnpm links this into node_modules as an infinite symlink loop; break it at the edge that points UP the layering`);
    console.log(`workspace-cycles: ${manifests.length} packages, ${edges} workspace edges, ${cycles.length} cycle(s)`);
    if (problems.length > 0) {
      console.error("✗ " + problems.join("\n✗ "));
      process.exit(1);
    }
    console.log("Workspace cycle gate passed — no workspace package depends on itself through any chain.");
  }
}
