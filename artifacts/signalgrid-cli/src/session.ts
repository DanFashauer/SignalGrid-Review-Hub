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
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
    const rel = relative(root, path);
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
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}
