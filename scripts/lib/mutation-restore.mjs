// Journal-based restore for scripts/mutation-guard.mjs (supersedes PR #1398).
//
// THE DEFECT: the sweep writes a deliberately broken source file, then waited for the proof with
// `spawnSync`. A synchronous wait blocks the event loop, so no signal handler can ever run, and a
// SIGINT/SIGTERM/SIGHUP mid-mutation killed the process with the registered file still MUTATED
// (reproduced on mainline: `timeout 8 node scripts/mutation-guard.mjs --proof=proof:carrier-reachability`
// exits 124 and `git status` shows reachability-connector.ts modified). The `finally` restore never
// runs on a signal.
//
// THE FIX, in two halves that fail independently:
//   1. The proof runs ASYNCHRONOUSLY in its own process group (`spawnProofAsync`), so the loop can
//      take a signal, and every catchable terminating signal restores the tree (`installHandlers`).
//   2. Every mutation is JOURNALLED (path + original bytes) in a private directory BEFORE the write,
//      so a signal that cannot be caught (SIGKILL, SIGSTOP) still leaves the record. The next start
//      REFUSES while a journal's file differs from its original, and `--restore-stale` applies it.
//
// CEILING (stated, not fixed): a well-formed journal with a dead pid and NO entries is indistinguishable from a real empty
// one, which is also what a crash inside the persist-before-write window leaves; nothing in it names a file to repair.
// Fail-closed: a journal whose owner process cannot be identified counts as LIVE (refuse, never clear);
// a journalled path outside the repo root is refused; a private-directory problem refuses the sweep.
// No clock, no randomness: the journal is named after the repo root and holds the pid.

import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Every catchable signal whose default action terminates the process. SIGKILL and SIGSTOP cannot be
 *  handled (the journal covers them); SIGUSR1 is node's inspector switch and is left alone; the
 *  synchronous fault signals (SEGV, BUS, ILL, FPE) cannot be resumed from. */
export const TERMINATING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT", "SIGUSR2", "SIGALRM", "SIGVTALRM", "SIGPROF", "SIGXCPU", "SIGXFSZ", "SIGPWR", "SIGIO", "SIGPOLL", "SIGSTKFLT"];

/** The private journal directory: under the OS temp dir, mode 0700, owned by this user, never a symlink,
 *  never inside the repo (a journal in the tree would itself be a mutation the sweep makes). */
export function privateJournalDir(root, base = tmpdir()) {
  const baseRel = relative(realpathSync(root), realpathSync(base));
  if (baseRel === "" || (!baseRel.startsWith("..") && !isAbsolute(baseRel))) throw new Error(`journal base ${base} is inside the repo ${root}; set TMPDIR outside it`); // before anything is created
  const dir = join(base, `signalgrid-mutation-guard-${process.getuid?.() ?? "u"}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`journal directory ${dir} is not a plain directory`);
  if (process.getuid && st.uid !== process.getuid()) throw new Error(`journal directory ${dir} is not owned by this user`);
  if ((st.mode & 0o077) !== 0) chmodSync(dir, 0o700);
  const real = realpathSync(dir);
  const rel = relative(realpathSync(root), real);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error(`journal directory ${real} is inside the repo ${root}; set TMPDIR outside it`);
  return real;
}

/** Is `pid` a live mutation-guard (or the gate that shares its lock)? An identity that cannot be read is
 *  LIVE: the journal is refused, never cleared. */
export function ownerIsLive(pid, selfPid = process.pid, io = { kill: (p) => process.kill(p, 0), readCmdline: (p) => readFileSync(`/proc/${p}/cmdline`, "utf8") }) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === selfPid) return false; // a journal named after this very process is a reused pid
  try {
    io.kill(pid);
  } catch (e) {
    if (e?.code === "ESRCH") return false;
    return true; // EPERM: it exists and is not ours to inspect
  }
  try {
    return /mutation-guard|check-mutation-sharding/.test(io.readCmdline(pid));
  } catch {
    return true; // identity unreadable: LIVE, so the journal is refused, never cleared
  }
}

/** A journal that parses but is not the shape persist() writes is CORRUPT, never "no journal": `null`, `{}`, `[]`, a missing `entries`
 *  or an entry without string `path`/`original` all fail closed. Pure, so a gate can drive it on fixtures. */
export function journalShapeOk(doc) {
  return doc !== null && typeof doc === "object" && !Array.isArray(doc) && Number.isInteger(doc.pid) && doc.pid > 0 && Array.isArray(doc.entries)
    && doc.entries.every((e) => e !== null && typeof e === "object" && typeof e.path === "string" && typeof e.original === "string");
}

export function createJournal({ root, dir, pid = process.pid, isLive = ownerIsLive }) {
  const rootReal = realpathSync(root);
  const file = join(dir, `${rootReal.replace(/[^A-Za-z0-9]/g, "_")}.json`);
  const entries = new Map(); // relative path -> original text
  const children = new Set();

  // Containment is decided on REAL paths: a repo reached through a symlink (macOS /var -> /private/var) is still the repo, and a file inside it that is
  // a symlink to somewhere else is NOT inside (a write through it would land outside). A path that does not exist yet falls back to its resolved parent.
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      try {
        if (lstatSync(p).isSymbolicLink()) return null; // a DANGLING link: a write through it would create its target wherever that is
      } catch {}
      try {
        return join(realpathSync(dirname(resolve(p))), basename(p));
      } catch {
        return resolve(p);
      }
    }
  };
  const inside = (abs) => {
    const at = real(abs);
    if (at === null) return null;
    const rel = relative(rootReal, at);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : null;
  };
  const persist = () => {
    const tmp = `${file}.${pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid, root: rootReal, entries: [...entries].map(([path, original]) => ({ path, original })) }), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const readOther = () => {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      return e?.code === "ENOENT" ? null : { corrupt: true };
    }
    try {
      const doc = JSON.parse(text);
      return journalShapeOk(doc) ? doc : { corrupt: true }; // a parsed `null` is a journal, not an absent one
    } catch {
      return { corrupt: true };
    }
  };

  const api = {
    file,
    /** Startup check. Returns { ok, problems }. A live owner, a corrupt journal, or a journalled file that still
     *  differs from its original all REFUSE; `restoreStale` applies the journal instead. */
    begin({ restoreStale = false } = {}) {
      const prior = readOther();
      if (prior === null) {
        persist(); // the lock marker: an empty journal, written before the baseline
        return { ok: true, problems: [] };
      }
      if (prior.corrupt) return { ok: false, problems: [`journal ${file} is unreadable; refusing (inspect it, then delete it)`] };
      if (prior.pid !== pid && isLive(prior.pid)) return { ok: false, problems: [`another sweep (pid ${prior.pid}) holds ${file}`] };
      const differing = [];
      for (const { path, original } of prior.entries) {
        const abs = resolve(rootReal, path);
        if (inside(abs) === null) return { ok: false, problems: [`journal names a path outside the repo: ${path}`] };
        let now = null;
        try {
          now = readFileSync(abs, "utf8");
        } catch {}
        if (now !== original) differing.push({ abs, path, original });
      }
      if (differing.length > 0 && !restoreStale) {
        return { ok: false, problems: [`a previous sweep died mid-mutation and left: ${differing.map((d) => d.path).join(", ")} (run \`node scripts/mutation-guard.mjs --restore-stale\`)`] };
      }
      for (const d of differing) writeFileSync(d.abs, d.original);
      entries.clear();
      persist();
      return { ok: true, problems: [], restored: differing.map((d) => d.path) };
    },
    /** Journal, THEN write the mutant. */
    mutate(abs, content, original) {
      const rel = inside(abs);
      if (rel === null) throw new Error(`refusing to mutate ${abs}: outside the repo root`);
      entries.set(rel, original);
      persist();
      writeFileSync(abs, content);
    },
    /** Put one file back and drop it from the journal. */
    restore(abs) {
      const rel = inside(abs);
      if (rel === null || !entries.has(rel)) return;
      writeFileSync(resolve(rootReal, rel), entries.get(rel));
      entries.delete(rel);
      persist();
    },
    /** Synchronous, safe to call from a signal handler: kill the proof groups, restore everything. */
    restoreAll() {
      for (const child of children) {
        try {
          if (child.pid > 0) process.kill(-child.pid, "SIGKILL"); // never signal pid 0: that is this process's own group
        } catch {}
      }
      let failed = false;
      for (const [rel, original] of entries) {
        try {
          writeFileSync(resolve(rootReal, rel), original);
        } catch (e) {
          failed = true;
          console.error(`RESTORE FAILED ${rel}: ${e?.message ?? e}`);
          process.exitCode = 1;
        }
      }
      if (!failed) {
        entries.clear();
        try {
          rmSync(file, { force: true });
        } catch {}
      }
      return !failed;
    },
    /** Normal end of a sweep: nothing is mutated, drop the marker. */
    release() {
      if (api.restoreAll()) return true;
      return false;
    },
    /** Restore on exit and on every catchable terminating signal (exit code 128 + signal number). */
    installHandlers(proc = process, signals = TERMINATING_SIGNALS, numbers = null) {
      const nums = numbers ?? osConstants.signals; // the PLATFORM's numbers: SIGUSR2 is 12 on Linux and 31 on macOS
      for (const sig of signals) {
        try {
          proc.on(sig, () => {
            api.restoreAll();
            proc.exit(128 + (nums[sig] ?? 0));
          });
        } catch {} // a signal this platform does not have
      }
      proc.on("exit", () => {
        api.restoreAll();
      });
      for (const ev of ["uncaughtException", "unhandledRejection"]) {
        proc.on(ev, (err) => {
          api.restoreAll();
          console.error(`mutation-guard: ${ev}: ${err?.stack ?? err}`);
          proc.exit(1);
        });
      }
    },
    /** Run `pnpm run <proof>` in its own process group; resolves with the combined output and whether it timed out. */
    spawnProof(proof, { cwd, timeoutMs }) {
      return new Promise((resolveRun) => {
        const child = spawn("pnpm", ["run", proof], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        children.add(child);
        let out = "";
        let timedOut = false;
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            if (child.pid > 0) process.kill(-child.pid, "SIGKILL");
          } catch {}
        }, timeoutMs);
        const done = (extra) => {
          clearTimeout(timer);
          children.delete(child);
          resolveRun({ out: out + (extra ?? ""), timedOut });
        };
        child.on("error", (e) => done(`spawn error: ${e.message}`));
        child.on("close", (code, signal) => {
          if (signal !== null) timedOut = true; // same polarity as runProof: killed by a signal reads "hung"
          done();
        });
      });
    },
  };
  return api;
}
