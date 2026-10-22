// Shipped-import check — a script that runs ALONE inside a container holds only what was mounted
// or copied beside it, so a relative import of a file nothing ships there is ERR_MODULE_NOT_FOUND
// at start-up. (The fixture IdP did exactly that when it began importing scripts/lib/is-main.mjs;
// its compose overlay bind-mounted the one file.)
//
// WHAT IT MODELS. One CONTAINER per compose service and per Dockerfile stage:
//   - compose: every tracked compose file is read with a real YAML parser (merge keys `<<` and
//     anchors resolved); services are merged BY NAME across files (the `-f` overlays), so another
//     service's mount never satisfies this one. Volumes are read in short, long (`type: bind`) and
//     flow syntax; `${PWD}/x` and `./x` sources are repo-relative. A service with `build:` also
//     holds the files of its Dockerfile's target stage (any Dockerfile name; a missing file, an
//     unknown `target:` or an unparseable Dockerfile is a problem, never a skip), and every OTHER
//     stage of that Dockerfile is a container of its own. Bind mounts win over image files at the
//     same path, and a mounted directory hides the image files under it.
//   - Dockerfile: instructions case-insensitively, backslash continuations joined, JSON-array and
//     shell COPY/ADD forms, WORKDIR (absolute or relative) applied to relative destinations,
//     `FROM <earlier stage>` inheriting that stage's files and WORKDIR, `COPY --from=<stage>`
//     resolved against that stage's files with relative sources taken from the filesystem root,
//     globs expanded against the tree, and a destination that is `.`, ends in `/`, is a WORKDIR,
//     or is the target of several sources taking the source's basename.
//   - the check is on the HOST FILE: an import is satisfied only when the file shipped at the
//     resolved container path IS the repo file that import means, not merely some file at that path.
//
// WHAT IT DOES NOT MODEL (the same list is in the gate header, the PR body and the backlog row):
// compose `extends`, `profiles`, `configs:` and `dockerfile_inline`; services merged across ALL tracked compose
// files rather than per `-f` combination; bind-mount sources read relative to the repo root, not to the compose
// file's own directory; `$VAR`/`$ARG` in a source, destination or WORKDIR and `..` sources leaving the repo
// (reported as "not modelled"); COPY flags other than --from, --chown, --chmod and --link (`--exclude`,
// `--parents`: reported as NOT scanned); COPY --from an external image (reported as not modelled); `.dockerignore`;
// heredoc COPY (reported as not modelled); files present only in a base image; every non-bind mount (named volume,
// absolute host path, tmpfs) treated as hiding everything the image holds under its target; bare-specifier,
// `require`, `createRequire` and `new URL` references; imports read only from scripts/**/*.{mjs,cjs,js}; a RUN is
// not modelled, so a copied script that is never run is still checked; the container's command and entrypoint (a
// volume over the directory an entry file lives in hides it, unreported). A dynamic import whose argument is not a
// plain string literal is reported.
import { posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { codeOnly } from "./code-only.mjs";

const SCRIPT_EXT = /\.(?:mjs|cjs|js)$/;
const norm = (p) => posix.normalize(p).replace(/^\.\//, "").replace(/\/$/, "");
/** An absolute container path with no trailing slash (the root stays "/"). */
const clean = (p) => {
  const n = posix.normalize(p);
  return n.length > 1 ? n.replace(/\/+$/, "") : n;
};
// A text file that is mostly control characters is not a compose file or a Dockerfile (NUL alone is too narrow).
const looksBinary = (text) => text.includes("\0") || (text.length > 0 && (text.match(/[\x01-\x08\x0e-\x1f]/g) ?? []).length / text.length > 0.02);

/** A `${PWD}/x`, `./x` or `x` bind source as a repo-relative path; null when it is not one we can place. */
function repoRelative(source) {
  if (typeof source !== "string" || (source.includes("$") && !/^\$\{?PWD\}?(\/|$)/.test(source))) return null;
  const s = source.replace(/^\$\{?PWD\}?\/?/, "./");
  if (!/^(\.\.?\/|\.$|\.\.$)/.test(s) && !s.startsWith("scripts/")) return null; // a named volume or an absolute host path
  const n = posix.normalize(s);
  return n.startsWith("..") || n.startsWith("/") ? null : n.replace(/\/$/, "") || ".";
}

/** Pure: compose text -> { services: Map(name -> { entries, build, dropped }), problems }. */
export function parseCompose(name, text) {
  const out = { services: new Map(), problems: [] };
  if (looksBinary(text)) {
    out.problems.push(`${name}: binary content - NOT scanned`);
    return out;
  }
  let doc;
  try {
    doc = parseYaml(text, { merge: true });
  } catch (err) {
    out.problems.push(`${name}: not parseable YAML (${String(err.message).split("\n")[0]}) - NOT scanned`);
    return out;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || !doc.services || typeof doc.services !== "object" || Array.isArray(doc.services)) {
    out.problems.push(`${name}: a compose file with no \`services:\` mapping - NOT scanned`);
    return out;
  }
  for (const [svc, def] of Object.entries(doc.services)) {
    const entries = [];
    const hides = []; // container paths a non-repo mount covers: a named volume, an absolute host path, tmpfs, a ${VAR} source
    const dropped = [];
    const cpath = (t) => posix.normalize(t).replace(/\/$/, "") || "/";
    for (const v of def?.volumes ?? []) {
      let source;
      let target;
      let bind = true;
      if (typeof v === "string") {
        if (/^\/[^:]*$/.test(v)) {
          hides.push(cpath(v)); // an anonymous volume at this path: its content is not the image's
          continue;
        }
        const m = /^(.*?):(\/[^:]*)(?::[a-zA-Z,]+)?$/.exec(v);
        if (!m) continue;
        [, source, target] = m;
      } else if (v && typeof v === "object") {
        source = v.source;
        target = v.target;
        bind = v.type === "bind" || v.type === undefined;
      } else continue;
      if (typeof target !== "string" || !target.startsWith("/")) continue;
      const host = bind ? repoRelative(source) : null;
      if (host === null) {
        // Not a repo file or directory: whatever the image holds under the target is covered (a volume's content is not
        // the image's, `nocopy` or not; an absolute host path is unknown). Modelled as hiding, so an import that resolves
        // under it is reported rather than assumed present.
        hides.push(cpath(target));
        if (typeof source === "string" && /^(\.|\$)/.test(source)) dropped.push(`${source}:${target}`);
        continue;
      }
      entries.push({ host, container: cpath(target), from: `${name} service ${svc}` });
    }
    for (const t of [].concat(def?.tmpfs ?? [])) if (typeof t === "string" && t.startsWith("/")) hides.push(cpath(t.split(":")[0]));
    const b = def?.build;
    if (b && typeof b === "object" && b.dockerfile_inline !== undefined) dropped.push("build.dockerfile_inline");
    const build = b === undefined || b === null ? null : typeof b === "string" ? { context: b } : { context: b.context ?? ".", dockerfile: b.dockerfile, target: b.target };
    out.services.set(svc, { entries, hides, build, dropped });
  }
  return out;
}

const joinContinuations = (text) => text.replace(/\\[ \t]*\r?\n/g, " ");

/**
 * Pure: Dockerfile text -> { stages, problems }. A stage: { name (lower-cased), index, base (an earlier stage or null),
 * entries, dropped, workdir (at the end) }. An entry: { srcs, dest (absolute), destIsDir, fromStage, from }.
 */
export function parseDockerfile(name, text) {
  const stages = [];
  const problems = [];
  if (looksBinary(text)) return { stages, problems: [`${name}: binary content - NOT scanned`] };
  let cur = null;
  let knownDirs = null;
  for (const raw of joinContinuations(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z]+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const ins = m[1].toUpperCase();
    const rest = m[2].trim();
    if (ins === "FROM") {
      const f = /^(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i.exec(rest);
      const base = stages.find((s) => s.name !== null && s.name === f?.[1]?.toLowerCase()) ?? null;
      cur = { name: f?.[2] ? f[2].toLowerCase() : null, index: stages.length, uid: `${name}#${stages.length}`, base, entries: [], dropped: [], problems: [], workdir: base ? base.workdir : "/" };
      knownDirs = new Set(["/", ...(base ? base.knownDirs : [])]);
      cur.knownDirs = knownDirs;
      stages.push(cur);
    } else if (!cur) {
      continue;
    } else if (ins === "WORKDIR") {
      if (rest.includes("$")) cur.dropped.push(`WORKDIR ${rest}`);
      else {
        cur.workdir = clean(rest.startsWith("/") ? rest : posix.join(cur.workdir, rest));
        knownDirs.add(cur.workdir);
      }
    } else if (ins === "COPY" || ins === "ADD") {
      let flags = "";
      let args = rest;
      const unmodelled = [];
      for (let f; (f = /^(--\S+)\s+/.exec(args)); ) {
        flags += ` ${f[1]}`;
        if (!/^--(?:from|chown|chmod|link)(?:=|$)/i.test(f[1])) unmodelled.push(f[1]);
        args = args.slice(f[0].length);
      }
      if (unmodelled.length) {
        // --exclude and --parents change WHICH files land WHERE; applying them is a model of its own, so the instruction fails closed.
        cur.problems.push(`${name} stage ${cur.name ?? cur.index}: ${ins} flag ${unmodelled.join(" ")} is not modelled - NOT scanned`);
        continue;
      }
      let parts;
      if (args.startsWith("[")) {
        try {
          parts = JSON.parse(args);
        } catch {
          cur.dropped.push(`${ins} ${rest}`);
          continue;
        }
      } else if (/^<</.test(args)) {
        cur.dropped.push(`${ins} heredoc ${rest}`);
        continue;
      } else parts = args.split(/\s+/);
      if (parts.length < 2) continue;
      const dest = parts[parts.length - 1];
      const srcs = parts.slice(0, -1);
      if (dest.includes("$") || srcs.some((s) => s.includes("$"))) {
        cur.dropped.push(`${ins} ${rest}`);
        continue;
      }
      const fromM = /--from=(\S+)/i.exec(flags);
      const absDest = clean(dest.startsWith("/") ? dest : posix.join(cur.workdir, dest));
      const destIsDir = dest.endsWith("/") || dest === ".." || srcs.length > 1 || knownDirs.has(absDest);
      // Every ancestor of a destination exists as a directory afterwards (COPY creates the path).
      for (let d = posix.dirname(absDest); d !== "/" && d !== "."; d = posix.dirname(d)) knownDirs.add(d);
      cur.entries.push({ srcs, dest: absDest, destIsDir, fromStage: fromM ? fromM[1].toLowerCase() : null, from: `${name} stage ${cur.name ?? cur.index}` });
      if (destIsDir) knownDirs.add(absDest);
    }
  }
  if (stages.length === 0) problems.push(`${name}: no FROM instruction - NOT scanned`);
  return { stages, problems };
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

/** Resolve a stage to concrete { host, container } pairs (base stage first), following COPY --from. */
function resolveStage(stages, stage, context, tree, memo) {
  // Keyed by stage AND build context: two services that build the same Dockerfile from different contexts ship different files.
  const key = `${stage.uid}@${context}`;
  if (memo.has(key)) return memo.get(key);
  const res = { pairs: [], dropped: [...stage.dropped] };
  memo.set(key, res);
  if (stage.base) {
    const b = resolveStage(stages, stage.base, context, tree, memo);
    res.pairs.push(...b.pairs);
    res.dropped.push(...b.dropped);
  }
  for (const e of stage.entries) {
    if (e.fromStage !== null) {
      const src = stages.find((x) => (x.name !== null && x.name === e.fromStage) || String(x.index) === e.fromStage);
      if (!src || src === stage) {
        res.dropped.push(`COPY --from=${e.fromStage} (not an earlier stage of this Dockerfile)`);
        continue;
      }
      const srcPairs = resolveStage(stages, src, context, tree, memo).pairs;
      for (const s of e.srcs) {
        // A --from source is resolved from the FILESYSTEM ROOT of the source stage, never its WORKDIR.
        const abs = posix.normalize(posix.join("/", s)).replace(/\/$/, "") || "/";
        for (const hit of srcPairs.filter((p) => p.container === abs || p.container.startsWith(`${abs}/`))) {
          const single = e.srcs.length === 1 && !e.destIsDir && hit.container === abs;
          res.pairs.push({ host: hit.host, container: single ? e.dest : posix.join(e.dest, hit.container === abs ? posix.basename(abs) : posix.relative(abs, hit.container)) });
        }
      }
      continue;
    }
    for (const s of e.srcs) {
      const rel = norm(posix.join(context, s.replace(/^\.\//, "")));
      if (/[*?]/.test(s)) {
        for (const f of tree.glob(rel)) res.pairs.push({ host: f, container: posix.join(e.dest, posix.basename(f)) });
      } else if (tree.isDir(rel)) {
        for (const f of tree.under(rel)) res.pairs.push({ host: f, container: posix.join(e.dest, posix.relative(rel, f)) });
      } else {
        const single = e.srcs.length === 1 && !e.destIsDir;
        res.pairs.push({ host: rel, container: single ? e.dest : posix.join(e.dest, posix.basename(rel)) });
      }
    }
  }
  return res;
}

/**
 * Pure: the relative imports of one script, and any import this model cannot resolve. A specifier is read ONLY from a
 * string in an import position (`from "x"`, `import "x"`, `import("x")`, an uninterpolated template in `import(..)`),
 * located on the string-blanked text and read back from the original at the same offsets, so import-looking text inside
 * some other string is never an import.
 */
export function importsOf(text) {
  const marked = codeOnly(text, false);
  const rel = [];
  const unresolved = [];
  const take = (re) => {
    for (const m of marked.matchAll(re)) {
      const [lo, hi] = m.indices[2];
      const spec = text.slice(lo, hi);
      if (/^\.{1,2}\//.test(spec)) rel.push(spec);
    }
  };
  take(/\bfrom\s*(["'])(\s*)\1/dg); // import x from "./y" / export * from "./y"
  take(/\bimport\s*(["'])(\s*)\1/dg); // import "./y"
  const literalAt = new Set();
  for (const m of marked.matchAll(/\bimport\s*\(\s*(["'`])(\s*)\1\s*[,)]/dg)) {
    literalAt.add(m.index); // import("./y"), or an uninterpolated template: exactly quote, blank body, quote, then , or )
    const spec = text.slice(m.indices[2][0], m.indices[2][1]);
    if (/^\.{1,2}\//.test(spec)) rel.push(spec);
  }
  // EVERY other import( is unresolved: a concatenation ("./lib/" + name), a template with an expression, an identifier.
  for (const m of marked.matchAll(/\bimport\s*\(/g)) if (!literalAt.has(m.index)) unresolved.push(marked.slice(m.index, m.index + 40).replace(/\s+/g, " "));
  return { rel, unresolved };
}

/**
 * Problems, per container, of scripts that ship without a relative import.
 * composes / dockerfiles: [{ name, text }]; tree: makeTree(..).
 * Returns { problems, containers, shippedScripts, shipped: Map(container id -> host files), dropped }.
 */
export function shippedImportProblems({ composes, dockerfiles, tree }) {
  const problems = [];
  const services = new Map(); // name -> { entries, builds[], dropped }
  for (const c of composes) {
    const parsed = parseCompose(c.name, c.text);
    problems.push(...parsed.problems);
    for (const [svc, def] of parsed.services) {
      const cur = services.get(svc) ?? { entries: [], hides: [], build: null, dropped: [] };
      cur.entries.push(...def.entries);
      cur.hides.push(...def.hides);
      if (def.build) {
        // A later file's `build` REPLACES the earlier one key by key (Compose merge rules); the -f order is not known here, so two
        // overlays that disagree on a key are a problem, never a union of both builds' files.
        const merged = { ...(cur.build ?? {}) };
        for (const k of ["context", "dockerfile", "target"]) {
          if (def.build[k] === undefined) continue;
          if (merged[k] !== undefined && merged[k] !== def.build[k]) problems.push(`compose service ${svc}: ${c.name} sets build.${k} to ${def.build[k]} but an earlier file set ${merged[k]}; the -f order is unknown - NOT scanned`);
          else merged[k] = def.build[k];
        }
        cur.build = merged;
      }
      cur.dropped.push(...def.dropped);
      services.set(svc, cur);
    }
  }
  const parsedDocker = new Map(); // tracked path -> stages, or null when it could not be read
  const loadDocker = (name, text) => {
    const r = parseDockerfile(name, text);
    problems.push(...r.problems, ...r.stages.flatMap((st) => st.problems));
    parsedDocker.set(name, r.problems.length ? null : r.stages);
  };
  for (const d of dockerfiles) loadDocker(d.name, d.text);
  const memo = new Map();
  const claimed = new Set();
  const containers = []; // { id, pairs, mounts, dropped }
  for (const [svc, def] of services) {
    const image = [];
    const dropped = [...def.dropped];
    for (const b of def.build ? [def.build] : []) {
      const df = norm(posix.join(b.context ?? ".", b.dockerfile ?? "Dockerfile"));
      if (!parsedDocker.has(df)) {
        let text = null;
        if (tree.isFile(df)) {
          try {
            text = tree.read(df);
          } catch (err) {
            problems.push(`compose service ${svc}: build Dockerfile ${df} unreadable (${err && err.code}) - NOT scanned`);
          }
        } else problems.push(`compose service ${svc}: build Dockerfile ${df} is not a tracked file - NOT scanned`);
        if (text !== null) loadDocker(df, text);
        else parsedDocker.set(df, null);
      }
      const stages = parsedDocker.get(df);
      if (!stages) continue;
      claimed.add(df);
      const want = b.target ? b.target.toLowerCase() : null;
      const stage = want ? stages.find((s) => s.name === want) : stages[stages.length - 1];
      if (!stage) {
        problems.push(`compose service ${svc}: build target "${b.target}" is not a stage of ${df} - NOT scanned`);
        continue;
      }
      const r = resolveStage(stages, stage, b.context ?? ".", tree, memo);
      image.push(...r.pairs);
      dropped.push(...r.dropped);
      const ctx = b.context ?? ".";
      for (const other of stages) {
        const id = `${df} stage ${other.name ?? other.index}${ctx === "." ? "" : ` (context ${ctx})`}`;
        if (other === stage || containers.some((c) => c.id === id)) continue;
        const o = resolveStage(stages, other, ctx, tree, memo);
        containers.push({ id, pairs: o.pairs, mounts: [], dropped: o.dropped });
      }
    }
    const mounts = [];
    for (const e of def.entries) {
      if (tree.isDir(e.host)) for (const f of tree.under(e.host)) mounts.push({ host: f, container: posix.join(e.container, posix.relative(e.host, f)) });
      else mounts.push({ host: e.host, container: e.container });
    }
    // A bind mount wins over an image file at the same path, and a mounted directory hides what the image holds under it.
    const mountedDirs = def.entries.filter((e) => tree.isDir(e.host)).map((e) => e.container);
    const covered = [...mountedDirs, ...def.hides];
    const kept = image.filter((p) => !covered.some((d) => p.container === d || p.container.startsWith(`${d}/`)));
    containers.push({ id: `compose service ${svc}`, pairs: [...kept, ...mounts], dropped });
  }
  for (const [df, stages] of parsedDocker) {
    if (claimed.has(df) || !stages) continue;
    for (const stage of stages) {
      const r = resolveStage(stages, stage, ".", tree, memo);
      containers.push({ id: `${df} stage ${stage.name ?? stage.index}`, pairs: r.pairs, mounts: [], dropped: r.dropped });
    }
  }
  let shippedScripts = 0;
  const shipped = new Map();
  for (const c of containers) {
    const byContainer = new Map();
    for (const p of c.pairs) byContainer.set(posix.normalize(p.container), p.host); // later entries win, as Docker's layers do
    shipped.set(c.id, [...byContainer.values()]);
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
      for (const u of unresolved) problems.push(`${c.id}: ${host} has a dynamic import with a non-literal argument (${u}...) that cannot be proven shipped`);
      for (const spec of rel) {
        const wantContainer = posix.normalize(posix.join(posix.dirname(cpath), spec));
        const wantHost = posix.normalize(posix.join(posix.dirname(host), spec));
        const got = byContainer.get(wantContainer);
        if (got === undefined) problems.push(`${c.id}: ${host} is shipped alone to ${cpath} but imports ${spec}, which resolves to ${wantContainer} and nothing in this container ships there`);
        else if (got !== wantHost) problems.push(`${c.id}: ${host} imports ${spec} (${wantHost}) but ${wantContainer} holds ${got} instead`);
      }
    }
  }
  return { problems, containers: containers.length, shippedScripts, shipped, dropped: containers.flatMap((c) => c.dropped.map((d) => `${c.id}: ${d}`)) };
}
