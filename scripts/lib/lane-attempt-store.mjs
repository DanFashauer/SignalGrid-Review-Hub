// One local attempt store shared by every linked checkout; never a dependency cache.
// Initialize separately after preserving old receipts and verifying no old attempt is in flight.
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function deliveryRecordDirectory(root, initialize = false) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: root, env, encoding: "utf8" });
  const lines = git.stdout?.trim().split("\n");
  if (git.status !== 0 || lines?.length !== 2 || realpathSync(lines[0]) !== realpathSync(root)) throw Error("cannot bind delivery store to this checkout");
  const common = realpathSync(lines[1]);
  const directory = join(common, "signalgrid-lane-records");
  const marker = directory + ".json";
  if (initialize) {
    // No recursive mkdir, overwrite or recovery fallback: partial initialization stays held.
    mkdirSync(directory, { mode: 0o700 });
    const st = lstatSync(directory);
    writeFileSync(marker, JSON.stringify({ version: 1, directory, dev: st.dev, ino: st.ino }) + "\n", { flag: "wx", mode: 0o600, flush: true });
  }
  const fd = openSync(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
  let record;
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw Error("delivery store marker must be an owned regular file");
    record = JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
  const st = lstatSync(directory);
  if (record.version !== 1 || record.directory !== directory || !st.isDirectory() || record.dev !== st.dev || record.ino !== st.ino) throw Error("delivery store missing, replaced or incompatible; preserve evidence, readback only");
  return directory;
}

let entrypoint;
// node -e consumers can use a label instead of a filename in argv[1].
try { if (process.argv[1]) entrypoint = realpathSync(process.argv[1]); } catch { /* imported library */ }
if (entrypoint === fileURLToPath(import.meta.url)) {
  try {
    const [mode, root] = process.argv.slice(2);
    if (!["path", "init"].includes(mode) || !root) throw Error("usage: lane-attempt-store.mjs path|init <checkout>");
    console.log(deliveryRecordDirectory(root, mode === "init"));
  } catch (error) { console.error(`RAISED HAND: delivery record store unavailable: ${error.message}; READBACK ONLY`); process.exitCode = 1; }
}
