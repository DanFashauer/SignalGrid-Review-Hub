// Shipped-import check — a script that runs ALONE inside a container holds only what was mounted
// or copied beside it, so a relative import of a file nothing ships there is ERR_MODULE_NOT_FOUND
// at start-up. (The fixture IdP did exactly that when it began importing scripts/lib/is-main.mjs;
// its compose overlay bind-mounted the one file.)
//
// WHAT IT MODELS. One CONTAINER per compose service and per Dockerfile stage:
//   - compose: every tracked compose file is read with a real YAML parser; services are merged BY
//     NAME across files (the `-f` overlays), so another service's mount never satisfies this one.
//     Volumes are read in short, long (`type: bind`) and flow syntax; `${PWD}/x` and `./x` sources
//     are repo-relative; a service with `build:` also holds its Dockerfile stage's files.
//   - Dockerfile: instructions case-insensitively, backslash continuations joined, JSON-array and
//     shell COPY/ADD forms, `COPY --from=<stage>` resolved against that stage's own files, WORKDIR
//     (absolute or relative) applied to relative destinations, globs expanded against the tree.
//   - the check is on the HOST FILE: an import is satisfied only when the file shipped at the
//     resolved container path IS the repo file that import means, not merely some file at that path.
//
// WHAT IT DOES NOT MODEL (ceilings, named here, in the gate header and in the backlog row):
//   compose `extends` and `profiles`; services are merged across ALL tracked compose files, not
//   per `-f` combination; `${VAR}` / `$ARG` in a source, destination or WORKDIR (the entry is
//   dropped and the container reports it); a `..` source that leaves the repo; `COPY --from` an
//   external image; bare-specifier imports (they need node_modules, not a sibling file);
//   `require`/`createRequire`/`new URL` references; only scripts/**/*.{mjs,cjs,js} are read for
//   imports; a non-literal `import(\`./${x}\`)` is reported (it cannot be proven shipped), nothing
//   else dynamic is.
import { posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { codeOnly } from "./code-only.mjs";

const SCRIPT_EXT = /\.(?:mjs|cjs|js)$/;
const norm = (p) => posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");

/** A `${PWD}/x`, `./x` or `x` bind source as a repo-relative path; null when it is not one we can place. */
function repoRelative(source) {
  if (typeof source !== "string" || source.includes("$") && !/^\$\{?PWD\}?(\/|$)/.test(source)) return null;
  const s = source.replace(/^\$\{?PWD\}?\/?/, "./");
  if (!/^(\.\.?\/|\.$|\.\.$)/.test(s) && !s.startsWith("scripts/")) return null; // a named volume or an absolute host path
  const n = posix.normalize(s);
  return n.startsWith("..") || n.startsWith("/") ? null : n.replace(/\/$/, "") || ".";
}

/** Pure: compose text -> { services: Map(name -> { entries, build }), problems }. */
export function parseCompose(name, text) {
  const out = { services: new Map(), problems: [] };
  if (text.includes("\0")) {
    out.problems.push(`${name}: binary content - NOT scanned`);
    return out;
  }
  let doc;
  try {
    doc = parseYaml(text);
  } catch (err) {
    out.problems.push(`${name}: not parseable YAML (${String(err.message).split("\n")[0]}) - NOT scanned`);
    return out;
  }
  for (const [svc, def] of Object.entries(doc?.services ?? {})) {
    const entries = [];
    const dropped = [];
    for (const v of def?.volumes ?? []) {
      let source;
      let target;
      if (typeof v === "string") {
        const m = /^(.*?):(\/[^:]*)(?::[a-zA-Z,]+)?$/.exec(v);
        if (!m) continue;
        [, source, target] = m;
      } else if (v && typeof v === "object" && (v.type === "bind" || v.type === undefined)) {
        source = v.source;
        target = v.target;
      } else continue;
      const host = repoRelative(source);
      if (typeof target !== "string" || !target.startsWith("/")) continue;
      if (host === null) {
        if (typeof source === "string" && /^(\.|\$)/.test(source)) dropped.push(`${source}:${target}`);
        continue;
      }
      entries.push({ host, container: posix.normalize(target).replace(/\/$/, "") || "/", from: `${name} service ${svc}` });
    }
    const b = def?.build;
    const build = b === undefined ? null : typeof b === "string" ? { context: b } : { context: b.context ?? ".", dockerfile: b.dockerfile, target: b.target };
    out.services.set(svc, { entries, build, dropped });
  }
  return out;
}

const joinContinuations = (text) => text.replace(/\\[ \t]*\r?\n/g, " ");

/** Pure: Dockerfile text -> stages [{ name, entries, dropped }]. Entries: { host (context-relative), container, fromStage }. */
export function parseDockerfile(name, text) {
  const stages = [];
  let cur = null;
  const lines = joinContinuations(text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z]+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const ins = m[1].toUpperCase();
    const rest = m[2].trim();
    if (ins === "FROM") {
      const f = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(rest);
      cur = { name: f?.[2] ?? null, index: stages.length, entries: [], dropped: [], workdir: "/" };
      stages.push(cur);
    } else if (!cur) {
      continue;
    } else if (ins === "WORKDIR") {
      if (rest.includes("$")) cur.dropped.push(`WORKDIR ${rest}`);
      else cur.workdir = posix.normalize(rest.startsWith("/") ? rest : posix.join(cur.workdir, rest));
    } else if (ins === "COPY" || ins === "ADD") {
      let flags = "";
      let args = rest;
      for (let f; (f = /^(--\S+)\s+/.exec(args)); ) {
        flags += ` ${f[1]}`;
        args = args.slice(f[0].length);
      }
      let parts;
      if (args.startsWith("[")) {
        try {
          parts = JSON.parse(args);
        } catch {
          cur.dropped.push(`${ins} ${rest}`);
          continue;
        }
      } else parts = args.split(/\s+/);
      if (parts.length < 2) continue;
      const dest = parts[parts.length - 1];
      const srcs = parts.slice(0, -1);
      if (dest.includes("$") || srcs.some((s) => s.includes("$"))) {
        cur.dropped.push(`${ins} ${rest}`);
        continue;
      }
      const fromM = /--from=(\S+)/i.exec(flags);
      const absDest = dest.startsWith("/") ? dest : posix.join(cur.workdir, dest);
      cur.entries.push({ srcs, dest: absDest, destIsDir: dest.endsWith("/") || srcs.length > 1, fromStage: fromM ? fromM[1] : null, from: `${name} stage ${cur.name ?? cur.index}` });
    }
  }
  return stages;
}

/** Tree access the model needs (tests pass a fake). */
export function makeTree({ files, read }) {
  const set = new Set(files);
  const dirs = new Set();
  for (const f of files) for (let d = posix.dirname(f); d && d !== "." && d !== "/"; d = posix.dirname(d)) dirs.add(d);
  return {
    read,
    isFile: (p) => set.has(p),
    isDir: (p) => p === "." || dirs.has(p),
    under: (dir) => (dir === "." ? [...set] : files.filter((f) => f.startsWith(`${dir}/`))),
    glob: (pattern) => {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);
      return files.filter((f) => re.test(f));
    },
  };
}

/** Expand one Dockerfile entry (srcs relative to `context`) into concrete { host, container } pairs. */
function expandDockerEntry(e, context, tree, stagesByRef) {
  const pairs = [];
  if (e.fromStage !== null) {
    const src = stagesByRef(e.fromStage);
    if (!src) return { pairs, dropped: [`COPY --from=${e.fromStage} (not a stage of this Dockerfile)`] };
    for (const s of e.srcs) {
      const abs = s.startsWith("/") ? posix.normalize(s) : posix.join(src.workdirEnd, s);
      for (const hit of src.filesAt(abs.replace(/\/$/, ""))) {
        const rel = hit.container === abs.replace(/\/$/, "") ? posix.basename(hit.container) : posix.relative(abs.replace(/\/$/, ""), hit.container);
        const single = e.srcs.length === 1 && !e.destIsDir && hit.container === abs.replace(/\/$/, "");
        pairs.push({ host: hit.host, container: single ? e.dest : posix.join(e.dest, rel) });
      }
    }
    return { pairs, dropped: [] };
  }
  for (const s of e.srcs) {
    const isGlob = /[*?]/.test(s);
    const rel = norm(posix.join(context, s.replace(/^\.\//, "")));
    if (isGlob) {
      for (const f of tree.glob(rel)) pairs.push({ host: f, container: posix.join(e.dest, posix.basename(f)) });
    } else if (tree.isDir(rel)) {
      for (const f of tree.under(rel)) pairs.push({ host: f, container: posix.join(e.dest, posix.relative(rel, f)) });
    } else {
      const single = e.srcs.length === 1 && !e.destIsDir;
      pairs.push({ host: rel, container: single ? e.dest : posix.join(e.dest, posix.basename(rel)) });
    }
  }
  return { pairs, dropped: [] };
}

/** Resolve a stage's entries to concrete file pairs, following COPY --from within the same Dockerfile. */
function resolveStage(stages, stage, context, tree, memo = new Map()) {
  if (memo.has(stage)) return memo.get(stage);
  const res = { pairs: [], dropped: [...stage.dropped], workdirEnd: stage.workdir };
  memo.set(stage, res);
  const byRef = (ref) => {
    const s = stages.find((x) => x.name === ref || String(x.index) === ref);
    if (!s || s === stage) return null;
    const r = resolveStage(stages, s, context, tree, memo);
    return { workdirEnd: r.workdirEnd, filesAt: (abs) => r.pairs.filter((p) => p.container === abs || p.container.startsWith(`${abs}/`)).map((p) => ({ host: p.host, container: p.container })) };
  };
  for (const e of stage.entries) {
    const { pairs, dropped } = expandDockerEntry(e, context, tree, byRef);
    for (const p of pairs) res.pairs.push({ ...p, from: e.from });
    res.dropped.push(...dropped);
  }
  return res;
}

/** Pure: the relative imports of one script, and any import this model cannot resolve. */
export function importsOf(text) {
  const code = codeOnly(text, true);
  const rel = [];
  const unresolved = [];
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]([^"'`$]+)["'`]/g)) if (/^\.{1,2}\//.test(m[1])) rel.push(m[1]);
  for (const m of code.matchAll(/\bimport\s*\(\s*`[^`]*\$\{/g)) unresolved.push(m[0].slice(0, 40));
  return { rel, unresolved };
}

/**
 * Problems, per container, of scripts that ship without a relative import.
 * composes: [{ name, text }]; dockerfiles: [{ name, text }]; tree: makeTree(..).
 * Returns { problems, containers, shippedScripts }.
 */
export function shippedImportProblems({ composes, dockerfiles, tree }) {
  const problems = [];
  const services = new Map(); // name -> { entries, builds[] }
  for (const c of composes) {
    const parsed = parseCompose(c.name, c.text);
    problems.push(...parsed.problems);
    for (const [svc, def] of parsed.services) {
      const cur = services.get(svc) ?? { entries: [], builds: [], dropped: [] };
      cur.entries.push(...def.entries);
      if (def.build) cur.builds.push({ ...def.build, in: c.name });
      cur.dropped.push(...def.dropped);
      services.set(svc, cur);
    }
  }
  const parsedDocker = new Map();
  for (const d of dockerfiles) {
    if (d.text.includes("\0")) {
      problems.push(`${d.name}: binary content - NOT scanned`);
      continue;
    }
    parsedDocker.set(d.name, parseDockerfile(d.name, d.text));
  }
  const claimed = new Set();
  const containers = []; // { id, pairs, dropped }
  for (const [svc, def] of services) {
    const pairs = def.entries.map((e) => ({ host: e.host, container: e.container, dir: tree.isDir(e.host) }));
    const dropped = [...def.dropped];
    const expanded = [];
    for (const p of pairs) {
      if (p.dir) for (const f of tree.under(p.host)) expanded.push({ host: f, container: posix.join(p.container, posix.relative(p.host, f)) });
      else expanded.push({ host: p.host, container: p.container });
    }
    for (const b of def.builds) {
      const df = norm(posix.join(b.context ?? ".", b.dockerfile ?? "Dockerfile"));
      const stages = parsedDocker.get(df);
      if (!stages) continue;
      claimed.add(df);
      const stage = b.target ? stages.find((s) => s.name === b.target) : stages[stages.length - 1];
      if (!stage) continue;
      const r = resolveStage(stages, stage, b.context ?? ".", tree);
      expanded.push(...r.pairs);
      dropped.push(...r.dropped);
    }
    containers.push({ id: `compose service ${svc}`, pairs: expanded, dropped });
  }
  for (const [df, stages] of parsedDocker) {
    if (claimed.has(df)) continue;
    const memo = new Map();
    for (const stage of stages) {
      const r = resolveStage(stages, stage, ".", tree, memo);
      containers.push({ id: `${df} stage ${stage.name ?? stage.index}`, pairs: r.pairs, dropped: r.dropped });
    }
  }
  let shippedScripts = 0;
  for (const c of containers) {
    const byContainer = new Map();
    for (const p of c.pairs) byContainer.set(posix.normalize(p.container), p.host);
    for (const [cpath, host] of byContainer) {
      if (!host.startsWith("scripts/") || !SCRIPT_EXT.test(host)) continue;
      shippedScripts += 1;
      let text;
      try {
        text = tree.read(host);
      } catch (err) {
        problems.push(`${c.id}: ${host} is shipped to ${cpath} but unreadable (${err && err.code}) - its imports were NOT checked`);
        continue;
      }
      const { rel, unresolved } = importsOf(text);
      for (const u of unresolved) problems.push(`${c.id}: ${host} has a non-literal dynamic import (${u}...) that cannot be proven shipped`);
      for (const spec of rel) {
        const wantContainer = posix.normalize(posix.join(posix.dirname(cpath), spec));
        const wantHost = posix.normalize(posix.join(posix.dirname(host), spec));
        const shipped = byContainer.get(wantContainer);
        if (shipped === undefined) problems.push(`${c.id}: ${host} is shipped alone to ${cpath} but imports ${spec}, which resolves to ${wantContainer} and nothing in this container ships there`);
        else if (shipped !== wantHost) problems.push(`${c.id}: ${host} imports ${spec} (${wantHost}) but ${wantContainer} holds ${shipped} instead`);
      }
    }
  }
  return { problems, containers: containers.length, shippedScripts, dropped: containers.flatMap((c) => c.dropped.map((d) => `${c.id}: ${d}`)) };
}
