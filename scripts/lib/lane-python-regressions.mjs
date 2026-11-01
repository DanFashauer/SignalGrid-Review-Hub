// Public Python fixture runner: retain original output/terminal before judging it.
// A platform kernel profile is inherited only by these disposable test children.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const owned = st => st.uid === process.getuid() && !(st.mode & 0o077);
function retain(path, value) {
  writeFileSync(path, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true });
}
function boundedOutput(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || !owned(before) || before.size > 32 * 1024 * 1024) throw Error("Original output is not a bounded owned regular file");
    const raw = readFileSync(fd), after = fstatSync(fd);
    if (raw.length !== before.size || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key])) throw Error("Original output changed during readback");
    return raw;
  } finally { closeSync(fd); }
}

export function runPythonRegressions({ label, script, expectedTests }) {
  let artifacts;
  try {
    if (!/^[a-z-]+$/.test(label) || !/^check-lane-[a-z-]+\.py$/.test(script) || !Number.isSafeInteger(expectedTests) || expectedTests <= 0) throw Error("Fixed public check configuration required");
    const source = join(ROOT, "scripts", script);
    artifacts = realpathSync(mkdtempSync(join(tmpdir(), "sg-" + label + "-")));
    const directory = lstatSync(artifacts);
    if (!directory.isDirectory() || !owned(directory)) throw Error("Unique owned fixture directory required");
    const ownerPath = join(artifacts, "wrapper-owner.json");
    retain(ownerPath, { token: randomBytes(16).toString("hex"), dev: directory.dev, ino: directory.ino, fixture_only: true });
    const ownerBytes = readFileSync(ownerPath);
    const python = ["-I", "-B", source, "--source-root", ROOT, "--node", process.execPath, "--artifact-root", artifacts];
    let executable, argv, profile;
    if (process.platform === "darwin") {
      executable = "/usr/bin/sandbox-exec";
      profile = "(version 1) (allow default) (deny network*)";
      argv = ["-p", profile, "python3", ...python];
    } else if (process.platform === "linux") {
      executable = "python3"; argv = python;
      profile = "existing OS libseccomp.so.2, process-local transport denial; unchanged real socket assertion";
    } else throw Error("Actual kernel network denial is unsupported on this platform");
    retain(join(artifacts, "wrapper-intent.json"), { argv: [executable, ...argv], profile,
      python_source_sha256: sha(readFileSync(source)), actual_node: process.execPath,
      expected_tests: expectedTests, no_timeout_or_forced_signal: true, actual_home_unchanged: true });
    const stdoutPath = join(artifacts, "python.stdout.raw"), stderrPath = join(artifacts, "python.stderr.raw");
    const output = openSync(stdoutPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const errors = openSync(stderrPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let actual;
    try {
      // A file-backed capture has no spawn buffer ceiling that could signal an
      // original running child. There is no timeout, group kill or admission.
      actual = spawnSync(executable, argv, { cwd: ROOT, env: process.env, stdio: ["ignore", output, errors] });
    } catch (error) {
      actual = { status: null, signal: null, error };
    } finally {
      try { fsyncSync(output); fsyncSync(errors); } finally { closeSync(output); closeSync(errors); }
    }
    const stdout = boundedOutput(stdoutPath), stderr = boundedOutput(stderrPath);
    retain(join(artifacts, "wrapper-original-terminal.json"), { status: actual.status ?? null, signal: actual.signal ?? null,
      error: actual.error ? { name: actual.error.name, code: actual.error.code ?? null, message: actual.error.message } : null,
      stdout_sha256: sha(stdout), stderr_sha256: sha(stderr) });
    process.stdout.write(stdout); process.stderr.write(stderr);
    if (actual.error || actual.signal !== null || actual.status !== 0) throw Error("Original Python child did not complete normally with exit 0");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(stderr).replace(/\r\n/g, "\n");
    const summaries = [...text.matchAll(/^Ran ([0-9]+) tests? in [0-9.]+s$/gm)];
    const passed = [...text.matchAll(/^test_[^\n]+\.\.\. ok$/gm)].length;
    if (summaries.length !== 1 || Number(summaries[0][1]) !== expectedTests || passed !== expectedTests ||
        !/^OK$/m.test(text) || /^FAILED\b/m.test(text) || /^test_[^\n]+\.\.\. (?:skipped|ERROR|FAIL)\b/m.test(text)) {
      throw Error("Actual unittest summary does not establish every required test with zero skips/errors");
    }
    retain(join(artifacts, "wrapper-accepted-result.json"), { tests: passed, passed, failed: 0, errors: 0, skipped: 0,
      original_child_status: actual.status, original_child_signal: actual.signal, fixture_only: true });
    // Retain every fixture on failure. Only an accepted normal original exit
    // allows this wrapper to remove its own exact unique temporary directory.
    const named = lstatSync(artifacts), owner = lstatSync(ownerPath);
    if (!named.isDirectory() || !owned(named) || named.dev !== directory.dev || named.ino !== directory.ino ||
        !owner.isFile() || owner.nlink !== 1 || !owned(owner) || !readFileSync(ownerPath).equals(ownerBytes)) {
      throw Error("Fixture ownership changed; preserve evidence");
    }
    rmSync(artifacts, { recursive: true, force: false });
    console.log(`${label} regression: ${passed} passed, 0 failed, 0 skipped`);
  } catch (error) {
    console.error(`${label} regression FAILED: ${error.message}`);
    if (artifacts) console.error(`Original fixture evidence retained at ${artifacts}`);
    process.exitCode = 1;
  }
}
