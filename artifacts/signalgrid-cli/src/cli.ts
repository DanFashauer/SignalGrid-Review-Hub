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
import { call, CliError, confirmTenant, EXIT, idempotencyKey, isSafeId, readConfig, safeId, writeRecovery, type Config } from "./client.js";
import { checkSessionWritable, readSession, sessionPath, writeSession } from "./session.js";

/** The four words a host app obeys (lib/signalgrid-core/src/types.ts DecisionOutcome). */
const OUTCOMES = new Set(["allow", "step_up", "restrict", "deny"]);
/** A sync run's recognised statuses (lib/signalgrid-core/src/types.ts SyncStatus). */
const SYNC_STATUSES = new Set(["success", "partial", "failed"]);

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
    usage: "signalgrid decide --identity <ref> --device <ref> --workflow <key> [--allow-write [--idempotency-key <key>]] [--json]",
    summary:
      "Ask /v1 for a decision. WRITES (a decision record and an audit event), so without --allow-write it prints the request it would send and exits 4.",
    requests: ["GET /v1/context", "POST /v1/decisions/evaluate", "GET /v1/decisions/:id/evidence", "GET /v1/decisions/:id"],
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
    summary:
      "Show the tenant's audit events (newest last; --limit keeps the newest n) and the ledger's chain verdict. A broken or inconclusive chain exits 1.",
    requests: ["GET /v1/context", "GET /v1/audit"],
    writes: false,
  },
  connectors: {
    usage: "signalgrid connectors [runs <connectorId> | sync <connectorId> [--allow-write [--idempotency-key <key>]]] [--json]",
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
  /** Printed to stderr in both modes; never changes the exit. */
  warning?: string;
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

/**
 * Every server-supplied value is rendered through here, and control characters are escaped
 * rather than printed: a line break in an explanation or a reason code must never forge an
 * extra `outcome` line in human output (review round 11 on PR #1321).
 */
const str = (v: unknown): string => {
  const s = v === undefined || v === null ? "unknown" : typeof v === "string" ? v : JSON.stringify(v);
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
};

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
  // An explicitly given id — even an empty one from an unset variable — is validated, never
  // silently replaced by the session's last decision (review round 11 on PR #1321).
  if (positional !== undefined) return safeId(positional, "the decision id");
  const last = readSession(sessionPath(env), cfg)?.lastDecisionId;
  if (last) return safeId(last, "the session's last decision id");
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
  // The session is settled BEFORE anything is sent: exit 2 means "no request was sent,
  // or only /v1/context", so a bad session path must refuse here, not after a decision
  // has been minted (review round 2 on PR #1321).
  const session = sessionPath(env);
  checkSessionWritable(session);
  const key = idempotencyKey(v["idempotency-key"]);
  const tenant = await confirmTenant(cfg);
  const { body: answer } = await call(cfg, "POST", "/v1/decisions/evaluate", body, key);
  const d = answer["decision"] as Record<string, unknown> | undefined;
  const outcome = d?.["outcome"];
  // An EvaluateResult always names its evidence snapshot; a verdict with no evidence
  // binding is not a decision the CLI reports, however well-formed the outcome (round 6).
  if (!d || typeof outcome !== "string" || !OUTCOMES.has(outcome) || !isSafeId(d["decisionId"]) || !isSafeId(d["evidenceSnapshotId"])) {
    // The 2xx means the server may have recorded a decision: the key goes with the refusal.
    const r = writeRecovery(key);
    throw new CliError(
      "malformed_answer",
      `POST /v1/decisions/evaluate answered without a recognisable outcome, decision id and evidence snapshot id; nothing is reported as decided.${r.suffix}`,
      EXIT.refused,
      r.extra,
    );
  }
  // A well-formed snapshot id is only a reference. Before any verdict is reported (allow
  // above all) the snapshot is fetched and must exist, belong to this decision and pass
  // its digest check — the same binding `explain` applies (review round 9 on PR #1321).
  const decisionId = d["decisionId"] as string;
  let ev: Record<string, unknown>;
  try {
    ({ body: ev } = await call(cfg, "GET", `/v1/decisions/${encodeURIComponent(decisionId)}/evidence`));
  } catch (err) {
    const e = err as CliError;
    throw new CliError(
      e.code ?? "unexpected",
      `decision ${decisionId} was recorded, but its evidence snapshot could not be read (${e.message}); nothing is reported as decided.`,
      e.exit ?? EXIT.refused,
      { decisionId },
    );
  }
  if (!boundVerdict(ev, decisionId, d["evidenceSnapshotId"] as string, tenant.id)) {
    throw new CliError(
      "evidence_unverified",
      `decision ${decisionId} was recorded, but its evidence snapshot ${String(d["evidenceSnapshotId"])} does not verify against it; nothing is reported as decided.`,
      EXIT.refused,
      { decisionId },
    );
  }
  // The snapshot digest covers the evidence, not the outcome: the RECORDED decision is read
  // back and must carry the same outcome and snapshot, in this tenant, before the verdict
  // the evaluate answer named is reported (review round 11 on PR #1321).
  let stored: Record<string, unknown> | undefined;
  try {
    const { body: recBody } = await call(cfg, "GET", `/v1/decisions/${encodeURIComponent(decisionId)}`);
    stored = recBody["decision"] as Record<string, unknown> | undefined;
  } catch (err) {
    const e = err as CliError;
    throw new CliError(e.code ?? "unexpected", `decision ${decisionId} was recorded, but it could not be read back (${e.message}); nothing is reported as decided.`, e.exit ?? EXIT.refused, { decisionId });
  }
  if (!stored || (stored["id"] ?? stored["decisionId"]) !== decisionId || stored["outcome"] !== outcome ||
      stored["evidenceSnapshotId"] !== d["evidenceSnapshotId"] || stored["tenantId"] !== tenant.id) {
    throw new CliError(
      "decision_mismatch",
      `decision ${decisionId} as recorded does not match the evaluate answer (outcome, snapshot or tenant); nothing is reported as decided.`,
      EXIT.refused,
      { decisionId },
    );
  }
  // The decision now EXISTS on the server. A session write that still fails (a race on
  // the lock, a disk error) must not hide it: the verdict is reported, with a warning.
  let warning: string | undefined;
  try {
    writeSession(session, cfg, d["decisionId"]);
  } catch (err) {
    warning = `decision ${d["decisionId"]} was recorded, but the session file was not updated: ${(err as Error).message}`;
  }
  const reasons = Array.isArray(d["reasonCodes"]) ? (d["reasonCodes"] as unknown[]).map(str) : [];
  return {
    warning,
    json: { ok: true, command: "decide", tenant: tenant.id, sent: true, decision: d, evidenceVerified: true, ...(warning ? { sessionWarning: warning } : {}) },
    human: [
      `outcome     ${outcome}`,
      `decision    ${str(d["decisionId"])}`,
      `evidence    digest verifies (${str(d["evidenceSnapshotId"])})`,
      `reasons     ${reasons.join(", ") || "none"}`,
      `policy      ${str(d["policyVersionId"])}`,
      `explanation ${str(d["explanation"])}`,
    ].join("\n"),
  };
}

/**
 * `verified: true` counts only for the snapshot of THIS decision: an evidence answer with
 * no snapshot, or a verified snapshot belonging to another decision, is not a verified
 * record of this one (review round 4 on PR #1321).
 */
function boundVerdict(ev: Record<string, unknown>, decisionId: string, snapshotId: string | null, tenantId: string): boolean {
  const snap = ev["evidence"];
  if (!snap || typeof snap !== "object" || Array.isArray(snap)) return false;
  const s = snap as Record<string, unknown>;
  // The snapshot must belong to the tenant /v1/context confirmed: another tenant's verified
  // evidence is not evidence for this one (review round 10 on PR #1321).
  if (s["tenantId"] !== tenantId) return false;
  if (s["decisionId"] !== decisionId) return false;
  // `null` only where no decision record was read (`signals`); a record that names no
  // snapshot id is never a reason to skip the comparison (review round 5).
  if (snapshotId !== null && (typeof s["id"] !== "string" || s["id"] !== snapshotId)) return false;
  return ev["verified"] === true;
}

/**
 * A step-up answer counts only when it is whole: this decision's, this tenant's, the one
 * method the core issues (core StepUpAnswer.method), a parseable answer time and a
 * credential reference. A partial record is malformed input, never "answered" — it is
 * what tells a host a step_up may proceed (review round 10 on PR #1321).
 */
function isCompleteStepUp(raw: unknown, decisionId: string, tenantId: string, identityId: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const a = raw as Record<string, unknown>;
  // The answer's own id and the identity it was signed by (the decision's identity, never
  // one the request named) bind it to this challenge (review round 11 on PR #1321).
  return (
    isSafeId(a["id"]) &&
    typeof identityId === "string" && identityId.length > 0 && a["identityId"] === identityId &&
    a["decisionId"] === decisionId &&
    a["tenantId"] === tenantId &&
    a["method"] === "webauthn" &&
    typeof a["answeredAt"] === "string" && !Number.isNaN(Date.parse(a["answeredAt"])) &&
    typeof a["credentialReference"] === "string" && a["credentialReference"].length > 0
  );
}

async function explain(cfg: Config, id: string): Promise<Out> {
  const tenant = await confirmTenant(cfg);
  const enc = encodeURIComponent(id);
  const { body: rec } = await call(cfg, "GET", `/v1/decisions/${enc}`);
  const { body: ev } = await call(cfg, "GET", `/v1/decisions/${enc}/evidence`);
  const d = rec["decision"] as Record<string, unknown> | undefined;
  // The same four-word check decide applies: a recorded decision whose outcome is not one
  // of the words a host app obeys is not reported as a decision at all.
  if (!d || typeof d["outcome"] !== "string" || !OUTCOMES.has(d["outcome"])) {
    throw new CliError("malformed_answer", `GET /v1/decisions/${id} carried no recognisable outcome; nothing is reported.`, EXIT.refused);
  }
  // The record must be the one asked for, or its outcome is some other decision's.
  // …and it must be this tenant's record (review round 11 on PR #1321).
  if (d["tenantId"] !== tenant.id) {
    throw new CliError("malformed_answer", `GET /v1/decisions/${id} answered with a decision outside the confirmed tenant; nothing is reported.`, EXIT.refused);
  }
  if ((d["id"] ?? d["decisionId"]) !== id) {
    throw new CliError("malformed_answer", `GET /v1/decisions/${id} answered with a different decision; nothing is reported.`, EXIT.refused);
  }
  // A decision record that names no snapshot cannot have its evidence bound to it.
  const snapshotId = typeof d["evidenceSnapshotId"] === "string" && d["evidenceSnapshotId"] ? d["evidenceSnapshotId"] : "";
  const verified = snapshotId !== "" && boundVerdict(ev, id, snapshotId, tenant.id);
  // The step-up answer is a separate record beside the decision; it is what tells a host a
  // step_up may proceed, so it is shown in both modes — and only an answer for THIS
  // decision counts (review round 9 on PR #1321).
  const stepUpRaw = rec["stepUp"];
  let stepUpLine: string;
  if (stepUpRaw === null || stepUpRaw === undefined) {
    stepUpLine = d["outcome"] === "step_up" ? "UNANSWERED — a host must treat this step_up as unresolved" : "none";
  } else if (isCompleteStepUp(stepUpRaw, id, tenant.id, d["identityId"])) {
    const a = stepUpRaw as Record<string, unknown>;
    stepUpLine = `answered by ${str(a["method"])} at ${str(a["answeredAt"])} (credential ${str(a["credentialReference"])})`;
  } else {
    throw new CliError("malformed_answer", `GET /v1/decisions/${id} carried a step-up answer that is incomplete or not this decision's; nothing is reported.`, EXIT.refused);
  }
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
      `step-up     ${stepUpLine}`,
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
  const verified = boundVerdict(ev, id, null, tenant.id);
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

/**
 * The two verdict shapes /v1/audit returns: the in-memory core's `{ valid, brokenAtSeq,
 * length }` and the durable ledger's `{ ok, truncated, brokenAtIndex, count }`
 * (lib/audit verifyLedger). A durable `ok: true` that stopped at the verifier's read cap
 * (`truncated` not exactly false) is "the prefix read is intact" and nothing more, so it
 * is inconclusive, not valid. No verdict field, or two that disagree, is not valid either.
 */
function chainVerdict(chain: Record<string, unknown>, source: unknown): { valid: boolean; label: string; length: unknown } {
  const hasValid = typeof chain["valid"] === "boolean";
  const hasOk = typeof chain["ok"] === "boolean";
  const len = chain["length"] ?? chain["count"];
  if (hasValid && hasOk && chain["valid"] !== chain["ok"]) return { valid: false, label: "CONTRADICTORY (valid and ok disagree)", length: len };
  // The answer's `source` decides which schema it must carry — never the fields that happen
  // to be present: a durable verdict without `ok` (a compatibility `valid` alone) would
  // otherwise slip past the read-cap rule (review round 10 on PR #1321).
  if (source === "durable") {
    if (!hasOk) return { valid: false, label: "UNKNOWN (a durable answer without its `ok` verdict)", length: len };
    if (chain["ok"] !== true) return { valid: false, label: `BROKEN at index ${str(chain["brokenAtIndex"])}`, length: chain["count"] };
    if (chain["truncated"] !== false) return { valid: false, label: "INCONCLUSIVE (the server's verifier stopped at its read cap)", length: chain["count"] };
    return { valid: true, label: "valid", length: chain["count"] ?? chain["length"] };
  }
  if (source === "memory") {
    // The in-memory verifier keeps its anchor across eviction, so its `truncated` does not
    // weaken `valid` (lib/signalgrid-core audit.ts verifyAuditChain).
    if (!hasValid) return { valid: false, label: "UNKNOWN (an in-memory answer without its `valid` verdict)", length: len };
    return chain["valid"] === true
      ? { valid: true, label: "valid", length: chain["length"] }
      : { valid: false, label: `BROKEN at seq ${str(chain["brokenAtSeq"])}`, length: chain["length"] };
  }
  return { valid: false, label: `UNKNOWN (unrecognised ledger source ${str(source)})`, length: len };
}

/** One audit event as a table row, from either record shape (core AuditEvent or lib/audit AuditRecord). */
function auditRow(e: Record<string, unknown>): string[] {
  const ref = (v: unknown): string => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return str([o["type"], o["id"]].filter((x) => typeof x === "string").join(":") || "unknown");
    }
    return str(v);
  };
  return [str(e["seq"] ?? e["id"]), str(e["recordedAt"] ?? e["ts"]), str(e["type"] ?? e["eventType"]), ref(e["actor"]), ref(e["subject"] ?? e["target"])];
}

/** The durable route serves at most this many rows per request (artifacts/api-server/src/routes/v1.ts). */
const AUDIT_PAGE = 1000;
/** A read bound: past it the newest events cannot be located, and the CLI says so instead of guessing. */
const AUDIT_MAX_PAGES = 100;

async function audit(cfg: Config, limitRaw: string | undefined): Promise<Out> {
  let limit: number | undefined;
  if (limitRaw !== undefined) {
    limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) throw new CliError("usage", "--limit must be a positive integer.", EXIT.usage);
  }
  const tenant = await confirmTenant(cfg);
  // The durable backend pages OLDEST first, so the newest n are found by reading every
  // page and keeping the tail; --limit is never forwarded as the server's row limit. The
  // in-memory backend ignores the paging and answers the whole list once.
  let shown: Record<string, unknown>[] = [];
  let chain: Record<string, unknown> | undefined;
  let source: unknown;
  for (let page = 0; ; page++) {
    if (page === AUDIT_MAX_PAGES) {
      throw new CliError("too_large", `the tenant's ledger is longer than ${AUDIT_MAX_PAGES * AUDIT_PAGE} events; the newest cannot be located within the CLI's read bound, so nothing is reported.`, EXIT.refused);
    }
    const { body } = await call(cfg, "GET", `/v1/audit?limit=${AUDIT_PAGE}&offset=${page * AUDIT_PAGE}`);
    const events = body["events"];
    const pageChain = body["chain"];
    if (!Array.isArray(events) || !pageChain || typeof pageChain !== "object") {
      throw new CliError("malformed_answer", "GET /v1/audit carried no events list or chain verdict; nothing is reported.", EXIT.refused);
    }
    // One verdict covers one ledger: a later page answered by a different backend (a
    // memory instance behind the same URL) is not part of the chain the first page
    // described, so a source change refuses rather than merging the two (review round 7).
    if (page > 0 && body["source"] !== source) {
      throw new CliError("malformed_answer", "GET /v1/audit changed backend between pages; no single chain verdict covers the events, so nothing is reported.", EXIT.refused);
    }
    // The same source is not the same ledger: every page must carry the first page's chain
    // verdict exactly (scope, count, head hash), or two ledgers — or one that moved mid-read —
    // would be stitched under one verdict (review round 11 on PR #1321).
    if (page > 0 && JSON.stringify(pageChain) !== JSON.stringify(chain)) {
      throw new CliError("malformed_answer", "GET /v1/audit answered a later page from a different or changed ledger; no single chain verdict covers the events, so nothing is reported.", EXIT.refused);
    }
    // Every event must be this tenant's: a foreign record is never appended or shown.
    if ((events as unknown[]).some((e) => !e || typeof e !== "object" || (e as Record<string, unknown>)["tenantId"] !== tenant.id)) {
      throw new CliError("malformed_answer", "GET /v1/audit carried an event outside the confirmed tenant; nothing is reported.", EXIT.refused);
    }
    chain = pageChain as Record<string, unknown>;
    source = body["source"];
    shown = shown.concat(events as Record<string, unknown>[]);
    if (limit) shown = shown.slice(-limit);
    // Stop on the last page, on any non-durable answer, or on the first verdict that is not valid.
    if (source !== "durable" || events.length < AUDIT_PAGE || !chainVerdict(chain, source).valid) break;
  }
  const verdict = chainVerdict(chain, source);
  return {
    exit: verdict.valid ? EXIT.ok : EXIT.refused,
    json: { ok: verdict.valid, command: "audit", tenant: tenant.id, source: source ?? null, chain, events: shown },
    human: [
      `chain ${verdict.label} · length ${str(verdict.length)} · source ${str(source)} · showing ${shown.length}`,
      table(["event", "at", "type", "actor", "subject"], shown.map(auditRow)),
    ].join("\n"),
  };
}

async function connectors(getCfg: () => Config, args: string[], allowWrite: boolean, givenKey: string | undefined): Promise<Out> {
  const [sub, id] = args;
  if (sub === "sync") {
    const cid = safeId(need(id, "connectors sync <connectorId>"), "the connector id");
    const path = `/v1/connectors/${encodeURIComponent(cid)}/sync`;
    if (!allowWrite) return writeRefused("connectors sync", "POST", path, undefined);
    const cfg = getCfg();
    const key = idempotencyKey(givenKey);
    const tenant = await confirmTenant(cfg);
    const { body } = await call(cfg, "POST", path, undefined, key);
    const run = body["syncRun"] as Record<string, unknown> | undefined;
    // A well-formed id and a recognised status, or nothing is reported (review round 7): an
    // empty or newline-bearing id would otherwise pass as an answer and rewrite the output.
    // …and it must be a run OF the connector asked for, in the confirmed tenant (round 10).
    if (!run || !isSafeId(run["id"]) || typeof run["status"] !== "string" || !SYNC_STATUSES.has(run["status"]) ||
        run["connectorId"] !== cid || run["tenantId"] !== tenant.id) {
      const r = writeRecovery(key);
      throw new CliError("malformed_answer", `POST ${path} carried no sync run of ${cid} in this tenant with a well-formed id and a recognised status; nothing is reported.${r.suffix}`, EXIT.refused, r.extra);
    }
    return {
      json: { ok: true, command: "connectors sync", tenant: tenant.id, sent: true, syncRun: run },
      human: `sync run ${run["id"]} · status ${run["status"]} · ${str(run["note"]).replace(/[\r\n]+/g, " ")}`,
    };
  }
  if (sub === "runs") {
    const cid = safeId(need(id, "connectors runs <connectorId>"), "the connector id");
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

- \`SIGNALGRID_BASE_URL\` — the api-server prefix, e.g. \`http://127.0.0.1:<port>/api\`. Loopback only (localhost, 127.0.0.1, ::1): a remote or live deployment is refused before any request.
- \`SIGNALGRID_TENANT\` — the tenant id or slug you expect; the CLI refuses when the token belongs to another.
- \`SIGNALGRID_TOKEN\` — the bearer. Never pass it as a flag.
- \`SIGNALGRID_CLI_SESSION\` — optional absolute path OUTSIDE the repository; remembers the last decision id (never the token), written under an exclusive lock.

Run it from the repository root with \`pnpm --silent --filter @workspace/signalgrid-cli run start <command>\`.
\`--silent\` is what keeps pnpm's own banner off stdout, so \`--json\` output stays one JSON object.

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
- A write that exits ${EXIT.unreachable} may still have been recorded. Its error names an idempotency key (\`error.idempotencyKey\` under \`--json\`); re-running the same command with \`--idempotency-key <key>\` within 5 minutes replays the recorded answer only from the same server process, because the replay store is in-process memory. After a server restart, or against several instances, check \`signalgrid audit\` for the write before retrying — with a credential holding audit:read (owner, admin or auditor; operator and connector keys do not).
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
  "idempotency-key"?: string;
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

/**
 * Each command's exact positional grammar, checked before configuration is read or
 * anything is sent: a stray operand is a typo, and a typo must never ride along on a
 * write that mints a decision (review round 5 on PR #1321).
 */
/** Each command's own options; anything else given to it is refused (review round 8). */
const OPTIONS: Record<string, readonly string[]> = {
  decide: ["json", "help", "identity", "device", "workflow", "allow-write", "idempotency-key"],
  explain: ["json", "help"],
  signals: ["json", "help"],
  audit: ["json", "help", "limit"],
  connectors: ["json", "help"],
  skill: ["json", "help"],
};

/**
 * parseArgs knows every command's options at once, so an option that belongs to another
 * command would otherwise be accepted and ignored — riding along on a write it was never
 * part of. Checked before configuration is read or anything is sent.
 */
function checkOptions(command: string, rest: string[], v: Values): void {
  const allowed = new Set(OPTIONS[command]);
  // `--allow-write` and `--idempotency-key` belong to `connectors sync` alone.
  if (command === "connectors" && rest[0] === "sync") {
    allowed.add("allow-write");
    allowed.add("idempotency-key");
  }
  const stray = Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined && !allowed.has(k));
  if (stray.length > 0) {
    throw new CliError("usage", `option(s) not accepted by ${command}: ${stray.map((k) => `--${k}`).join(" ")}. Usage: ${COMMANDS[command]!.usage}; nothing was sent.`, EXIT.usage);
  }
}

function checkArity(command: string, rest: string[]): void {
  const ok =
    command === "explain" || command === "signals" ? rest.length <= 1
    : command === "connectors" ? rest.length === 0 || (rest.length === 2 && (rest[0] === "runs" || rest[0] === "sync"))
    : rest.length === 0;
  if (!ok) {
    throw new CliError("usage", `unexpected operand(s) for ${command}: ${rest.join(" ")}. Usage: ${COMMANDS[command]!.usage}; nothing was sent.`, EXIT.usage);
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exit: number }> {
  // `pnpm run start -- <command>` forwards the `--` itself, and parseArgs would read every
  // flag after it as a positional (silently dropping --json). No command begins with `--`,
  // so one leading `--` is only ever that separator.
  if (argv[0] === "--") argv = argv.slice(1);
  let json = argv.includes("--json");
  try {
    const { values, positionals, tokens } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        json: { type: "boolean" },
        "allow-write": { type: "boolean" },
        identity: { type: "string" },
        device: { type: "string" },
        workflow: { type: "string" },
        limit: { type: "string" },
        "idempotency-key": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const v = values as Values;
    json = v.json === true;
    // parseArgs keeps only the LAST of a repeated option, so `--identity a --identity b`
    // would silently become `b`. A repeated value-bearing option is ambiguous and refused
    // before anything is read or sent (review round 9 on PR #1321).
    const seenOpts = new Map<string, number>();
    for (const t of tokens ?? []) {
      if (t.kind === "option" && t.value !== undefined) seenOpts.set(t.name, (seenOpts.get(t.name) ?? 0) + 1);
    }
    const repeated = [...seenOpts].filter(([, n]) => n > 1).map(([name]) => `--${name}`);
    if (repeated.length > 0) {
      throw new CliError("usage", `option(s) given more than once: ${repeated.join(" ")}; which value was meant is ambiguous, so nothing was sent.`, EXIT.usage);
    }
    const [command, ...rest] = positionals;
    if (v.help || !command) {
      if (!v.help) throw new CliError("usage", `no command given. ${help()}`, EXIT.usage);
      // --json is honoured here too: every JSON-mode exit is one object (review round 7).
      if (json) {
        const commands = Object.entries(COMMANDS).map(([name, c]) => ({ name, usage: c.usage, summary: c.summary, writes: c.writes, requests: c.requests }));
        return { stdout: `${JSON.stringify({ ok: true, command: "help", commands, exit: EXIT }, null, 2)}\n`, stderr: "", exit: EXIT.ok };
      }
      return { stdout: `${help()}\n`, stderr: "", exit: EXIT.ok };
    }
    // An own-property check: `in` would accept inherited keys such as "constructor".
    if (!Object.hasOwn(COMMANDS, command)) throw new CliError("usage", `unknown command "${command}". Run signalgrid --help.`, EXIT.usage);
    checkArity(command, rest);
    checkOptions(command, rest, v);
    if (command === "skill") {
      const md = renderSkillMd();
      return { stdout: json ? `${JSON.stringify({ ok: true, command: "skill", skillMd: md }, null, 2)}\n` : md, stderr: "", exit: EXIT.ok };
    }
    const getCfg = () => readConfig(env);
    let out: Out;
    switch (command) {
      case "decide": out = await decide(getCfg, v, env); break;
      case "explain": { const cfg = getCfg(); out = await explain(cfg, decisionIdArg(rest[0], cfg, env)); break; }
      case "signals": { const cfg = getCfg(); out = await signals(cfg, decisionIdArg(rest[0], cfg, env)); break; }
      case "audit": out = await audit(getCfg(), v.limit); break;
      default: out = await connectors(getCfg, rest, v["allow-write"] === true, v["idempotency-key"]);
    }
    const exit = out.exit ?? EXIT.ok;
    return { stdout: `${json ? JSON.stringify(out.json, null, 2) : out.human}\n`, stderr: out.warning ? `signalgrid: warning: ${out.warning}\n` : "", exit };
  } catch (err) {
    // An argument-parser error is a usage error; anything else unexpected is still a
    // non-zero exit, but labelled as what it is rather than as the operator's mistake.
    const parseError = String((err as { code?: unknown }).code ?? "").startsWith("ERR_PARSE_ARGS");
    const e = err instanceof CliError
      ? err
      : parseError
        ? new CliError("usage", (err as Error).message, EXIT.usage)
        : new CliError("unexpected", `unexpected error (${(err as Error).name}); nothing is reported.`, EXIT.refused);
    return json
      ? { stdout: `${JSON.stringify({ ok: false, error: { code: e.code, message: e.message, exit: e.exit, ...e.extra } }, null, 2)}\n`, stderr: "", exit: e.exit }
      : { stdout: "", stderr: `signalgrid: ${e.message}\n`, exit: e.exit };
  }
}
