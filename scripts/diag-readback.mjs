// TEMPORARY diagnostic (throwaway branch, never merged): why the readback says "unknown" on hosted macOS 15.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = ["ignore", "pipe", "pipe", "ignore", "ignore", "ignore", "ignore", "ignore", "ignore"];
const GB = `my $limit = shift; my $pid = fork; exit 125 unless defined $pid;
if (!$pid) { POSIX::setsid(); exec @ARGV or POSIX::_exit(127); }
$SIG{ALRM} = sub { kill "TERM", -$pid; sleep 2; kill "KILL", -$pid; waitpid($pid, 0); exit 124 };
alarm $limit; waitpid($pid, 0); my $status = $?; alarm 0;
exit(($status & 127) ? 128 + ($status & 127) : $status >> 8);`;
const show = (l, r) => console.log(l, JSON.stringify({ error: r.error && String(r.error), status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr }));
if (process.argv[2] === "inner") {
  const root = process.argv[3], env = { ...process.env };
  show("perl ls-remote (9 stdio)", spawnSync("perl", ["-MPOSIX", "-e", GB, "60", "git", "ls-remote", "origin", "x"], { cwd: root, env, encoding: "utf8", stdio: P }));
  show("perl ls-remote (3 stdio)", spawnSync("perl", ["-MPOSIX", "-e", GB, "60", "git", "ls-remote", "origin", "x"], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  show("perl fetch", spawnSync("perl", ["-MPOSIX", "-e", GB, "60", "git", "fetch"], { cwd: root, env, encoding: "utf8", stdio: P }));
  show("git merge-base (9 stdio)", spawnSync("git", ["merge-base"], { cwd: root, env, encoding: "utf8", stdio: P }));
  show("git merge-base (3 stdio)", spawnSync("git", ["merge-base"], { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  show("lsof self", spawnSync("/usr/sbin/lsof", ["-a", "-p", String(process.pid), "-d", "0-12"], { encoding: "utf8" }));
} else {
  for (const c of [["sw_vers"], ["perl", "-v"], ["/bin/sh", "-c", "ls -l /bin/sh /private/var/select/sh; ulimit -a"]]) show(c.join(" "), spawnSync(c[0], c.slice(1), { encoding: "utf8" }));
  const root = mkdtempSync(join(tmpdir(), "sg-diag-")), bin = join(root, "bin"), probe = join(root, "fd8"), receipt = join(root, "r.submission.json");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), '#!/bin/sh\nif [ "$1" = ls-remote ]; then if { true >&8; } 2>/dev/null; then echo HELD > "$FIXTURE_FD8"; else echo CLOSED > "$FIXTURE_FD8"; fi; fi\nif [ "$1" = merge-base ] || [ "$1" = rev-parse ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
  writeFileSync(receipt, JSON.stringify({ version: 1, target: "lane/mac-mail-20261101-010000Z-0123456789ab", head: "a".repeat(40), blobs: [] }) + "\n");
  const env = { PATH: bin + ":/usr/bin:/bin", HOME: process.env.HOME, NODE: process.execPath, D: fileURLToPath(import.meta.url), M: join(ROOT, "scripts/lib/lane-attempt-store.mjs"), ROOT: root, RECEIPT: receipt, FIXTURE_FD8: probe };
  for (const [label, script] of [
    ["WITH fd8: inner", 'exec 8<"$RECEIPT"; "$NODE" "$D" inner "$ROOT"'],
    ["WITHOUT fd8: inner", '"$NODE" "$D" inner "$ROOT"'],
    ["WITH fd8: disposition", 'exec 8<"$RECEIPT"; "$NODE" "$M" refused-disposition "$ROOT" "$RECEIPT"'],
    ["WITHOUT fd8: disposition", '"$NODE" "$M" refused-disposition "$ROOT" "$RECEIPT"'],
  ]) { console.log("=== " + label); const r = spawnSync("/bin/bash", ["-c", script], { cwd: root, encoding: "utf8", env }); console.log(r.stdout, r.stderr, "exit", r.status, "probe", existsSync(probe) ? readFileSync(probe, "utf8").trim() : "none"); }
}
