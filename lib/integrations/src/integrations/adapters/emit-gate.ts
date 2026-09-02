// The shared live-emission gate for OUTBOUND connector families.
//
// An emitter sends data OUT to a customer system. Unlike a device actuator —
// "quarantine this endpoint", deleted from nac/ and uem/ because it has no
// read-only form — an emitter has an obviously correct disciplined behaviour:
// send nothing. So emitters are GATED, not deleted.
//
// SCOPE — this resolver is shared by the FOUR families whose adapter modules
// call it in-line before an outbound request: siem/, syslog/, telemetry/ and
// itsm/. It is NOT every outbound family: the repository has six emitter
// families in all, and the other two — webhooks/ and caep-events/ — carry the
// identical policy in their own `resolve*Emitter()` (each family's resolve.ts),
// because they additionally require an INJECTED transport this repository does
// not ship. Six resolve.ts files, four callers of this one.
//
// WHAT ENFORCES THAT, precisely — an earlier version of this paragraph said
// `proof:emit-gate` "derives that same set and asserts each one routes through
// here", and that was false: the proof held a hand-written list of six
// representative modules, so nine of the fifteen importers were unwatched by it
// and the gate could be stripped from itsm/zendesk.ts with the proof still
// reporting green. Two things watch this now, and they are different shapes:
//
//   · `proof:emit-gate` — pins those six modules BY NAME (their gate must sit
//     before the first outbound call, which a directory sweep cannot see), and
//     separately SWEEPS all four family directories, asserting that every module
//     naming a vendor host or calling fetch imports this file.
//   · `scripts/check-ungated-fetch.mjs` — the derived net over the whole
//     connector tree, per function rather than per file.
//
// Neither subsumes the other; the sweep is scoped to these four families, the
// net is scoped to fetch call sites.
//
// One resolver, shared, because four copies of a policy is four chances for one
// of them to drift permissive. The policy is the repo's standard: dev and alpha
// NEVER emit; beta and prod may, and only with SIGNALGRID_LIVE_INTEGRATIONS set
// to exactly "true".
//
// Env is read at CALL TIME. A gate captured at module load cannot be varied per
// call, which makes it unprovable — the reason several of these families sat
// ungated and unproven for so long.

export type EmitResolution =
  | { mode: "live" }
  | { mode: "suppressed"; reason: string };

/**
 * Decide whether an outbound emitter may send.
 *
 * Fail-closed: every branch that cannot positively establish "beta/prod AND the
 * flag is exactly true" returns `suppressed` WITH a reason. A refusal that
 * carried no reason would let a caller read "nothing was sent" as "there was
 * nothing to send".
 */
export function resolveEmission(
  env: NodeJS.ProcessEnv = process.env,
): EmitResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "suppressed", reason: `tier "${tier}" never emits to live systems` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "suppressed", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  return { mode: "live" };
}

/**
 * The status an emitter must report when the gate withheld the send.
 *
 * Deliberately NOT "sent" and NOT "failed". "sent" would be a lie — the most
 * damaging kind here, because a compliance reader treats a forwarded audit event
 * as delivered. "failed" would be a different lie, implying something broke and
 * inviting an operator to chase it. The honest third state says what happened.
 */
export const EMIT_SUPPRESSED = "suppressed" as const;
