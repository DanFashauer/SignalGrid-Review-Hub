// Shared controls for the live-call gate — the thing that decides whether a real
// vendor call happens at all.
//
// WHY THIS EXISTS.
//
// Every gated connector answers the same question in the same shape: tier must be
// beta/prod, `SIGNALGRID_LIVE_INTEGRATIONS` must be "true", and a family-specific
// credential must be present. Twenty families implement it identically. Every one of
// them tested it as a CUMULATIVE LADDER:
//
//   resolve({ tier: "dev" })                          → fixture
//   resolve({ tier: "prod" })                         → fixture
//   resolve({ tier: "prod", live: "true" })           → fixture
//   resolve({ tier: "prod", live: "true", token })    → live
//
// which reads like coverage and is not. Each rung adds one variable, so at every step
// the conditions BELOW the one under test are also failing. Delete the tier check and
// the first case still returns fixture — because the flag is absent too. Delete the
// flag check and the second case still returns fixture — because the token is absent
// too. Only the last condition in the chain is genuinely exercised.
//
// The mutation guard proved it rather than argued it. Registering the gate files and
// sweeping returned, on family after family, the same two survivors:
//
//   if (tier !== "beta" && tier !== "prod")            → if (false)   SURVIVED
//   if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true")   → if (false)   SURVIVED
//
// The first of those is the control behind a claim this codebase makes in writing —
// that dev and alpha never make live vendor calls. It could be deleted outright with
// every proof green.
//
// THE FIX IS THE SHAPE, NOT THE COUNT. Start from an env where EVERY gate is satisfied,
// then knock out exactly one variable and require a refusal. That way the condition
// under test is the only thing standing between the caller and a live connector, so
// deleting it is immediately visible. It is the same law the connector proofs already
// apply to malformed-record guards — a guard over N conditions needs N controls, each
// isolating one — moved to the place that decides whether we touch a customer's
// network at all.

export interface GateProbe<T> {
  /** The proof's own `check`, so failures land in its summary and its exit code. */
  readonly check: (name: string, ok: boolean) => void;
  /** The family's `resolveXConnector`, curried with its transport override if any. */
  readonly resolve: (env: NodeJS.ProcessEnv) => { mode: string } | T;
  /** An env in which EVERY gate passes. The knock-outs below are taken from this. */
  readonly full: NodeJS.ProcessEnv;
  /** Family name, used only in the check labels. */
  readonly family: string;
}

const modeOf = (r: { mode: string } | unknown): string =>
  typeof r === "object" && r !== null && "mode" in r ? String((r as { mode: string }).mode) : "?";

/**
 * Assert that EACH live-call gate refuses ON ITS OWN.
 *
 * For every key in `full`, resolve with that key alone removed and require `fixture`.
 * Then resolve with the whole of `full` and require `live` — without which every
 * assertion above would hold for a resolver that simply never goes live, which is the
 * vacuity this helper exists to foreclose.
 */
export function checkLiveGateIsolated<T>(probe: GateProbe<T>): void {
  const { check, resolve, full, family } = probe;
  const keys = Object.keys(full);

  check(
    `${family}: NON-VACUITY — with every gate satisfied the resolver DOES go live`,
    modeOf(resolve(full)) === "live",
  );

  for (const key of keys) {
    const knocked: NodeJS.ProcessEnv = { ...full };
    delete knocked[key];
    check(
      `${family}: ISOLATED — \`${key}\` alone blocks the live call, every other gate satisfied`,
      modeOf(resolve(knocked)) === "fixture",
    );
  }

  // Empty env is the deployed default, and it must refuse for the obvious reason
  // rather than by accident. Kept alongside the isolated cases, not instead of them.
  check(
    `${family}: the default env (no tier, no flag, no credential) refuses`,
    modeOf(resolve({})) === "fixture",
  );
}

/**
 * Assert that the default fetch transport rejects what it should reject.
 *
 * The connector proofs inject a transport, which is right — they are testing decision
 * logic, not HTTP. The consequence is that `makeDefaultXTransport` is never executed
 * by anything, and its two guards (`!res.ok`, and the body-shape check) survived every
 * sweep. Without the first, a vendor's 500 error page is parsed as a report. Without
 * the second, an array or a bare string becomes a "record" and flows into a normalizer
 * that expects an object.
 *
 * Stubbing `globalThis.fetch` is enough to reach both, and costs no network.
 */
export interface TransportProbe {
  readonly check: (name: string, ok: boolean) => void;
  readonly family: string;
  /** `makeDefaultXTransport(baseUrl)` — already bound to a throwaway URL. */
  readonly transport: (arg: never) => Promise<unknown>;
  /** Whatever argument shape this family's transport takes. */
  readonly arg: unknown;
  /** Reads the `code` off the family's thrown connector error. */
  readonly codeOf: (err: unknown) => string | undefined;
}

type FetchLike = typeof globalThis.fetch;

async function withFetch<R>(stub: FetchLike, body: () => Promise<R>): Promise<R> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

const responseOf = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

export async function checkDefaultTransport(probe: TransportProbe): Promise<void> {
  const { check, family, transport, arg, codeOf } = probe;
  const call = () => transport(arg as never);

  const caught = async (stub: FetchLike): Promise<string | undefined> =>
    withFetch(stub, async () => {
      try {
        await call();
        return undefined;
      } catch (err) {
        return codeOf(err);
      }
    });

  // 401/403 is a DIFFERENT failure from a 500: one is our credential, one is their
  // service, and they go to different owners. The transport separates them and the
  // separation is worth pinning.
  check(
    `${family}: transport — a 401 raises \`auth_failed\`, not a generic upstream error`,
    (await caught(async () => responseOf(401, "{}"))) === "auth_failed",
  );
  check(
    `${family}: transport — a 403 raises \`auth_failed\` too`,
    (await caught(async () => responseOf(403, "{}"))) === "auth_failed",
  );
  check(
    `${family}: transport — a 500 raises \`upstream_error\`, and its body is NEVER read as a report`,
    (await caught(async () => responseOf(500, '{"posture":"clean"}'))) === "upstream_error",
  );
  check(
    `${family}: transport — a non-JSON 200 raises \`bad_response\``,
    (await caught(async () => responseOf(200, "<html>maintenance</html>"))) === "bad_response",
  );
  check(
    `${family}: transport — a JSON ARRAY is not a record, and is refused`,
    (await caught(async () => responseOf(200, "[]"))) === "bad_response",
  );
  check(
    `${family}: transport — a bare JSON string is not a record either`,
    (await caught(async () => responseOf(200, '"ok"'))) === "bad_response",
  );
  check(
    `${family}: transport — NULL is not a record, though \`typeof null\` says object`,
    (await caught(async () => responseOf(200, "null"))) === "bad_response",
  );
  // Non-vacuity: everything above would also hold for a transport that threw
  // unconditionally.
  const ok = await withFetch(
    async () => responseOf(200, '{"ok":true}'),
    async () => {
      try {
        return await call();
      } catch {
        return null;
      }
    },
  );
  check(
    `${family}: NON-VACUITY — a well-formed 200 object IS returned, so the refusals above are refusals`,
    typeof ok === "object" && ok !== null && (ok as Record<string, unknown>)["ok"] === true,
  );
}

/** A paging connector's two REFUSALS, which every family in this fabric implements
 *  identically and which — measured 2026-08-25 — nine of them had no test for.
 *
 *  Both branches are places where a READ FAILURE would otherwise read as a CLEAN
 *  DEVICE, and for a posture fabric that is the worst available direction to be
 *  wrong in. A device missing from a truncated inventory looks like a device with
 *  no findings; a collection whose `value` is not an array spreads to nothing and
 *  looks like a device with no findings. Neither is a device with no findings.
 *
 *  THIS IS A HELPER RATHER THAN NINE COPIES ON PURPOSE. The rule is one rule, so it
 *  gets one statement; nine hand-written copies are nine things to drift, and this
 *  repository fixed a bug earlier the same day whose whole cause was a guard kept in
 *  two places. Pass an adapter naming your family's connector and list method.
 */
export async function checkCollectionRefusals(probe: {
  check: (name: string, ok: boolean) => void;
  family: string;
  /** Build the family's connector over the supplied transport and page limit, and
   *  return a thunk that performs its paging list call. */
  listWith: (transport: FetchLikeTransport, pageLimit: number) => () => Promise<unknown[]>;
  codeOf: (err: unknown) => string | undefined;
}): Promise<void> {
  const { check, family, listWith, codeOf } = probe;
  const respond = (body: unknown, status = 200) =>
    Promise.resolve({ status, ok: status < 400, json: async () => body });

  const codeFrom = async (run: () => Promise<unknown[]>): Promise<string | undefined> => {
    try {
      await run();
      return undefined;
    } catch (err) {
      return codeOf(err);
    }
  };

  check(
    `${family}: a collection whose \`value\` is not an array is refused, never read as zero results`,
    (await codeFrom(listWith(() => respond({ value: { not: "an array" } }), 50))) === "bad_response",
  );
  check(
    `${family}: hitting the page cap with a cursor still in hand refuses, never returns a partial inventory`,
    (await codeFrom(listWith(() => respond({ value: [], nextPageToken: "always-more" }), 2))) === "incomplete_read",
  );
  // NON-VACUITY. Without this, a connector that refused every input would satisfy
  // both assertions above and look maximally safe.
  let clean = false;
  try {
    clean = (await listWith(() => respond({ value: [] }), 2)()).length === 0;
  } catch {
    clean = false;
  }
  check(`${family}: ...and a well-formed terminating collection still reads clean, so those are refusals`, clean);
}

/** The transport shape every paging connector in this fabric accepts. */
export type FetchLikeTransport = (req: never) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;
