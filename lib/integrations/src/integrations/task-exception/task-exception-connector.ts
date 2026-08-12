// Read-only normalization + transport for the task-exception connector.
//
// The source is a task-execution bridge (an Oracle WMS Cloud / SAP EWM-class system, a
// retail task-management platform, or a clinical workflow engine speaking the FHIR
// Task lifecycle) that has already evaluated the task and its exceptions. This
// connector normalizes that evaluated result. Every operation here is a read; there is
// no write path — it assigns no task, confirms no pick, closes no exception, and
// adjusts no inventory.
//
// The hardened-normalizer pattern below is carried in from `device-management-health`
// and `link-usability` rather than rediscovered. It cost eight adversarial reviews to
// arrive at, and every clause is here for a failure that actually happened: own-only
// reads, a prototype-chain key scan that flags ANY inherited key, `null` as absence in
// the enum, boolean AND passthrough paths, `reportIntegrity` tracked apart from field
// values, and a bounded, try/catch-wrapped walk.

import {
  TASK_EXCEPTION_REPORT_KEYS,
  TaskExceptionConnectorError,
  type NormalizedTaskException,
  type NormalizedTaskState,
  type ReportIntegrity,
  type TaskExceptionKind,
  type TaskExceptionReportRaw,
  type TaskExceptionState,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new TaskExceptionConnectorError(
      "read_only_violation",
      `task exception is read-only; refused ${method}`,
    );
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** The audit passthrough: a string is carried VERBATIM — no trim, no case fold —
 *  because canonicalizing an audit value would falsify the trail it exists to serve.
 *  Anything else is null (not reported). Whether a non-string was an unreadable
 *  ASSERTION is `codeMalformed`'s question, not this one's. */
function stringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Did the report ASSERT something here that we could not parse?
 *
 *  `oneOf`, `boolOrNull` and `stringOrNull` are lossy by design — they collapse
 *  "absent" and "unreadable" into one sentinel. That is right for choosing a value and
 *  wrong for deciding whether the report was UNDERSTOOD. Presence, not parsed value,
 *  is what makes something an assertion. `null` counts as ABSENT in all three,
 *  matching the sibling connectors: it is the standard wire spelling of "no value",
 *  and a bridge emitting a fixed row shape with nulls rather than omitting keys is
 *  being honest, not unreadable. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** The passthrough is NEVER judged, but it must still be READABLE: any string passes
 *  (there is no allowlist to fail — vendor codes are the vendor's), and any non-string,
 *  non-null value is an assertion we could not read. */
function codeMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "string";
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value
 *  is the prototype's claim, not this report's, so it must not read as a confirmation,
 *  and a polluted `Object.prototype` is invisible here. This governs READS only — the
 *  unrecognized-key scan below still walks the chain, because an inherited key is an
 *  assertion even though its value is not read. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all?
 *
 *  `report !== Object.prototype` is the non-obvious clause and it closes a real hole
 *  found by review in a sibling connector: the key scan's stop condition is
 *  `o !== Object.prototype`, evaluated before the first iteration, so a report that IS
 *  `Object.prototype` was never scanned and a polluted prototype normalized to clean
 *  and granted. "Have we reached the chain terminus" is not the same question as "is
 *  this the report". `!Array.isArray` is belt-and-braces — an array already fails the
 *  scan on its own `length` — and is labelled redundant so nobody mistakes it for
 *  load-bearing. */
function isPlainReport(report: unknown): report is object {
  return (
    // Redundant, established by mutation testing in the siblings: a primitive or a
    // function reaching the key scan makes `Reflect.ownKeys` throw or return
    // unrecognized keys, so it ends at `malformed` either way. Kept as a plain
    // statement of the transport contract.
    typeof report === "object" &&
    // Redundant: `hasOwnProperty.call(null, …)` throws, which the wrapped read below
    // catches into `readFailed`, which forces malformed anyway. Kept for legibility.
    report !== null &&
    !Array.isArray(report) &&
    report !== Object.prototype
  );
}

/** Depth bound for the prototype scan. A Proxy may return a fresh object from
 *  `getPrototypeOf` on every call, so the walk must be bounded rather than trusting it
 *  to terminate. Exceeding the bound means we could not establish what the report
 *  carries — a failure to understand it, so it fails closed. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand?
 *
 *  Walks the PROTOTYPE CHAIN even though every VALUE read is own-only. The asymmetry
 *  is deliberate and was learned by breaking it: reading own-only is right, because an
 *  inherited value is the prototype's claim; but *scanning* own-only is wrong, because
 *  an inherited `exception_kind` is still an assertion in a spelling we ignore, and
 *  this scan is the only thing that notices. Beyond the report's own level ANY key
 *  counts, including one we recognize — a correctly-spelled inherited key is a
 *  STRONGER assertion than a misspelled one, and since values are read own-only it
 *  would otherwise be asserted by the report and read by nobody. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        // Redundant by construction — `known` holds only strings, so the `includes`
        // below already rejects every symbol. Kept as an explicit statement of intent.
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    // A hostile Proxy can throw from `ownKeys` or `getPrototypeOf`. We learned nothing.
    return true;
  }
}

const EXCEPTION_KIND = [
  "none",
  "verification_failed",
  "procedure_bypassed",
  "assignment_mismatch",
  "inventory_exception",
  "task_flow_stalled",
  "transaction_error",
  "unknown",
] as const;
const EXCEPTION_STATE = [
  "not_applicable",
  "active",
  "acknowledged",
  "resolution_task_created",
  "resolved",
  "unknown",
] as const;
const TASK_STATE = ["ready", "held", "in_process", "completed", "cancelled", "unknown"] as const;

/** Normalize a task-exception report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown/null, never a fabricated "none"/"not_applicable". */
export function normalizeReport(
  deviceId: string,
  report: TaskExceptionReportRaw,
  source = "task-exception-bridge",
): NormalizedTaskException {
  // Reads are OWN-ONLY and wrapped: a property can be an ACCESSOR that throws, and an
  // unguarded read would escape as a bare `Error` rather than landing where every
  // other unreadable shape lands.
  const plain = isPlainReport(report);
  let readFailed = false;
  const read = (key: string): unknown => {
    // Redundant: `!plain` already forces `malformed` below, so short-circuiting here
    // changes no verdict. Kept so a non-object never reaches `hasOwnProperty`.
    if (!plain) return undefined;
    try {
      return ownValue(report, key);
    } catch {
      readFailed = true;
      return undefined;
    }
  };
  const raw = {
    exceptionKind: read("exceptionKind"),
    exceptionState: read("exceptionState"),
    taskState: read("taskState"),
    taskSystemReachable: read("taskSystemReachable"),
    sourceExceptionCode: read("sourceExceptionCode"),
  };

  const exceptionKind = oneOf<TaskExceptionKind>(raw.exceptionKind, EXCEPTION_KIND, "unknown");
  const exceptionState = oneOf<TaskExceptionState>(raw.exceptionState, EXCEPTION_STATE, "unknown");
  const taskState = oneOf<NormalizedTaskState>(raw.taskState, TASK_STATE, "unknown");

  const malformed =
    !plain ||
    readFailed ||
    hasUnrecognizedKey(report, TASK_EXCEPTION_REPORT_KEYS) ||
    enumMalformed(raw.exceptionKind, EXCEPTION_KIND) ||
    enumMalformed(raw.exceptionState, EXCEPTION_STATE) ||
    enumMalformed(raw.taskState, TASK_STATE) ||
    boolMalformed(raw.taskSystemReachable) ||
    codeMalformed(raw.sourceExceptionCode);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  // The normalizer resolves no contradiction between the kind, state and task-phase
  // fields by rewriting any of them — it reports all three and lets the EVALUATOR
  // raise the disagreement with its own reason code. Rewriting here would erase the
  // fields an operator needs in order to know which side of the bridge mapping to fix,
  // and a sibling connector has a documented case where exactly that made its
  // motivating diagnosis unreachable at the wire layer.
  return {
    sourceSystem: "task-exception",
    deviceId,
    exceptionKind,
    exceptionState,
    taskState,
    taskSystemReachable: boolOrNull(raw.taskSystemReachable),
    sourceExceptionCode: stringOrNull(raw.sourceExceptionCode),
    reportIntegrity,
    source,
  };
}

export interface TaskExceptionRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's evaluated task-exception state from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type TaskExceptionTransport = (req: TaskExceptionRequest) => Promise<TaskExceptionReportRaw>;

export interface TaskExceptionConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class TaskExceptionConnector {
  constructor(
    private readonly config: TaskExceptionConnectorConfig,
    private readonly transport: TaskExceptionTransport,
  ) {}

  /**
   * NOTE ON `status: null`. The success path returns null, NOT 200.
   *
   * This connector is handed an INJECTED transport that resolves a payload — there is
   * no HTTP response here and therefore no status code to read. The old `status: 200`
   * was invented: a 201, 202 or 204 upstream reported as 200, and a reviewer reading
   * the field believed a server had said it. `null` is the honest value — "the
   * transport resolved; no status was observed" — and the type can now say it.
   *
   * The failure path keeps a real number because the error carries one.
   *
   * NOT FIXED HERE, and stated so the remaining gap is not mistaken for closed:
   * `healthy: true` still means "the injected transport resolved", which in fixture
   * mode is true without anything being contacted. That fix belongs at the resolution
   * layer, which already reports `mode: "fixture"` with a reason — see the backlog.
   */
  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number | null }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: null };
    } catch (err) {
      const status = err instanceof TaskExceptionConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchTaskException(deviceId: string): Promise<NormalizedTaskException> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
