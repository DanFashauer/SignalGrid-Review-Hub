// A Node preload (`node --import <this file> …`) for children the sharding gate spawns: the child may
// READ the repository and print, and nothing else. Any attempt to write, rename, remove or create
// something under the repository (or to start another process) throws, after one marker line on stderr
// that the gate also fails on, so a throw swallowed by a try/catch is still seen.
//
// WHY. check-mutation-sharding.mjs runs the real mutation guard in `--plan` mode, a mode that is
// promised to stop before the first mutation is written. That promise was kept only by text pins on
// main(): a plan-mode `writeFileSync` that got past them turned the gate red and left every registered
// guard file, 185 of them, mutated on disk (they are deliberately broken security guards). This makes
// the promise a property of the process instead of a property of the source text.
//
// Scope: paths under the repository root (this file's grandparent). Everything outside it, such as the
// system temp directory, is untouched. `NOWRITE_ALLOW` (colon-separated absolute paths) lists scratch
// locations inside the repository that stay writable; the gate sets none.
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DENIED_MARKER = "NO-WRITE-DENIED";
const realish = (p) => {
  try { return fs.realpathSync(p); } catch { /* does not exist yet: resolve its directory instead */ }
  try { return resolve(fs.realpathSync(dirname(p)), p.slice(dirname(p).length + 1)); } catch { return p; }
};
const ROOT = realish(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
const ALLOW = (process.env.NOWRITE_ALLOW ?? "").split(":").filter((x) => x !== "").map((x) => realish(resolve(x)));
const inside = (abs, dir) => abs === dir || abs.startsWith(dir + sep);
const pathOf = (p) => (typeof p === "string" ? p : p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : undefined);
// A numeric descriptor cannot be placed; the only way to get a writable one for a repository path is
// openSync/open with write flags, which is guarded below.
export const underRepo = (p) => {
  const s = pathOf(p);
  if (s === undefined) return false;
  const abs = realish(resolve(s));
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
const first = (a) => [a[0]];
const both = (a) => [a[0], a[1]];
const second = (a) => [a[1]];
const opening = (a) => (writeFlags(a[1]) ? [a[0]] : []);
for (const [name, paths] of [
  ["writeFileSync", first], ["writeFile", first], ["appendFileSync", first], ["appendFile", first],
  ["createWriteStream", first], ["truncateSync", first], ["truncate", first],
  ["renameSync", both], ["rename", both],
  ["rmSync", first], ["rm", first], ["unlinkSync", first], ["unlink", first], ["rmdirSync", first], ["rmdir", first],
  ["mkdirSync", first], ["mkdir", first], ["mkdtempSync", first], ["mkdtemp", first],
  ["copyFileSync", second], ["copyFile", second], ["cpSync", second], ["cp", second],
  ["symlinkSync", second], ["symlink", second], ["linkSync", second], ["link", second],
  ["openSync", opening], ["open", opening],
]) guard(fs, "fs", name, paths);
if (fs.promises) {
  for (const [name, paths] of [
    ["writeFile", first], ["appendFile", first], ["truncate", first], ["rename", both],
    ["rm", first], ["unlink", first], ["rmdir", first], ["mkdir", first], ["mkdtemp", first],
    ["copyFile", second], ["cp", second], ["symlink", second], ["link", second], ["open", opening],
  ]) guard(fs.promises, "fs.promises", name, paths);
}
// A plan child starts no process: the proof runner would be one.
for (const name of ["spawnSync", "spawn", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
  const original = cp[name];
  if (typeof original === "function") cp[name] = function denied(...args) { return deny(`child_process.${name}`, args[0]); };
}
syncBuiltinESMExports();
