// A Node preload (`node --import <this file> …`, or `--import=<this file>` in NODE_OPTIONS as the gate does) for children the sharding gate spawns: the child may
// READ the repository and print, and nothing else. Any attempt to write, rename, remove, create or
// re-permission something under the repository, to start another process or thread, or to reach the
// runtime's own bindings, throws, after one marker line on stderr that the gate also fails on, so a
// throw swallowed by a try/catch is still seen.
//
// WHY. check-mutation-sharding.mjs runs the real mutation guard in `--plan` mode, a mode that is
// promised to stop before the first mutation is written. That promise was kept only by text pins on
// main(): a plan-mode `writeFileSync` that got past them turned the gate red and left every registered
// guard file, 185 of them, mutated on disk (they are deliberately broken security guards). This makes
// the promise a property of the process instead of a property of the source text.
//
// WHAT IT REACHES, and why each is on the list. The file-system functions that change content (write,
// append, truncate, open for writing, copy, link, rename, remove, create) AND the ones that change
// only metadata (chmod, chown, utimes and their l/f/promises/callback forms): a metadata write is still
// a write to a guard file, and `git status` sees a mode change. A descriptor cannot be placed, so the
// f* forms are refused outright and a read-only `fs.promises` handle on a repository path loses its
// mutating methods. A hard link is refused when its SOURCE is in the repository, because a second name
// outside it writes through to the same file. The routes that go around those functions: a worker
// thread (a new isolate that starts with none of these patches), `process.binding` and
// `process._linkedBinding` (the runtime's own `fs` and `spawn_sync`), `process.execve` and
// `process.dlopen` (another program or a native addon in this process), `child_process.ChildProcess`
// (constructable on its own), `module.register` (the loader-hooks thread is a worker that never loaded this
// file), a unix socket bound inside the repository, `process.report.writeReport` and every `process.report` setting (the runtime writes
// `report.*.json` into the working directory on a signal or an uncaught exception once `reportOnSignal` or `reportOnUncaughtException`
// is set), `v8.writeHeapSnapshot` and
// the v8 and trace_events switches that make the runtime write a file on its own, and `wasi.WASI` (a
// WebAssembly module with the repository pre-opened) and `sqlite.DatabaseSync` (opening a database creates its file). Paths are read in every spelling the fs functions
// accept: a string, any Uint8Array, a URL, and a plain object shaped like one, resolved through symlinks that point at something that does
// not exist yet (a dangling link outside the repository whose target is a new file inside it is a write to the repository). That is a list of the routes
// known, and the tree check in check-mutation-sharding.mjs (`git status` before the first child and
// after the last) is the net under whatever it does not name.
//
// Scope: paths under the repository root (this file's grandparent). Everything outside it, such as the
// system temp directory, is untouched. `NOWRITE_ALLOW` (colon-separated absolute paths) lists scratch
// locations inside the repository that stay writable; the gate sets none. It is read once and then
// removed from the environment, so the program under test sees the environment CI gives it and cannot
// tell, from this variable, that a gate is watching.
import fs from "node:fs";
import cp from "node:child_process";
import net from "node:net";
import traceEvents from "node:trace_events";
import v8 from "node:v8";
import wt from "node:worker_threads";
import Module, { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DENIED_MARKER = "NO-WRITE-DENIED";
// Where a path really lands, whether or not it exists yet. An existing path is `realpath`. One that does not exist is walked a component at a time
// from the root: a component that is a SYMLINK is followed (a link to something that is missing too, a link to a link, to a depth of MAX_LINK_HOPS),
// one that is absent is kept as written, and `..` is taken from the real directory reached so far. So `/tmp/link -> <repo>/new-file` lands in the
// repository, and so do `/tmp/dir-link/new-file` and `/tmp/dir-link/../new-file`. Two shortcuts used to let a write through: resolving only the missing
// path's DIRECTORY (a dangling link outside the repository whose target is a new file inside it was a way to create that file), and normalising `..`
// as text before looking (`/tmp/link-to-a-repository-directory/../file` named `/tmp/file`, outside, for a file the system opens inside the repository).
// A walk that runs past the hop limit (a loop of links) is reported as `unplaceable`, the second argument, which every caller passes: the repository
// root for a path being judged (the write would fail with ELOOP anyway, and a path that cannot be placed is treated as inside), and the text of the
// root itself when the root is what is being placed. It is a parameter and not a read of `ROOT` because `ROOT` is computed by this very function at
// module load: a read of it inside the walk would be a read in its own temporal dead zone (check-module-init-order.mjs fails on exactly that).
// A looped `NOWRITE_ALLOW` entry allows nothing: its fallback is a sentinel holding a NUL, which no real path can match (the repository root there would
// have allowed the whole repository).
// `realpath.native` is realpath(3): the JS `realpathSync` normalises `..` as text before it looks, which is the shortcut above. Both are taken now, so
// the program under test replacing them on `fs` later does not change where a path is judged to land.
const MAX_LINK_HOPS = 40;
const realpath = fs.realpathSync.native;
const readlink = fs.readlinkSync;
const partsOf = (s) => s.split(sep).filter((part) => part !== "");
const realish = (p, unplaceable) => {
  try { return realpath(p); } catch { /* absent, or a link to something absent: walk it */ }
  let rest = partsOf(p.startsWith(sep) ? p : `${process.cwd()}${sep}${p}`);
  let at = sep;
  let hops = 0;
  while (rest.length > 0) {
    const name = rest[0];
    rest = rest.slice(1);
    if (name === ".") continue;
    if (name === "..") { at = dirname(at); continue; } // `at` holds no link, so its parent is the directory the system would reach
    const next = join(at, name);
    let link;
    try { link = readlink(next); } catch { at = next; continue; } // not a link (a file, a directory, or absent): keep it
    hops += 1;
    if (hops > MAX_LINK_HOPS) return unplaceable;
    if (link.startsWith(sep)) at = sep;
    rest = [...partsOf(link), ...rest];
  }
  try { return realpath(at); } catch { return at; }
};
const rootText = resolve(dirname(fileURLToPath(import.meta.url)), "../.."); // a loop of links on the repository's own path keeps this text, which is still inside
const ROOT = realish(rootText, rootText);
const ALLOW = (process.env.NOWRITE_ALLOW ?? "").split(":").filter((x) => x !== "").map((x) => realish(resolve(x), "\u0000unplaceable")); // a looped entry allows nothing
delete process.env.NOWRITE_ALLOW;
const inside = (abs, dir) => abs === dir || abs.startsWith(dir + sep);
// Every spelling of a path the fs functions accept: a string, a Buffer or any other Uint8Array, a URL, and a plain object that
// merely LOOKS like one (`{ href, protocol: "file:", pathname }`, which Node converts the same way). The last two were routes
// around this guard: `writeFileSync(new TextEncoder().encode(path), ...)` and `writeFileSync({ href, protocol, pathname }, ...)`.
const pathOf = (p) => {
  if (typeof p === "string") return p;
  if (p instanceof Uint8Array) return Buffer.from(p.buffer, p.byteOffset, p.byteLength).toString();
  if (p !== null && typeof p === "object") { try { return fileURLToPath(p); } catch { return undefined; } }
  return undefined;
};
// A numeric descriptor cannot be placed; the only way to get a writable one for a repository path is
// openSync/open with write flags, which is guarded below.
export const underRepo = (p) => {
  const s = pathOf(p);
  if (s === undefined) return false;
  const abs = realish(s, ROOT);
  return inside(abs, ROOT) && !ALLOW.some((a) => inside(abs, a));
};
const deny = (what, p) => {
  const shown = String(pathOf(p) ?? p).slice(0, 200);
  try { fs.writeSync(2, `${DENIED_MARKER} ${what} ${shown}\n`); } catch { /* stderr gone: the throw below still stops the call */ }
  throw new Error(`${DENIED_MARKER}: ${what} on ${shown} is not allowed here (a plan child reads, it never writes)`);
};
const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_TRUNC;
const writeFlags = (f) => (f === undefined ? false : typeof f === "number" ? (f & WRITE_FLAGS) !== 0 : /[wa+]/.test(String(f)));
// `paths(args)` names the arguments that are paths the call would change.
const guard = (owner, label, name, paths) => {
  const original = owner?.[name];
  if (typeof original !== "function") return;
  owner[name] = function guarded(...args) {
    for (const p of paths(args)) if (underRepo(p)) deny(`${label}.${name}`, p);
    return original.apply(this, args);
  };
};
// Something that is refused whatever it is given, because what it does cannot be placed under or outside the
// repository (a descriptor, a thread, a binding). If it cannot be replaced the preload does not load, and the
// child that asked for it fails to start: a guard that quietly failed to install is the worse outcome.
const forbid = (owner, label, name) => {
  if (owner?.[name] === undefined) return;
  const refused = function refused(...args) { return deny(`${label}.${name}`, args[0]); };
  try { owner[name] = refused; } catch { /* a read-only property: the check below says so */ }
  if (owner[name] !== refused) throw new Error(`${DENIED_MARKER}: cannot refuse ${label}.${name} (the property cannot be replaced)`);
};
const first = (a) => [a[0]];
const both = (a) => [a[0], a[1]];
const second = (a) => [a[1]];
const opening = (a) => (writeFlags(a[1]) ? [a[0]] : []);
// Metadata is a write: `chmod 755` on a guard file shows in `git status`, and `utimes` changes what a build
// cache believes about it.
const METADATA = [
  ["chmodSync", first], ["chmod", first], ["lchmodSync", first], ["lchmod", first],
  ["chownSync", first], ["chown", first], ["lchownSync", first], ["lchown", first],
  ["utimesSync", first], ["utimes", first], ["lutimesSync", first], ["lutimes", first],
];
for (const [name, paths] of [
  ["writeFileSync", first], ["writeFile", first], ["appendFileSync", first], ["appendFile", first],
  ["createWriteStream", first], ["truncateSync", first], ["truncate", first],
  ["renameSync", both], ["rename", both],
  ["rmSync", first], ["rm", first], ["unlinkSync", first], ["unlink", first], ["rmdirSync", first], ["rmdir", first],
  ["mkdirSync", first], ["mkdir", first], ["mkdtempSync", first], ["mkdtemp", first],
  ["copyFileSync", second], ["copyFile", second], ["cpSync", second], ["cp", second],
  // A hard link is a second NAME for the same file: made outside the repository from a repository file it
  // writes through, so the source counts as well as the new name.
  ["symlinkSync", second], ["symlink", second], ["linkSync", both], ["link", both],
  ["openSync", opening], ["open", opening],
  ...METADATA,
]) guard(fs, "fs", name, paths);
if (fs.promises) {
  for (const [name, paths] of [
    ["writeFile", first], ["appendFile", first], ["truncate", first], ["rename", both],
    ["rm", first], ["unlink", first], ["rmdir", first], ["mkdir", first], ["mkdtemp", first],
    ["copyFile", second], ["cp", second], ["symlink", second], ["link", both],
    ...METADATA.filter(([n]) => !n.endsWith("Sync")),
  ]) guard(fs.promises, "fs.promises", name, paths);
}
// A descriptor carries no path. The only way to hold one for a repository file is to open it, which is guarded above
// for writing, so what is left is a read-only descriptor, and `fchmod`/`fchown`/`futimes`/`ftruncate` work on those.
for (const name of ["fchmodSync", "fchmod", "fchownSync", "fchown", "futimesSync", "futimes", "ftruncateSync", "ftruncate"]) forbid(fs, "fs", name);
// The same holds for a `fs.promises` handle: `handle.chmod()` and `handle.utimes()` go through the descriptor, not
// through the functions guarded above. A handle on a repository path is returned with its mutators refused.
const HANDLE_MUTATORS = ["chmod", "chown", "utimes", "truncate", "write", "writev", "writeFile", "appendFile", "createWriteStream"];
const openHandle = fs.promises?.open;
if (typeof openHandle === "function") {
  fs.promises.open = function guardedOpen(path, ...rest) {
    if (writeFlags(rest[0]) && underRepo(path)) deny("fs.promises.open", path);
    const opened = openHandle.call(this, path, ...rest);
    if (!underRepo(path)) return opened;
    return opened.then((handle) => {
      for (const name of HANDLE_MUTATORS) if (typeof handle?.[name] === "function") handle[name] = function refused() { return deny(`FileHandle.${name}`, path); };
      return handle;
    });
  };
}
// A plan child starts no process: the proof runner would be one.
for (const name of ["spawnSync", "spawn", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
  const original = cp[name];
  if (typeof original === "function") cp[name] = function denied(...args) { return deny(`child_process.${name}`, args[0]); };
}
// ...nor a thread, nor an escape from this file's patches. A worker is a new isolate that loads none of them, so
// everything above is bypassed by `new Worker(code, { eval: true })`, and that holds for every way of reaching the
// class: `worker_threads` and `node:worker_threads`, `import`, `require`, `process.getBuiltinModule` and
// `import()` all hand out this one exports object, whose `Worker` is replaced here and re-exported below.
forbid(wt, "worker_threads", "Worker");
forbid(cp, "child_process", "ChildProcess");
for (const name of ["binding", "_linkedBinding", "execve", "dlopen"]) forbid(process, "process", name);
// Files the runtime writes on request, several of them (no argument, or by flag) into the working directory, which is the repository
// when the gate starts a child; and the loader-hooks thread, which is a worker `register()` starts without going through `Worker`.
forbid(v8, "v8", "writeHeapSnapshot");
forbid(v8, "v8", "setHeapSnapshotNearHeapLimit");
forbid(v8, "v8", "setFlagsFromString");
forbid(traceEvents, "trace_events", "createTracing");
forbid(Module, "module", "register");
if (process.report) {
  forbid(process.report, "process.report", "writeReport");
  // The runtime writes `report.<date>.json` on its own, into `report.directory` (the working directory unless set), when `reportOnSignal`,
  // `reportOnUncaughtException` or `reportOnFatalError` is on: setting one and raising the signal (or throwing) is a write the functions
  // above never see. The settings are accessor properties; their setters are refused (a read stays possible), so none of them can be changed.
  for (const name of Object.getOwnPropertyNames(process.report)) {
    const descriptor = Object.getOwnPropertyDescriptor(process.report, name);
    if (typeof descriptor?.set !== "function") continue;
    const refused = function refused(value) { return deny(`process.report.${name} =`, String(value)); };
    try { Object.defineProperty(process.report, name, { ...descriptor, set: refused }); } catch { /* checked below */ }
    if (Object.getOwnPropertyDescriptor(process.report, name)?.set !== refused) throw new Error(`${DENIED_MARKER}: cannot refuse process.report.${name} (the setter cannot be replaced)`);
  }
}
// A unix socket is a file in the directory it is bound in.
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function guardedListen(...args) {
  const a0 = args[0];
  const bound = typeof a0 === "string" && !/^\d+$/.test(a0) ? a0 : a0 !== null && typeof a0 === "object" ? a0.path : undefined;
  if (bound !== undefined && underRepo(bound)) deny("net.Server.listen", bound);
  return listen.apply(this, args);
};
// WebAssembly System Interface: a module run under it writes to whatever directory it is handed. And SQLite: opening a database
// creates the file. Both print an experimental-feature warning when first loaded, which this load would otherwise put on every
// child's stderr (a Node that has neither builtin has nothing to refuse).
{
  const warn = process.emitWarning;
  process.emitWarning = () => {};
  try {
    forbid(process.getBuiltinModule?.("node:wasi"), "wasi", "WASI");
    forbid(process.getBuiltinModule?.("node:sqlite"), "sqlite", "DatabaseSync");
  } finally { process.emitWarning = warn; }
}
syncBuiltinESMExports();
