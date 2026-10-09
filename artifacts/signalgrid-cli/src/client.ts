/**
 * The `signalgrid` CLI's only way to learn anything: a request to the /v1 API.
 *
 * The CLI is a CLIENT of the decision core, never a shortcut around it (DR-040,
 * `.claude/skills/cli-anything/SKILL.md`). It decides nothing: every verdict it
 * prints is the one /v1 returned. So every way of NOT getting an answer — no
 * token, no base URL, an unreachable server, a refusal, a body that is not JSON —
 * is an error with a non-zero exit and a message that says which of those it
 * was. None of them is ever rendered as an empty-but-successful result.
 */
import { randomUUID } from "node:crypto";

/** Exit codes. Stable: an agent branches on them. */
export const EXIT = {
  ok: 0,
  /** The server answered, but with a refusal or an answer the CLI cannot vouch for. */
  refused: 1,
  /** Usage or configuration error; no request was sent. */
  usage: 2,
  /** No answer was received at all. */
  unreachable: 3,
  /** A write was asked for without `--allow-write`; nothing was sent. */
  writeNotAllowed: 4,
} as const;

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exit: number,
    /** Machine-readable facts an agent needs to recover (e.g. the idempotency key of a write). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface Config {
  /** e.g. http://127.0.0.1:8080/api — the prefix /v1 routes hang off. */
  baseUrl: string;
  /** The tenant the operator believes this token belongs to (id or slug). */
  tenant: string;
  token: string;
  /** baseUrl with any userinfo removed — the only form an error message may print. */
  display: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Configuration comes from the environment and nowhere else — never from a file
 * in the tree, never from a flag (a token on the command line lands in shell
 * history and `ps`). Missing values refuse; nothing is defaulted.
 */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const baseUrl = (env["SIGNALGRID_BASE_URL"] ?? "").trim();
  const tenant = (env["SIGNALGRID_TENANT"] ?? "").trim();
  const token = (env["SIGNALGRID_TOKEN"] ?? "").trim();
  const missing = [
    !baseUrl && "SIGNALGRID_BASE_URL",
    !tenant && "SIGNALGRID_TENANT",
    !token && "SIGNALGRID_TOKEN",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new CliError("config_missing", `${missing.join(", ")} not set; no request was sent.`, EXIT.usage);
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CliError("config_invalid", "SIGNALGRID_BASE_URL is not a URL; no request was sent.", EXIT.usage);
  }
  // Loopback only, over either scheme. This repository is the public Review Hub: the
  // CLI drives a local or fixture api-server and never a live deployment (AGENTS.md:
  // no real vendor/API calls here), so a remote host is refused before the token, or a
  // write, can leave this machine — https or not (review round 5 on PR #1321).
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !LOOPBACK.has(url.hostname)) {
    throw new CliError(
      "config_invalid",
      "SIGNALGRID_BASE_URL must be a loopback api-server (localhost, 127.0.0.1 or ::1); a remote or live deployment is refused and no request was sent.",
      EXIT.usage,
    );
  }
  const display = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), tenant, token, display };
}

/**
 * An id the CLI will put in a request path or a session file. Decision and connector
 * ids are server-minted (`dec_…`, `conn_…`); anything outside this shape — a slash, a
 * dot-dot, a query string, a newline — is refused before it reaches a URL or a file,
 * whether it came from the command line, the session file or the server's answer.
 */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const isSafeId = (raw: unknown): raw is string => typeof raw === "string" && ID_SHAPE.test(raw);
export function safeId(raw: string, what: string): string {
  if (!isSafeId(raw)) {
    throw new CliError("id_invalid", `${what} is not a well-formed id (letters, digits, _ and - only); refused.`, EXIT.usage);
  }
  return raw;
}

export interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** The Idempotency-Key a write sends: the operator's, to recover a lost answer, or a fresh one. */
export function idempotencyKey(given: string | undefined): string {
  if (given === undefined) return randomUUID();
  if (!ID_SHAPE.test(given)) {
    throw new CliError("usage", "--idempotency-key is not a well-formed key (letters, digits, _ and - only, at most 128); refused.", EXIT.usage);
  }
  return given;
}

/**
 * What a write that got no usable answer must still tell the operator: the key that
 * recovers it, and the limits of that recovery. Used on EVERY post-send failure of a
 * keyed write — no answer, a dropped body, a body that is not JSON, a 2xx that carries
 * no recognisable result — because each of them may sit behind a committed write
 * (review round 8 on PR #1321).
 */
export function writeRecovery(key: string | undefined): { suffix: string; extra: Record<string, unknown> | undefined } {
  return key
    ? {
        suffix: ` The write may have been recorded. Re-running the same command with --idempotency-key ${key} within 5 minutes replays the recorded answer only from the same server process (its replay store is in-process memory); if the server restarted or runs as several instances, check \`signalgrid audit\` for the write before retrying.`,
        extra: { idempotencyKey: key },
      }
    : { suffix: "", extra: undefined };
}

/**
 * Every request the CLI makes. `method` other than GET is a write, and every write
 * carries an Idempotency-Key (artifacts/api-server/src/middlewares/idempotency.ts).
 * When a write gets no answer, the server may still have recorded it, so the error
 * names the key: re-running the same command with `--idempotency-key <key>` inside the
 * server's replay window returns the recorded answer instead of writing again — from the
 * same server process only, since that store is per-process memory (review round 7). There
 * is no automatic retry — two copies in flight at once both execute (that middleware's
 * own stated scope), so a retry is the operator's deliberate act, never a reflex.
 *
 * Redirects are refused, never followed: the bearer token goes to SIGNALGRID_BASE_URL
 * and nowhere else, and a redirected answer is not the answer of the server configured.
 */
export async function call(
  cfg: Config,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  key?: string,
): Promise<Answer> {
  if (method !== "GET" && !key) throw new CliError("unexpected", `${method} ${path} without an idempotency key; nothing was sent.`, EXIT.usage);
  const { suffix: lost, extra } = writeRecovery(key);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const c = (err as { cause?: { code?: string; message?: string; errors?: Array<{ code?: string }> } }).cause;
    if (/redirect/i.test(c?.message ?? "")) {
      throw new CliError(
        "redirect_refused",
        `${method} ${path}: ${cfg.display} answered with a redirect, which the CLI never follows; nothing is reported.`,
        EXIT.refused,
      );
    }
    const cause = c?.code ?? c?.errors?.[0]?.code ?? (err as Error).name;
    throw new CliError(
      "unreachable",
      `could not reach ${cfg.display} (${cause}); no answer was received, so nothing is reported.${lost}`,
      EXIT.unreachable,
      extra,
    );
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    // Headers arrived but the body did not: no complete answer was received.
    throw new CliError(
      "unreachable",
      `${method} ${path}: the connection to ${cfg.display} dropped mid-answer; nothing is reported.${lost}`,
      EXIT.unreachable,
      extra,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError(
      "malformed_answer",
      `${method} ${path} answered HTTP ${res.status} with a body that is not JSON; nothing is reported.${lost}`,
      EXIT.refused,
      extra,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("malformed_answer", `${method} ${path} answered with JSON that is not an object; nothing is reported.${lost}`, EXIT.refused, extra);
  }
  const obj = parsed as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof obj["error"] === "string" ? obj["error"] : "error";
    const msg = typeof obj["message"] === "string" ? obj["message"] : "(no message)";
    throw new CliError(code, `${method} ${path} refused: HTTP ${res.status} ${code} — ${msg}`, EXIT.refused);
  }
  return { status: res.status, body: obj };
}

/**
 * The token decides the tenant server-side; SIGNALGRID_TENANT is what the operator
 * BELIEVES it decides. A disagreement means the wrong credential is loaded, and the
 * CLI refuses rather than print another tenant's records under this one's name.
 */
export async function confirmTenant(cfg: Config): Promise<{ id: string; slug: string }> {
  const { body } = await call(cfg, "GET", "/v1/context");
  const tenant = body["tenant"] as { id?: unknown; slug?: unknown } | undefined;
  const id = typeof tenant?.id === "string" ? tenant.id : "";
  const slug = typeof tenant?.slug === "string" ? tenant.slug : "";
  if (!id) {
    throw new CliError("malformed_answer", "GET /v1/context named no tenant; nothing is reported.", EXIT.refused);
  }
  if (cfg.tenant !== id && cfg.tenant !== slug) {
    throw new CliError(
      "tenant_mismatch",
      `SIGNALGRID_TENANT is "${cfg.tenant}" but the token belongs to "${id}"${slug ? ` (${slug})` : ""}; nothing was requested beyond /v1/context.`,
      EXIT.usage,
    );
  }
  return { id, slug };
}
