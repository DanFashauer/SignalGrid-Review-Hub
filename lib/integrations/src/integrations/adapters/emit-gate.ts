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
// identical policy in the shared `createEmitterResolver()` (adapters/emitter-resolver.ts), which each family's resolve.ts calls,
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
// of them to drift permissive. The policy is the repo's standard, and it is THREE
// conditions, not two: dev and alpha NEVER emit; beta and prod may, and only with
// SIGNALGRID_LIVE_INTEGRATIONS set to exactly "true", and only with the credential
// the caller names actually present. The third clause was documented in seven
// places and implemented in none of them until 2026-09-02 — see EmissionCredential.
// It was then implemented as an OPTIONAL parameter, which 36 of the 37 call sites
// omitted, so on the same day it became required: omission is a type error and
// "no secret at this boundary" has to be written down (NO_CREDENTIAL).
//
// Env is read at CALL TIME. A gate captured at module load cannot be varied per
// call, which makes it unprovable — the reason several of these families sat
// ungated and unproven for so long.

export type EmitResolution =
  | { mode: "live" }
  | { mode: "suppressed"; reason: string };

/**
 * The credential a caller holds for the system it is about to reach.
 *
 * WHY THIS PARAMETER EXISTS. Seven comments in this tree — and
 * `scripts/check-ungated-fetch.mjs`, and `docs/SECURITY_REVIEW_PACKAGE.md`, which
 * tells an external assessor this is the FIRST thing to verify — describe the
 * boundary as THREE conditions: beta/prod tier AND SIGNALGRID_LIVE_INTEGRATIONS
 * AND a credential is present. Only two of them were here. The third existed in
 * `createEmitterResolver()` (adapters/emitter-resolver.ts), which the four
 * resolveEmission-routed families' ADAPTER paths never call — so an ITSM adapter
 * built with `credentials.apiToken || ''` sent an empty Basic header to a real
 * vendor at beta/prod, inside a boundary the documentation said was closed.
 *
 * The gate cannot read the credential itself: it lives on a per-adapter config
 * object with a different shape per vendor. So the caller PASSES WHAT IT HOLDS,
 * and names it, and the refusal names it back.
 */
export interface EmissionCredential {
  /** How the refusal should name it, e.g. "Zendesk apiToken". */
  readonly name: string;
  /** The value the caller holds. Absent, empty or whitespace-only all read as absent. */
  readonly value: string | null | undefined;
}

/**
 * The explicit statement that THIS boundary holds no secret.
 *
 * `credential` used to be optional, and optional meant omittable: 36 of the 37 call
 * sites omitted it, so the third clause was skipped everywhere except the ITSM
 * factory. Reproduced on 2026-09-02 — `new ZendeskAdapter({instanceUrl, email: "",
 * apiToken: ""}).createTicket(...)` at prod + SIGNALGRID_LIVE_INTEGRATIONS=true
 * attempted a real POST carrying `Authorization: Basic L3Rva2VuOg==`, the base64 of
 * "/token:". A parameter whose omission silently drops a security clause is not a
 * clause; it is a suggestion.
 *
 * So `credential` is REQUIRED, and a family that genuinely holds no secret says so
 * OUT LOUD with this sentinel rather than by leaving an argument off. The syslog
 * collector is the real case: a host and a port, nothing to authenticate with. The
 * difference between "there is no credential here" and "I forgot" is now visible in
 * the source and enforced by the compiler.
 */
export const NO_CREDENTIAL: unique symbol = Symbol("signalgrid.emit-gate: this boundary holds no credential");
export type NoCredential = typeof NO_CREDENTIAL;

/** The refusal a caller gets when the credential it named is absent. Exported so
 *  proofs and callers compare against one string rather than a retyped copy. */
export function credentialAbsentReason(name: string): string {
  return `${name} is absent or empty — no live call is made without a credential`;
}

/**
 * Decide whether an outbound emitter may send.
 *
 * Fail-closed: every branch that cannot positively establish "beta/prod AND the
 * flag is exactly true AND the credential the caller named is present" returns
 * `suppressed` WITH a reason. A refusal that carried no reason would let a caller
 * read "nothing was sent" as "there was nothing to send".
 *
 * BOTH parameters are REQUIRED. `env` because a gate captured at module load cannot
 * be varied per call; `credential` because an optional one was omitted at 36 of 37
 * call sites and the clause it guards was therefore not enforced anywhere but the
 * ITSM factory. A boundary that holds no secret passes `NO_CREDENTIAL` and says so.
 * `scripts/check-ungated-fetch.mjs` asserts the second argument lexically as well, so
 * the rule survives a call from untyped code.
 */
export function resolveEmission(
  env: NodeJS.ProcessEnv,
  credential: EmissionCredential | NoCredential,
): EmitResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "suppressed", reason: `tier "${tier}" never emits to live systems` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "suppressed", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  if (credential !== NO_CREDENTIAL && !credential.value?.trim()) {
    return { mode: "suppressed", reason: credentialAbsentReason(credential.name) };
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
