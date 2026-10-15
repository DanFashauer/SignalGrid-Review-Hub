// A Node preload for the sharding gate's stub-driven sweep (`NODE_OPTIONS="--import=no-write-preload.mjs
// --import=<this file>" node mutation-guard.mjs --proof=… --shard=…`, so the guard sees the empty `process.execArgv` a CI step gives it): the REAL main() runs its real sweep path, but
// the disk and the proof are stubbed, so nothing is mutated and no proof runs.
//   - `writeFileSync` on an existing file under the repository is RECORDED, not performed. A write whose
//     text differs from the file on disk is a mutation; one equal to it is the restore. Any other write
//     falls through to no-write-preload's denial.
//   - `spawnSync("pnpm", ["run", <proof>])` answers `summary=pass (1/1)` while no mutation is "on disk"
//     and `summary=fail (0/1)` while one is, so the sweep sees a clean baseline and kills every mutant.
//     Any other spawn stays denied. `SWEEP_STUB_SURVIVE=<n>` (read once, then removed from the environment)
//     makes the n-th mutation written, counting from 1, answer `pass` as well: that mutant SURVIVES its proof,
//     which is the one branch of main() a kill-everything stub never takes.
//   - At exit, one stderr line `SWEEP-STUB-REPORT {json}` lists the mutation writes in order as
//     `{ file, sha256 }`, how many proof runs there were, and how many mutations were never restored.
// The gate compares that list with what the selector planned for the same shard.
import fs from "node:fs";
import cp from "node:child_process";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { underRepo } from "./no-write-preload.mjs";

export const REPORT_MARKER = "SWEEP-STUB-REPORT";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const denyWrite = fs.writeFileSync;
const denySpawn = cp.spawnSync;
const readFileSync = fs.readFileSync;
const existsSync = fs.existsSync;
const SURVIVE = Number.parseInt(process.env.SWEEP_STUB_SURVIVE ?? "", 10);
delete process.env.SWEEP_STUB_SURVIVE;
const onDisk = new Map();
const writes = [];
let proofRuns = 0;
fs.writeFileSync = function recorded(path, data, ...rest) {
  if (typeof path !== "string" || typeof data !== "string" || !underRepo(path) || !existsSync(path)) return denyWrite.call(this, path, data, ...rest);
  const abs = resolve(path);
  if (data === readFileSync(abs, "utf8")) {
    onDisk.delete(abs);
  } else {
    onDisk.set(abs, data);
    writes.push({ file: relative(ROOT, abs), sha256: createHash("sha256").update(data).digest("hex") });
  }
  return undefined;
};
cp.spawnSync = function stubbed(bin, args, ...rest) {
  if (bin !== "pnpm" || !Array.isArray(args) || args[0] !== "run") return denySpawn.call(this, bin, args, ...rest);
  proofRuns += 1;
  return { status: 0, signal: null, pid: 0, output: null, stderr: "", stdout: onDisk.size === 0 || writes.length === SURVIVE ? "summary=pass (1/1)\n" : "summary=fail (0/1)\n" };
};
process.on("exit", () => {
  // The report is tens of kilobytes for the whole registry and stderr may be a pipe: finish the write even if it is
  // split or momentarily refused.
  const line = Buffer.from(`${REPORT_MARKER} ${JSON.stringify({ writes, proofRuns, dirty: onDisk.size })}\n`);
  let at = 0;
  while (at < line.length) {
    try { at += fs.writeSync(2, line, at); } catch (err) { if (err?.code !== "EAGAIN") throw err; }
  }
});
syncBuiltinESMExports();
