/**
 * `signalgrid` — an agent-native command line over SignalGrid's own /v1 API
 * (DR-040; the CLI-Anything method, `third_party/cli-anything/HARNESS.md`, as
 * adapted by `.claude/skills/cli-anything/SKILL.md`).
 *
 * Laws, each asserted by `scripts/src/signalgrid-cli-proof.ts`:
 *   1. It decides nothing. Every verdict printed is the one /v1 returned, and an
 *      answer that carries no recognisable verdict is an error, not a blank.
 *   2. Read-only by default. A subcommand that would make the server write
 *      (`decide` mints a decision + audit record; `connectors sync` starts a sync
 *      run) sends NOTHING without `--allow-write`: it prints the request it would
 *      have made and exits 4.
 *   3. Fail closed. No token, no base URL, an unreachable server, a refusal, a
 *      tenant mismatch: non-zero exit and a message naming which.
 *   4. Dual output. Human text by default; `--json` prints the same facts as one
 *      JSON object on stdout — errors included — for an agent to parse.
 *   5. No registry, no telemetry, no install-time fetch; the only network peer is
 *      SIGNALGRID_BASE_URL.
 */
import { parseArgs } from "node:util";
import { call, CliError, confirmTenant, EXIT, readConfig, type Config } from "./client.js";
import { readSession, sessionPath, writeSession } from "./session.js";

/** The four words a host app obeys (lib/signalgrid-core/src/types.ts DecisionOutcome). */
const OUTCOMES = new Set(["allow", "step_up", "restrict", "deny"]);

interface CommandSpec {
  usage: string;
  summary: string;
  /** The /v1 requests it makes. A non-GET entry is a write. */
  requests: string[];
  writes: boolean;
}

/** Drives `--help` AND the generated SKILL.md, so the two cannot drift apart. */
export const COMMANDS: Record<string, CommandSpec> = {
  decide: {
    usage: "signalgrid decide --identity <ref> --device <ref> --workflow <key> [--allow-write] [--json]",
    summary:
      "Ask /v1 for a decision. WRITES (a decision record and an audit event), so without --allow-write it prints the request it would send and exits 4.",
    requests: ["GET /v1/context", "POST /v1/decisions/evaluate"],
    writes: true,
  },
  explain: {
    usage: "signalgrid explain [<decisionId>] [--json]",
    summary:
      "Show a recorded decision: outcome, reason codes, matched rules, the server's explanation, and whether its evidence snapshot verifies.",
    requests: ["GET /v1/context", "GET /v1/decisions/:id", "GET /v1/decisions/:id/evidence"],
    writes: false,
  },
  signals: {
    usage: "signalgrid signals [<decisionId>] [--json]",
    summary: "List the normalized signals a decision's evidence snapshot used, with freshness and source reference.",
    requests: ["GET /v1/context", "GET /v1/decisions/:id/evidence"],
    writes: false,
  },
  audit: {
    usage: "signalgrid audit [--limit <n>] [--json]",
    summary: "Show the tenant's audit events (newest last) and the ledger's chain verdict. A broken chain exits 1.",
    requests: ["GET /v1/context", "GET /v1/audit"],
    writes: false,
  },
  connectors: {
    usage: "signalgrid connectors [runs <connectorId> | sync <connectorId> [--allow-write]] [--json]",
    summary:
      "List the tenant's connectors, or one connector's sync runs. `sync` starts a sync run (a WRITE) and needs --allow-write.",
    requests: ["GET /v1/context", "GET /v1/connectors", "GET /v1/connectors/:id/sync-runs", "POST /v1/connectors/:id/sync"],
    writes: true,
  },
  skill: {
    usage: "signalgrid skill",
    summary: "Print this CLI's SKILL.md, generated from the command table (offline; no request).",
    requests: [],
    writes: false,
  },
};

interface Out {
  json: unknown;
  human: string;
  exit?: number;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const str = (v: unknown): string => (v === undefined || v === null ? "unknown" : typeof v === "string" ? v : JSON.stringify(v));

function writeRefused(command: string, method: string, path: string, body: unknown): Out {
  return {
    exit: EXIT.writeNotAllowed,
    json: { ok: false, command, sent: false, error: { code: "write_not_allowed", exit: EXIT.writeNotAllowed }, wouldSend: { method, path, body: body ?? null } },
    human: [
      `NOT SENT — \`${command}\` makes the server write, and --allow-write was not given.`,
      `It would send: ${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`,
      "No decision was made and nothing was recorded.",
    ].join("\n"),
  };
}

function need(value: string | undefined, flag: string): string {
  if (!value || !value.trim()) throw new CliError("usage", `${flag} is required.`, EXIT.usage);
  return value;
}

function decisionIdArg(positional: string | undefined, cfg: Config, env: NodeJS.ProcessEnv): string {
  if (positional) return positional;
  const last = readSession(sessionPath(env), cfg)?.lastDecisionId;
  if (last) return last;
  throw new CliError("usage", "a decision id is required (no session holds a last decision).", EXIT.usage);
}

async function decide(getCfg: () => Config, v: Values, env: NodeJS.ProcessEnv): Promise<Out> {
  const body = {
    identityRef: need(v.identity, "--identity"),
    deviceRef: need(v.device, "--device"),
    workflowKey: need(v.workflow, "--workflow"),
  };
  // Refused before configuration is read: a preview needs no token and sends nothing.
  if (!v["allow-write"]) return writeRefused("decide", "POST", "/v1/decisions/evaluate", body);
  const cfg = getCfg();
  const tenant = await confirmTenant(cfg);
  const { body: answer } = await call(cfg, "POST", "/v1/decisions/evaluate", body);
  const d = answer["decision"] as Record<string, unknown> | undefined;
  const outcome = d?.["outcome"];
  if (!d || typeof outcome !== "string" || !OUTCOMES.has(outcome) || typeof d["decisionId"] !== "string") {
    throw new CliError(
      "malformed_answer",
      "POST /v1/decisions/evaluate answered without a recognisable outcome and decision id; nothing is reported as decided.",
      EXIT.refused,
    );
  }
  writeSession(sessionPath(env), cfg, d["decisionId"]);
  const reasons = Array.isArray(d["reasonCodes"]) ? (d["reasonCodes"] as unknown[]).map(str) : [];
  return {
    json: { ok: true, command: "decide", tenant: tenant.id, sent: true, decision: d },
    human: [
      `outcome     ${outcome}`,
      `decision    ${str(d["decisionId"])}`,
      `reasons     ${reasons.join(", ") || "none"}`,
      `policy      ${str(d["policyVersionId"])}`,
      `explanation ${str(d["explanation"])}`,
    ].join("\n"),
  };
}

async function explain(cfg: Config, id: string): Promise<Out> {
  const tenant = await confirmTenant(cfg);
  const enc = encodeURIComponent(id);
  const { body: rec } = await call(cfg, "GET", `/v1/decisions/${enc}`);
  const { body: ev } = await call(cfg, "GET", `/v1/decisions/${enc}/evidence`);
  const d = rec["decision"] as Record<string, unknown> | undefined;
  if (!d || typeof d["outcome"] !== "string") {
    throw new CliError("malformed_answer", `GET /v1/decisions/${id} carried no outcome; nothing is reported.`, EXIT.refused);
  }
  const verified = ev["verified"] === true;
  const rules = Array.isArray(d["matchedRules"]) ? (d["matchedRules"] as Record<string, unknown>[]) : [];
  const signals = (ev["evidence"] as Record<string, unknown> | undefined)?.["signalsUsed"];
  return {
    exit: verified ? EXIT.ok : EXIT.refused,
    json: { ok: verified, command: "explain", tenant: tenant.id, decision: d, stepUp: rec["stepUp"] ?? null, evidenceVerified: verified },
    human: [
      `decision    ${id}`,
      `outcome     ${d["outcome"]}`,
      `reasons     ${Array.isArray(d["reasonCodes"]) ? (d["reasonCodes"] as unknown[]).map(str).join(", ") : "unknown"}`,
      `policy      ${str(d["policyVersionId"])}`,
      `explanation ${str(d["explanation"])}`,
      `evidence    ${verified ? "digest verifies" : "DOES NOT VERIFY — treat this record as untrusted"} (${Array.isArray(signals) ? signals.length : "unknown"} signals)`,
      "",
      rules.length ? table(["rule", "reason", "outcome", "severity"], rules.map((r) => [str(r["ruleId"]), str(r["reasonCode"]), str(r["outcome"]), str(r["severity"])])) : "no matched rules reported",
    ].join("\n"),
  };
}

async function signals(cfg: Config, id: string): Promise<Out> {
  const tenant = await confirmTenant(cfg);
  const { body: ev } = await call(cfg, "GET", `/v1/decisions/${encodeURIComponent(id)}/evidence`);
  const list = (ev["evidence"] as Record<string, unknown> | undefined)?.["signalsUsed"];
  if (!Array.isArray(list)) {
    throw new CliError("malformed_answer", "the evidence snapshot named no signalsUsed list; nothing is reported.", EXIT.refused);
  }
  const verified = ev["verified"] === true;
  const rows = (list as Record<string, unknown>[]).map((s) => [
    str(s["category"]), str(s["subjectType"]), str(s["value"]), str(s["freshness"]), str(s["observedAt"]), str(s["sourceReference"]),
  ]);
  return {
    exit: verified ? EXIT.ok : EXIT.refused,
    json: { ok: verified, command: "signals", tenant: tenant.id, decisionId: id, evidenceVerified: verified, signals: list },
    human: [
      `${list.length} signals for ${id}; evidence ${verified ? "verifies" : "DOES NOT VERIFY"}`,
      table(["category", "subject", "value", "freshness", "observedAt", "source"], rows),
    ].join("\n"),
  };
}

async function audit(cfg: Config, limitRaw: string | undefined): Promise<Out> {
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) throw new CliError("usage", "--limit must be a positive integer.", EXIT.usage);
  }
  const tenant = await confirmTenant(cfg);
  const { body } = await call(cfg, "GET", `/v1/audit${limit ? `?limit=${limit}` : ""}`);
  const events = body["events"];
  const chain = body["chain"] as Record<string, unknown> | undefined;
  if (!Array.isArray(events) || !chain) {
    throw new CliError("malformed_answer", "GET /v1/audit carried no events list or chain verdict; nothing is reported.", EXIT.refused);
  }
  const shown = limit ? (events as Record<string, unknown>[]).slice(-limit) : (events as Record<string, unknown>[]);
  const valid = chain["valid"] === true;
  return {
    exit: valid ? EXIT.ok : EXIT.refused,
    json: { ok: valid, command: "audit", tenant: tenant.id, source: body["source"] ?? null, chain, events: shown },
    human: [
      `chain ${valid ? "valid" : `BROKEN at seq ${str(chain["brokenAtSeq"])}`} · length ${str(chain["length"])} · source ${str(body["source"])} · showing ${shown.length}`,
      table(["seq", "recordedAt", "type", "actor", "subject"], shown.map((e) => [str(e["seq"]), str(e["recordedAt"]), str(e["type"]), str(e["actor"]), str(e["subject"])])),
    ].join("\n"),
  };
}

async function connectors(getCfg: () => Config, args: string[], allowWrite: boolean): Promise<Out> {
  const [sub, id] = args;
  if (sub === "sync") {
    const cid = need(id, "connectors sync <connectorId>");
    const path = `/v1/connectors/${encodeURIComponent(cid)}/sync`;
    if (!allowWrite) return writeRefused("connectors sync", "POST", path, undefined);
    const cfg = getCfg();
    const tenant = await confirmTenant(cfg);
    const { body } = await call(cfg, "POST", path);
    const run = body["syncRun"] as Record<string, unknown> | undefined;
    if (!run) throw new CliError("malformed_answer", `POST ${path} carried no syncRun; nothing is reported.`, EXIT.refused);
    return {
      json: { ok: true, command: "connectors sync", tenant: tenant.id, sent: true, syncRun: run },
      human: `sync run ${str(run["id"])} · status ${str(run["status"])} · ${str(run["note"])}`,
    };
  }
  if (sub === "runs") {
    const cid = need(id, "connectors runs <connectorId>");
    const cfg = getCfg();
    const tenant = await confirmTenant(cfg);
    const { body } = await call(cfg, "GET", `/v1/connectors/${encodeURIComponent(cid)}/sync-runs`);
    const runs = body["syncRuns"];
    if (!Array.isArray(runs)) throw new CliError("malformed_answer", "no syncRuns list in the answer; nothing is reported.", EXIT.refused);
    return {
      json: { ok: true, command: "connectors runs", tenant: tenant.id, connectorId: cid, syncRuns: runs },
      human: table(["run", "status", "startedAt", "records", "signals"], (runs as Record<string, unknown>[]).map((r) => [str(r["id"]), str(r["status"]), str(r["startedAt"]), str(r["recordsProcessed"]), str(r["signalsNormalized"])])),
    };
  }
  if (sub !== undefined) throw new CliError("usage", `unknown connectors subcommand "${sub}".`, EXIT.usage);
  const cfg = getCfg();
  const tenant = await confirmTenant(cfg);
  const { body } = await call(cfg, "GET", "/v1/connectors");
  const list = body["connectors"];
  if (!Array.isArray(list)) throw new CliError("malformed_answer", "GET /v1/connectors carried no connectors list; nothing is reported.", EXIT.refused);
  return {
    json: { ok: true, command: "connectors", tenant: tenant.id, connectors: list },
    human: table(["id", "kind", "mode", "status", "lastSyncAt"], (list as Record<string, unknown>[]).map((c) => [str(c["id"]), str(c["kind"]), str(c["mode"]), str(c["status"]), str(c["lastSyncAt"])])),
  };
}

export function renderSkillMd(): string {
  const rows = Object.entries(COMMANDS)
    .map(([name, c]) => `| \`${name}\` | ${c.writes ? "yes, only with `--allow-write`" : "no"} | ${c.requests.length ? c.requests.map((r) => `\`${r}\``).join(", ") : "none"} | ${c.summary} |`)
    .join("\n");
  return `---
name: signalgrid-cli
description: The signalgrid command line over SignalGrid's own /v1 API (decide, explain, signals, audit, connectors) — read-only by default, human or --json output, fail-closed exit codes. Use when an agent needs a decision, its explanation, its signals, the audit ledger or the connector list from a running api-server without writing HTTP by hand.
---

<!-- GENERATED by \`signalgrid skill\` (artifacts/signalgrid-cli/src/cli.ts renderSkillMd). Do not hand-edit:
     scripts/src/signalgrid-cli-proof.ts fails when this file and the generator disagree. -->

# signalgrid CLI

A client of the decision core, never a shortcut around it (DR-040). It prints what
/v1 returned and decides nothing itself.

## Configure (environment only)

- \`SIGNALGRID_BASE_URL\` — the api-server prefix, e.g. \`http://127.0.0.1:<port>/api\`. https is required except on loopback.
- \`SIGNALGRID_TENANT\` — the tenant id or slug you expect; the CLI refuses when the token belongs to another.
- \`SIGNALGRID_TOKEN\` — the bearer. Never pass it as a flag.
- \`SIGNALGRID_CLI_SESSION\` — optional absolute path OUTSIDE the repository; remembers the last decision id (never the token), written under an exclusive lock.

Run it from the repository root with \`pnpm --filter @workspace/signalgrid-cli run start -- <command>\`.

## Commands

| Command | Writes? | Requests | What it does |
| --- | --- | --- | --- |
${rows}

## Exit codes

| Code | Meaning |
| --- | --- |
| ${EXIT.ok} | answered |
| ${EXIT.refused} | the server refused, or answered with something the CLI cannot vouch for (no outcome, unverifiable evidence, broken audit chain) |
| ${EXIT.usage} | usage or configuration error (missing env, tenant mismatch, session in the tree); no request was sent, or only \`/v1/context\` |
| ${EXIT.unreachable} | no answer was received |
| ${EXIT.writeNotAllowed} | a write was asked for without \`--allow-write\`; the would-be request is printed and nothing was sent |

A non-zero exit is never a verdict. Treat it as "no answer", which a host app reads as deny.

## Rules

- Read-only by default. Pass \`--allow-write\` only when the task says to mint a decision or start a sync.
- No registry, no telemetry, no live tenant: point it at a local or fixture api-server.
- \`--json\` prints one JSON object on stdout for every exit, errors included.
`;
}

type Values = {
  json?: boolean;
  "allow-write"?: boolean;
  identity?: string;
  device?: string;
  workflow?: string;
  limit?: string;
  help?: boolean;
};

function help(): string {
  return [
    "signalgrid — the SignalGrid /v1 control plane from the command line (read-only by default)",
    "",
    ...Object.values(COMMANDS).map((c) => `  ${c.usage}\n      ${c.summary}`),
    "",
    "Environment: SIGNALGRID_BASE_URL, SIGNALGRID_TENANT, SIGNALGRID_TOKEN (required); SIGNALGRID_CLI_SESSION (optional).",
    `Exit: ${EXIT.ok} ok · ${EXIT.refused} refused · ${EXIT.usage} usage · ${EXIT.unreachable} unreachable · ${EXIT.writeNotAllowed} write not allowed`,
  ].join("\n");
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exit: number }> {
  let json = argv.includes("--json");
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: "boolean" },
        "allow-write": { type: "boolean" },
        identity: { type: "string" },
        device: { type: "string" },
        workflow: { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const v = values as Values;
    json = v.json === true;
    const [command, ...rest] = positionals;
    if (v.help || !command) return { stdout: `${help()}\n`, stderr: "", exit: command || v.help ? EXIT.ok : EXIT.usage };
    if (command === "skill") return { stdout: renderSkillMd(), stderr: "", exit: EXIT.ok };
    if (!(command in COMMANDS)) throw new CliError("usage", `unknown command "${command}". Run signalgrid --help.`, EXIT.usage);
    const getCfg = () => readConfig(env);
    let out: Out;
    switch (command) {
      case "decide": out = await decide(getCfg, v, env); break;
      case "explain": { const cfg = getCfg(); out = await explain(cfg, decisionIdArg(rest[0], cfg, env)); break; }
      case "signals": { const cfg = getCfg(); out = await signals(cfg, decisionIdArg(rest[0], cfg, env)); break; }
      case "audit": out = await audit(getCfg(), v.limit); break;
      default: out = await connectors(getCfg, rest, v["allow-write"] === true);
    }
    const exit = out.exit ?? EXIT.ok;
    return { stdout: `${json ? JSON.stringify(out.json, null, 2) : out.human}\n`, stderr: "", exit };
  } catch (err) {
    const e = err instanceof CliError ? err : new CliError("usage", (err as Error).message, EXIT.usage);
    return json
      ? { stdout: `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message, exit: e.exit } }, null, 2)}\n`, stderr: "", exit: e.exit }
      : { stdout: "", stderr: `signalgrid: ${e.message}\n`, exit: e.exit };
  }
}
