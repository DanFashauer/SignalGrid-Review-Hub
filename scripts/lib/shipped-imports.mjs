// Shipped-import model — a script that runs ALONE inside a container holds only what was mounted or copied beside it,
// so a relative import of a file nothing ships there is ERR_MODULE_NOT_FOUND at start-up. (The fixture IdP did exactly
// that when it began importing scripts/lib/is-main.mjs; its compose overlay bind-mounted the one file.)
//
// WHAT IT MODELS. One CONTAINER per compose service and per Dockerfile stage:
//   - compose: every tracked compose file is read with a real YAML parser (merge keys `<<` and anchors resolved);
//     services are merged BY NAME across files (the `-f` overlays), so another service's mount never satisfies this
//     one. Mounts are keyed by TARGET: two files that mount different sources at one target are a NOT-scanned
//     problem (the `-f` order is unknown), never both. Volumes are read in short, long (`type: bind`), flow and
//     anonymous (`- /app/lib`) syntax; `${PWD}/x` and `./x` sources are repo-relative. A service with `build:` also
//     holds the files of its Dockerfile's target stage (any Dockerfile name; a missing file, an unknown `target:` or
//     an unparseable Dockerfile is a problem, never a skip), and every OTHER stage of that Dockerfile is a container
//     of its own. Two files that disagree on a build key are a NOT-scanned problem; an overlay that sets no
//     `context` leaves the earlier one alone. Mounts are applied parents first (by target depth, as
//     moby's SortMounts does): a deeper mount - bind, volume or tmpfs - hides whatever the image and any shallower mount
//     hold under its target, and a deeper bind's files replace them.
//   - Dockerfile: instructions case-insensitively, backslash continuations joined, JSON-array and shell COPY/ADD
//     forms, WORKDIR (absolute or relative) applied to relative destinations, `FROM <earlier stage>` inheriting that
//     stage's files, WORKDIR and known directories, `COPY --from=<stage>` resolved against that stage's files
//     (relative sources from the filesystem root, wildcards expanded against that stage's files), sources clamped to
//     the build context (`..` cannot leave it, as BuildKit does), wildcards expanded against the tree (files AND directories; a
//     matched directory copies its contents), a Dockerfile no compose service builds read with its own directory as its
//     context, and a destination
//     that is `.`, ends in `/`, is a WORKDIR, was created by an earlier COPY (a directory source creates its
//     destination whether or not it ends in `/`) or is the target of several sources taking the source's basename.
//   - the check is on the HOST FILE: an import is satisfied only when the file shipped at the resolved container
//     path IS the repo file that import means, not merely some file at that path.
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
/** A build-context-relative source, clamped inside the context (`..` cannot climb out of it). */
const clampToContext = (s) => posix.normalize(`/${s.replace(/^\.\//, "")}`).replace(/^\//, "") || ".";
// A text file that is mostly control characters is not a compose file or a Dockerfile (NUL alone is too narrow).
const looksBinary = (text) => text.includes("\0") || (text.length > 0 && (text.match(/[\x01-\x08\x0e-\x1f]/g) ?? []).length / text.length > 0.02);
const globToRegExp = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);

/** A `${PWD}/x`, `./x` or `x` bind source as a repo-relative path; null when it is not one we can place. */
function repoRelative(source) {
  if (typeof source !== "string" || (source.includes("$") && !/^\$\{?PWD\}?(\/|$)/.test(source))) return null;
  const s = source.replace(/^\$\{?PWD\}?\/?/, "./");
  if (!/^(\.\.?\/|\.$|\.\.$)/.test(s) && !s.startsWith("scripts/")) return null; // a named volume or an absolute host path
  const n = posix.normalize(s);
  return n.startsWith("..") || n.startsWith("/") ? null : n.replace(/\/$/, "") || ".";
}

/** Pure: compose text -> { services: Map(name -> { entries, hides, build, dropped }), problems }. */
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
    const bad = (why) => out.problems.push(`${name} service ${svc}: ${why} - NOT scanned`);
    let seq = 0; // listing order inside this file: mounts of one depth are applied in this order
    if (def?.volumes_from !== undefined) bad("volumes_from is not modelled");
    if (def?.extends !== undefined) bad("extends is not modelled");
    const vols = def?.volumes ?? [];
    if (!Array.isArray(vols)) bad(`volumes is not a list (${typeof vols})`);
    for (const v of Array.isArray(vols) ? vols : []) {
      let source;
      let target;
      let bind = true;
      if (typeof v === "string") {
        if (/^\/[^:]*$/.test(v)) {
          if (v.includes("$")) bad(`a volume target ${JSON.stringify(v)} holds a variable`);
          else hides.push({ path: cpath(v), seq: seq++ }); // an anonymous volume at this path: its content is not the image's
          continue;
        }
        const m = /^(.*?):(\/[^:]*)(?::[a-zA-Z,]+)?$/.exec(v);
        if (!m) {
          bad(`volume entry ${JSON.stringify(v)} does not parse (a non-literal target?)`);
          continue;
        }
        [, source, target] = m;
      } else if (v && typeof v === "object") {
        source = v.source;
        target = v.target;
        bind = v.type === "bind" || v.type === undefined;
        if (typeof target !== "string" || !target.startsWith("/") || target.includes("$")) {
          bad(`a volume target ${JSON.stringify(target)} is not a literal absolute path`);
          continue;
        }
      } else continue;
      if (target.includes("$")) {
        bad(`a volume target ${JSON.stringify(target)} holds a variable`);
        continue;
      }
      const host = bind ? repoRelative(source) : null;
      if (host === null) {
        // Not a repo file or directory: whatever the image holds under the target is covered (a volume's content is not
        // the image's, `nocopy` or not; an absolute host path is unknown). Modelled as hiding, so an import that resolves
        // under it is reported rather than assumed present.
        hides.push({ path: cpath(target), seq: seq++ });
        if (typeof source === "string" && /^(\.|\$)/.test(source)) dropped.push(`${source}:${target}`);
        continue;
      }
      entries.push({ host, container: cpath(target), from: `${name} service ${svc}`, seq: seq++ });
    }
    for (const t of [].concat(def?.tmpfs ?? [])) {
      if (typeof t !== "string" || !t.startsWith("/") || t.includes("$")) bad(`a tmpfs entry ${JSON.stringify(t)} is not a literal absolute path`);
      else hides.push({ path: cpath(t.split(":")[0]), seq: seq++ });
    }
    const b = def?.build;
    if (b && typeof b === "object" && b.dockerfile_inline !== undefined) bad("build.dockerfile_inline is not modelled");
    // No key is defaulted here: an overlay that sets only `target` must not look as if it set `context`.
    const build = b === undefined || b === null ? null : typeof b === "string" ? { context: b } : { context: b.context, dockerfile: b.dockerfile, target: b.target };
    out.services.set(svc, { entries, hides, build, dropped });
  }
  return out;
}

const joinContinuations = (text) => text.replace(/\\[ \t]*\r?\n/g, " ");

// An ADD source that is a URL, a git source or a local archive is fetched or EXTRACTED, not copied as one file.
const ADD_UNMODELLED = /^(?:https?:|ftp:|git@|ssh:|git:)|\.git(?:#|$)|\.(?:tar|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar\.zst|tzst)$/i;

/**
 * Pure: Dockerfile text -> { stages, problems }. A stage: { name (lower-cased), index, uid, base (an earlier stage or null),
 * ops, dropped, problems, workdir (at the end) }. An op is { kind: "workdir", path } or
 * { kind: "copy", srcs, dest (absolute), destSlash, fromStage, from }; directory-ness is decided when the stage is
 * RESOLVED (it needs the tree: a directory source creates its destination).
 */
export function parseDockerfile(name, text) {
  const stages = [];
  const problems = [];
  if (looksBinary(text)) return { stages, problems: [`${name}: binary content - NOT scanned`] };
  let cur = null;
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
      cur = { name: f?.[2] ? f[2].toLowerCase() : null, index: stages.length, uid: `${name}#${stages.length}`, base, ops: [], dropped: [], problems: [], workdir: base ? base.workdir : "/" };
      stages.push(cur);
    } else if (!cur) {
      continue;
    } else if (ins === "WORKDIR") {
      if (rest.includes("$")) cur.dropped.push(`WORKDIR ${rest}`);
      else {
        cur.workdir = clean(rest.startsWith("/") ? rest : posix.join(cur.workdir, rest));
        cur.ops.push({ kind: "workdir", path: cur.workdir });
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
      if (ins === "ADD" && srcs.some((s) => ADD_UNMODELLED.test(s))) {
        cur.problems.push(`${name} stage ${cur.name ?? cur.index}: ADD of a URL, a git source or an archive (${srcs.filter((s) => ADD_UNMODELLED.test(s)).join(" ")}) is fetched or extracted, not copied - NOT scanned`);
        continue;
      }
      const fromM = /--from=(\S+)/i.exec(flags);
      const absDest = clean(dest.startsWith("/") ? dest : posix.join(cur.workdir, dest));
      cur.ops.push({ kind: "copy", srcs, dest: absDest, destSlash: dest.endsWith("/") || dest === "." || dest === "..", fromStage: fromM ? fromM[1].toLowerCase() : null, from: `${name} stage ${cur.name ?? cur.index}` });
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
      const re = globToRegExp(pattern);
      return files.filter((f) => re.test(f));
    },
    // A wildcard matches files AND directories (the Dockerfile reference: "all files and directories ... ending with .png").
    globAll: (pattern) => {
      const re = globToRegExp(pattern);
      return { files: files.filter((f) => re.test(f)), dirs: [...dirs].filter((d) => re.test(d)) };
    },
  };
}

/** Resolve a stage to concrete { host, container } pairs (base stage first), following COPY --from. Also returns the stage's known directories. */
function resolveStage(stages, stage, context, tree, memo) {
  // Keyed by stage AND build context: two services that build the same Dockerfile from different contexts ship different files.
  const key = `${stage.uid}@${context}`;
  if (memo.has(key)) return memo.get(key);
  const res = { pairs: [], dropped: [...stage.dropped], problems: [], known: new Set(["/"]) };
  memo.set(key, res);
  if (stage.base) {
    const b = resolveStage(stages, stage.base, context, tree, memo);
    res.pairs.push(...b.pairs);
    res.dropped.push(...b.dropped);
    res.problems.push(...b.problems);
    for (const k of b.known) res.known.add(k);
  }
  const markDir = (dir) => {
    for (let d = dir; d !== "/" && d !== "."; d = posix.dirname(d)) res.known.add(d);
  };
  for (const op of stage.ops) {
    if (op.kind === "workdir") {
      markDir(op.path);
      continue;
    }
    // Every ancestor of a destination exists as a directory afterwards (COPY creates the path).
    markDir(posix.dirname(op.dest));
    const intoDir = op.destSlash || op.srcs.length > 1 || res.known.has(op.dest);
    if (op.fromStage !== null) {
      const src = stages.find((x) => (x.name !== null && x.name === op.fromStage) || String(x.index) === op.fromStage);
      if (!src || src === stage) {
        res.dropped.push(`COPY --from=${op.fromStage} (not an earlier stage of this Dockerfile)`);
        continue;
      }
      const srcPairs = resolveStage(stages, src, context, tree, memo).pairs;
      const srcKnown = resolveStage(stages, src, context, tree, memo).known;
      const srcDirs = new Set(srcKnown);
      for (const p of srcPairs) for (let d = posix.dirname(p.container); d !== "/" && d !== "."; d = posix.dirname(d)) srcDirs.add(d);
      for (const s of op.srcs) {
        // A --from source is resolved from the FILESYSTEM ROOT of the source stage, never its WORKDIR.
        const abs = posix.normalize(posix.join("/", s)).replace(/\/$/, "") || "/";
        if (/[*?]/.test(abs)) {
          const re = globToRegExp(abs);
          const matchedFiles = srcPairs.filter((p) => re.test(p.container));
          const matchedDirs = [...srcDirs].filter((d) => re.test(d));
          if (matchedFiles.length === 0 && matchedDirs.length === 0) res.dropped.push(`COPY --from=${op.fromStage} ${s} (matches nothing in the modelled stage; a RUN may create it)`);
          for (const hit of matchedFiles) res.pairs.push({ host: hit.host, container: posix.join(op.dest, posix.basename(hit.container)) });
          // A wildcard that matches a directory copies that directory's CONTENTS into the destination.
          for (const d of matchedDirs) for (const hit of srcPairs.filter((p) => p.container.startsWith(`${d}/`))) res.pairs.push({ host: hit.host, container: posix.join(op.dest, posix.relative(d, hit.container)) });
          markDir(op.dest);
          res.known.add(op.dest);
          continue;
        }
        const hits = srcPairs.filter((p) => p.container === abs || p.container.startsWith(`${abs}/`));
        if (hits.length === 0 && !srcKnown.has(abs)) res.dropped.push(`COPY --from=${op.fromStage} ${s} (matches nothing in the modelled stage; a RUN may create it)`);
        const isDirSrc = srcKnown.has(abs) || hits.some((h) => h.container !== abs);
        for (const hit of hits) {
          const single = op.srcs.length === 1 && !intoDir && !isDirSrc && hit.container === abs;
          res.pairs.push({ host: hit.host, container: single ? op.dest : posix.join(op.dest, hit.container === abs ? posix.basename(abs) : posix.relative(abs, hit.container)) });
        }
        if (isDirSrc || intoDir) res.known.add(op.dest);
      }
      continue;
    }
    for (const s of op.srcs) {
      const rel = norm(posix.join(context, clampToContext(s)));
      if (/[*?]/.test(s)) {
        const { files: gf, dirs: gd } = tree.globAll(rel);
        if (gf.length === 0 && gd.length === 0) res.problems.push(`${op.from}: COPY source ${s} matches no tracked path - NOT scanned`);
        for (const f of gf) res.pairs.push({ host: f, container: posix.join(op.dest, posix.basename(f)) });
        // A wildcard that matches a directory copies that directory's CONTENTS into the destination.
        for (const d of gd) for (const f of tree.under(d)) res.pairs.push({ host: f, container: posix.join(op.dest, posix.relative(d, f)) });
        res.known.add(op.dest);
      } else if (tree.isDir(rel)) {
        // A directory source puts its CONTENTS into the destination, which is a directory with or without a trailing slash.
        for (const f of tree.under(rel)) res.pairs.push({ host: f, container: posix.join(op.dest, posix.relative(rel, f)) });
        res.known.add(op.dest);
      } else if (!tree.isFile(rel)) {
        res.problems.push(`${op.from}: COPY source ${s} is not a tracked path - NOT scanned`);
      } else {
        const single = op.srcs.length === 1 && !intoDir;
        res.pairs.push({ host: rel, container: single ? op.dest : posix.join(op.dest, posix.basename(rel)) });
        if (!single) res.known.add(op.dest);
      }
    }
  }
  return res;
}

/**
 * Pure: the relative imports of one script, and any import this model cannot resolve. A specifier is read ONLY from a
 * string in an import position (`from "x"`, `import "x"`, `import("x")`, an uninterpolated template in `import(..)`),
 * located on the string-blanked text and read back from the original at the same offsets, so import-looking text inside
 * some other string is never an import. A specifier written with an escape (`".\x2fhelper.mjs"`) is unresolved.
 */
export function importsOf(text) {
  const marked = codeOnly(text, false);
  const rel = [];
  const unresolved = [];
  const read = (m) => {
    const [lo, hi] = m.indices[2];
    const spec = text.slice(lo, hi);
    if (spec.includes("\\")) unresolved.push(`a specifier written with an escape (${spec.slice(0, 30)})`);
    else if (/^\.{1,2}\//.test(spec)) rel.push(spec);
  };
  for (const m of marked.matchAll(/\bfrom\s*(["'])(\s*)\1/dg)) read(m); // import x from "./y" / export * from "./y"
  for (const m of marked.matchAll(/\bimport\s*(["'])(\s*)\1/dg)) read(m); // import "./y"
  const literalAt = new Set();
  for (const m of marked.matchAll(/(?<![\w$.])import\s*\(\s*(["'`])(\s*)\1\s*[,)]/dg)) {
    literalAt.add(m.index); // import("./y"), or an uninterpolated template: exactly quote, blank body, quote, then , or )
    read(m);
  }
  // EVERY other import( is unresolved: a concatenation ("./lib/" + name), a template with an expression, an identifier.
  // (A member call such as loader.import(x) is not the language's import().)
  for (const m of marked.matchAll(/(?<![\w$.])import\s*\(/g)) if (!literalAt.has(m.index)) unresolved.push(marked.slice(m.index, m.index + 40).replace(/\s+/g, " "));
  return { rel, unresolved };
}

/**
 * Problems, per container, of scripts that ship without a relative import.
 * composes / dockerfiles: [{ name, text }]; tree: makeTree(..).
 * Returns { problems, containers, shippedScripts, shipped: Map(container id -> host files), dropped }.
 */
export function shippedImportProblems({ composes, dockerfiles, tree }) {
  const problems = [];
  const services = new Map(); // name -> { entries, hides, build, dropped }
  for (const [fi, c] of composes.entries()) {
    const parsed = parseCompose(c.name, c.text);
    problems.push(...parsed.problems);
    for (const [svc, def] of parsed.services) {
      const cur = services.get(svc) ?? { entries: [], hides: [], build: null, dropped: [] };
      for (const e of def.entries) cur.entries.push({ ...e, file: c.name, fi });
      for (const h of def.hides) cur.hides.push({ ...h, file: c.name, fi });
      if (def.build) {
        // A later file's `build` REPLACES the earlier one key by key (Compose merge rules); the -f order is not known here, so two
        // overlays that disagree on a key are a problem, never a union of both builds' files. A key an overlay does not set is left alone.
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
  const containers = []; // { id, pairs, dropped }
  for (const [svc, def] of services) {
    const image = [];
    const dropped = [...def.dropped];
    // Mounts are keyed by TARGET (Compose replaces an earlier mount at the same target). Two different sources for one
    // target, or a bind mount and a non-bind mount, cannot be ordered here.
    const byTarget = new Map();
    for (const e of def.entries) {
      const prev = byTarget.get(e.container);
      if (prev && prev.host !== e.host) problems.push(`compose service ${svc}: ${prev.file} and ${e.file} mount different sources (${prev.host}, ${e.host}) at ${e.container}; the -f order is unknown - NOT scanned`);
      else byTarget.set(e.container, e);
    }
    for (const h of def.hides) {
      const prev = byTarget.get(h.path);
      if (prev && prev.file !== h.file) problems.push(`compose service ${svc}: ${prev.file} binds ${prev.host} at ${h.path} but ${h.file} mounts a volume there; the -f order is unknown - NOT scanned`);
    }
    if (def.build) {
      const b = def.build;
      const ctx = b.context ?? ".";
      const df = norm(posix.join(ctx, b.dockerfile ?? "Dockerfile"));
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
      if (stages) {
        claimed.add(df);
        const want = b.target ? b.target.toLowerCase() : null;
        const stage = want ? stages.find((s) => s.name === want) : stages[stages.length - 1];
        if (!stage) problems.push(`compose service ${svc}: build target "${b.target}" is not a stage of ${df} - NOT scanned`);
        else {
          const r = resolveStage(stages, stage, ctx, tree, memo);
          image.push(...r.pairs);
          dropped.push(...r.dropped);
          problems.push(...r.problems);
          for (const other of stages) {
            const id = `${df} stage ${other.name ?? other.index}${ctx === "." ? "" : ` (context ${ctx})`}`;
            if (other === stage || containers.some((c) => c.id === id)) continue;
            const o = resolveStage(stages, other, ctx, tree, memo);
            problems.push(...o.problems);
            containers.push({ id, pairs: o.pairs, dropped: o.dropped });
          }
        }
      }
    }
    // Compose mounts are applied PARENTS FIRST (moby SortMounts: by destination depth); a deeper mount hides whatever the
    // image and every shallower mount hold under its target, and a deeper bind's files replace them.
    const depth = (p) => p.split("/").filter(Boolean).length;
    const layers = [
      ...[...byTarget.values()].map((e) => ({ kind: "bind", target: e.container, host: e.host, fi: e.fi, seq: e.seq })),
      ...def.hides.map((h) => ({ kind: "hide", target: h.path, fi: h.fi, seq: h.seq })),
    ].sort((x, y) => depth(x.target) - depth(y.target) || x.fi - y.fi || x.seq - y.seq);
    let layered = image;
    for (const l of layers) {
      const underTarget = (p) => p.container === l.target || p.container.startsWith(`${l.target}/`);
      if (l.kind === "bind" && !tree.isDir(l.host)) layered = [...layered.filter((p) => p.container !== l.target), { host: l.host, container: l.target }];
      else {
        layered = layered.filter((p) => !underTarget(p));
        if (l.kind === "bind") for (const f of tree.under(l.host)) layered.push({ host: f, container: posix.join(l.target, posix.relative(l.host, f)) });
      }
    }
    containers.push({ id: `compose service ${svc}`, pairs: layered, dropped });
  }
  for (const [df, stages] of parsedDocker) {
    if (claimed.has(df) || !stages) continue;
    // No compose service builds this Dockerfile, so its context is unknown: `docker build <dir>` uses the Dockerfile's own directory.
    const ctx = posix.dirname(df);
    for (const stage of stages) {
      const r = resolveStage(stages, stage, ctx, tree, memo);
      problems.push(...r.problems);
      containers.push({ id: `${df} stage ${stage.name ?? stage.index}${ctx === "." ? "" : ` (context ${ctx})`}`, pairs: r.pairs, dropped: r.dropped });
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
      for (const u of unresolved) problems.push(`${c.id}: ${host} has an import this model cannot resolve (${u}...)`);
      for (const spec of rel) {
        const wantContainer = posix.normalize(posix.join(posix.dirname(cpath), spec));
        const wantHost = posix.normalize(posix.join(posix.dirname(host), spec));
        const got = byContainer.get(wantContainer);
        if (got === undefined) problems.push(`${c.id}: ${host} is shipped alone to ${cpath} but imports ${spec}, which resolves to ${wantContainer} and nothing in this container ships there`);
        else if (got !== wantHost) problems.push(`${c.id}: ${host} imports ${spec} (${wantHost}) but ${wantContainer} holds ${got} instead`);
      }
    }
  }
  return { problems: [...new Set(problems)], containers: containers.length, shippedScripts, shipped, dropped: containers.flatMap((c) => c.dropped.map((d) => `${c.id}: ${d}`)) };
}
