/**
 * The optional stateful session (HARNESS.md phase 2, adapted by
 * `.claude/skills/cli-anything/SKILL.md`).
 *
 * It remembers ONE thing: the last decision id this CLI minted, so `explain` and
 * `signals` can follow a `decide` without the id being retyped. It is off unless
 * SIGNALGRID_CLI_SESSION names an absolute path, and that path must lie OUTSIDE
 * this repository — an untracked file in the tree flips every sim result's
 * `provenance.workingTreeClean`. The token is never written; base URL and tenant
 * are written only so a session minted against one server is never replayed
 * against another.
 *
 * Writes are exclusive: a `<file>.lock` created with O_EXCL is held across the
 * write (third_party/cli-anything/guides/session-locking.md, translated from
 * fcntl to what Node offers portably), and the file itself is replaced by rename,
 * so a reader never sees half a session.
 */
import { accessSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError, EXIT, safeId, type Config } from "./client.js";

interface SessionData {
  version: 1;
  baseUrl: string;
  tenant: string;
  lastDecisionId: string | null;
}

/** The repository this CLI ships in: the nearest ancestor holding pnpm-workspace.yaml. */
function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function sessionPath(env: NodeJS.ProcessEnv): string | null {
  const raw = (env["SIGNALGRID_CLI_SESSION"] ?? "").trim();
  if (!raw) return null;
  if (!isAbsolute(raw)) {
    throw new CliError("session_invalid", "SIGNALGRID_CLI_SESSION must be an absolute path.", EXIT.usage);
  }
  const path = resolve(raw);
  const root = repoRoot();
  if (root) {
    // Compare REAL paths: a symlink outside the tree that points into it must not pass.
    const rel = relative(realpathSync(root), realOf(path));
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
      throw new CliError(
        "session_in_tree",
        `SIGNALGRID_CLI_SESSION (${path}) is inside the repository; a session file must live outside the tree.`,
        EXIT.usage,
      );
    }
  }
  return path;
}

/** The real path of `p`: its deepest existing ancestor resolved through symlinks, plus the rest. */
function realOf(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const parent = dirname(p);
  return parent === p ? p : join(realOf(parent), basename(p));
}

export function readSession(path: string | null, cfg: Config): SessionData | null {
  if (!path || !existsSync(path)) return null;
  let data: SessionData;
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as SessionData;
  } catch {
    throw new CliError("session_invalid", `session file ${path} is not valid JSON; refusing to guess.`, EXIT.usage);
  }
  // A session minted against another server or tenant does not apply here.
  if (data.version !== 1 || data.baseUrl !== cfg.baseUrl || data.tenant !== cfg.tenant) return null;
  if (data.lastDecisionId !== null) safeId(String(data.lastDecisionId), "the session's last decision id");
  return data;
}

/**
 * Everything about a session write that can be known before a request is sent: its
 * directory exists and no other process holds its lock. Called by a write command
 * BEFORE the write, so a session problem refuses with nothing sent.
 */
export function checkSessionWritable(path: string | null): void {
  if (!path) return;
  const dir = dirname(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new CliError("session_invalid", `the directory for SIGNALGRID_CLI_SESSION (${dir}) does not exist; nothing was sent.`, EXIT.usage);
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new CliError("session_invalid", `the directory for SIGNALGRID_CLI_SESSION (${dir}) is not writable; nothing was sent.`, EXIT.usage);
  }
  // A directory (or other non-file) AT the session path can never be replaced by a file.
  if (existsSync(path) && !lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()) {
    throw new CliError("session_invalid", `SIGNALGRID_CLI_SESSION (${path}) is not a file; nothing was sent.`, EXIT.usage);
  }
  if (existsSync(`${path}.lock`)) {
    throw new CliError("session_locked", `session ${path} is locked by another process (${path}.lock); nothing was sent.`, EXIT.usage);
  }
}

export function writeSession(path: string | null, cfg: Config, lastDecisionId: string): void {
  if (!path) return;
  // The id came from the server's answer; it is written only in the shape the CLI would send.
  const id = safeId(lastDecisionId, "the decision id the server returned");
  const lock = `${path}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new CliError("session_locked", `session ${path} is locked by another process (${lock}).`, EXIT.usage);
    }
    throw new CliError("session_invalid", `cannot lock session ${path}: ${(err as Error).message}`, EXIT.usage);
  }
  try {
    const data: SessionData = { version: 1, baseUrl: cfg.baseUrl, tenant: cfg.tenant, lastDecisionId: id };
    // The temporary file is CREATED, never opened: a stale entry (or a symlink someone
    // planted at this name) is removed, then the file is made with O_EXCL, which refuses
    // to follow or reuse anything already there. Following a planted link would write
    // outside the validated session path — into the repository, or over any file the
    // operator can write (review round 3 on PR #1321).
    const tmp = `${path}.tmp`;
    rmSync(tmp, { force: true });
    const tfd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(tfd, `${JSON.stringify(data, null, 2)}\n`);
    } finally {
      closeSync(tfd);
    }
    renameSync(tmp, path);
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
