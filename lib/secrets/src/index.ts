// @workspace/secrets — the ONE place a served secret is read from the environment.
//
// WHY THIS EXISTS. docs/SECRET_MODEL.md (DR-010) writes down the rules that must
// exist before the first stored secret: naming, service identities, what an agent may
// never hold, leases over lifetimes, and "the store is not the backup of itself". It
// then says, honestly, that none of it is implemented — no manager exists, nothing has
// been migrated, and ROTATION HAS NEVER BEEN EXECUTED. That last one is the gap with
// teeth: rule 4's own acceptance test is "the old credential stops working and nothing
// else does", and a codebase where every consumer reads `process.env.X` directly has
// no place to put that behaviour. There is no rotation WINDOW: at the instant the
// operator changes the variable, every caller holding the old value is refused.
//
// So this module does the smallest thing that makes rotation real:
//
//   1. ONE READ SITE. Every secret the api-server reads is named in REGISTRY below
//      and reached through this module. `scripts/src/secrets-proof.ts` fails if any
//      file under artifacts/api-server/src reads a registered name off process.env
//      directly — so "one place" is checked, not asserted.
//   2. A SUCCESSOR. `NAME_NEXT` is the next value, live ALONGSIDE the current one for
//      exactly as long as both are set. Rotation becomes: publish NAME_NEXT, let the
//      callers move, promote it to NAME, delete NAME_NEXT. Each step is a
//      configuration change with no window in which a valid caller is refused.
//   3. NO VALUE IS EVER LOGGABLE. `secretStatus` returns a truncated SHA-256
//      fingerprint and never the material. The registry is what may be printed; the
//      values are not, and there is no accessor that returns them all.
//
// WHAT IT IS NOT. It is not a secret manager, it does not fetch, lease, renew or
// store anything, and it holds no unseal material. It is an env reader with one door.
// The OpenBao migration in SECRET_MODEL.md is unchanged and unstarted; what this
// removes is the reason it could not start — the absence of a seam.

import { createHash, timingSafeEqual } from "node:crypto";

/** How a secret is used, which decides what "rotation" can mean for it. */
export type SecretDirection =
  /** Presented BY a caller and compared here. Both the current value and its
   *  successor are accepted while both are set, so rotation has a window. */
  | "inbound"
  /** Presented BY US to somebody else. A single outbound call carries exactly one
   *  credential, so there is no dual-valued state to be in: the successor is read,
   *  reported, and DELIBERATELY not used. Staging it is the operator's business;
   *  choosing between two live vendor credentials is not this module's. */
  | "outbound";

export interface SecretSpec {
  name: string;
  direction: SecretDirection;
  /** One line, printable. Never contains a value. */
  purpose: string;
}

/**
 * Every secret the SERVED api-server resolves through this module.
 *
 * Deliberately not "every credential-shaped name in the repository": SECRET_MODEL.md
 * counts roughly 75 of those across connectors and harnesses, nearly all fixture or
 * lab tokens, and hauling them behind a seam they do not use would be ceremony. This
 * is the set the running server reads, which is the set a rotation has to survive.
 */
export const REGISTRY: readonly SecretSpec[] = [
  { name: "METRICS_TOKEN", direction: "inbound", purpose: "Bearer required on /metrics when set." },
  {
    name: "SIGNALGRID_ENROLLMENT_SECRET",
    direction: "inbound",
    purpose: "Out-of-band authorization for step-up credential enrollment.",
  },
  {
    name: "SIGNALGRID_ESTATE_OWNER_TOKEN",
    direction: "inbound",
    purpose: "The estate deployment's owner bearer.",
  },
  {
    name: "SIGNALGRID_ESTATE_OPERATOR_TOKEN",
    direction: "inbound",
    purpose: "The estate deployment's operator bearer (optional).",
  },
  {
    name: "GRAPH_ACCESS_TOKEN",
    direction: "outbound",
    purpose: "Read-only Microsoft Graph token the estate posture read presents.",
  },
];

const BY_NAME = new Map(REGISTRY.map((s) => [s.name, s]));

/** The successor variable's name. One convention, in one place. */
export function successorName(name: string): string {
  return `${name}_NEXT`;
}

function requireRegistered(name: string): SecretSpec {
  const spec = BY_NAME.get(name);
  if (!spec) {
    // A secret nobody declared is a secret nobody reviewed. Refusing here is what
    // keeps the registry honest: adding a read means adding a row.
    throw new Error(
      `secrets: "${name}" is not in the registry (lib/secrets/src/index.ts). ` +
        "Declare it there — an undeclared secret is one no rotation plan covers.",
    );
  }
  return spec;
}

/**
 * Read one value. BLANK IS UNCONFIGURED, and that is the load-bearing half: a
 * variable set to "" or "   " is an operator who believes the control is on while it
 * is off, and this repository has already shipped that defect once (METRICS_TOKEN,
 * 2026-09-06, where a blank token served /metrics open). Callers that must refuse a
 * blank-but-SET value do so on `presentButBlank` below, which distinguishes the two.
 */
function rawValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export interface SecretReading {
  name: string;
  direction: SecretDirection;
  /** The current value, or undefined when unset or blank. */
  value: string | undefined;
  /** The staged successor, or undefined. Only meaningful while rotating. */
  next: string | undefined;
  /** Both a current and a successor are live: the rotation window is open. */
  rotating: boolean;
  /** The variable (or its successor) was SET but blank — a configuration error the
   *  caller may want to refuse at boot rather than treat as unset. */
  presentButBlank: boolean;
}

/** The whole state of one secret. The only function that returns material. */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): SecretReading {
  const spec = requireRegistered(name);
  const nextVar = successorName(name);
  const value = rawValue(env, name);
  const next = rawValue(env, nextVar);
  const blank = (v: string | undefined, key: string): boolean => env[key] !== undefined && v === undefined;
  return {
    name,
    direction: spec.direction,
    value,
    next,
    rotating: value !== undefined && next !== undefined,
    presentButBlank: blank(value, name) || blank(next, nextVar),
  };
}

/**
 * The value to PRESENT to somebody else. Outbound only, and it is the CURRENT value
 * even mid-rotation: one call carries one credential, and silently preferring the
 * successor would make "which key did that request use" unanswerable at the exact
 * moment somebody needs to know. Promoting the successor is an operator action.
 */
export function outboundSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const spec = requireRegistered(name);
  if (spec.direction !== "outbound") {
    throw new Error(`secrets: "${name}" is an inbound secret; compare it with secretMatches, never read it out.`);
  }
  return readSecret(name, env).value;
}

/** Equal-length-safe constant-time compare. Digests, so `timingSafeEqual` always gets
 *  two 32-byte buffers and the comparison neither throws nor leaks a length. */
function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a, "utf8").digest(), createHash("sha256").update(b, "utf8").digest());
}

/**
 * Does the presented credential match this secret — current OR staged successor?
 *
 * FAIL CLOSED, in three directions that each cost nothing to state and everything to
 * get wrong:
 *   · an UNCONFIGURED secret matches nothing, including the empty string. A caller
 *     that wants "unset means open" must ask `readSecret(...).value === undefined`
 *     and say so out loud; it can never fall out of a comparison returning true.
 *   · an EMPTY presented credential never matches, even against a configured secret
 *     that somehow held one — it cannot, because blank reads as unconfigured.
 *   · the successor is accepted only while it is SET. Deleting it closes the window
 *     immediately, which is rule 4's acceptance test: the old credential stops
 *     working and nothing else does.
 */
export function secretMatches(name: string, presented: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const spec = requireRegistered(name);
  if (spec.direction !== "inbound") {
    throw new Error(`secrets: "${name}" is an outbound secret; it is presented, never compared.`);
  }
  if (presented === "") return false;
  const reading = readSecret(name, env);
  const candidates = [reading.value, reading.next].filter((v): v is string => v !== undefined);
  if (candidates.length === 0) return false;
  // Every candidate is compared — no early return — so the answer's timing does not
  // depend on WHICH of the two matched, which would leak how far into a rotation the
  // deployment is.
  let matched = false;
  for (const candidate of candidates) {
    if (constantTimeEquals(candidate, presented)) matched = true;
  }
  return matched;
}

export interface SecretStatus {
  name: string;
  direction: SecretDirection;
  configured: boolean;
  rotating: boolean;
  presentButBlank: boolean;
  /** First 8 hex characters of SHA-256(value), or null. Enough to tell two values
   *  apart in a log or a status page; not enough to be one. */
  fingerprint: string | null;
  nextFingerprint: string | null;
}

/** Fingerprint of a value, or null. The ONLY representation of a secret that may be
 *  logged, printed, or served. */
export function fingerprint(value: string | undefined): string | null {
  if (value === undefined) return null;
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

/** Everything about a secret that is safe to print. Carries no material. */
export function secretStatus(name: string, env: NodeJS.ProcessEnv = process.env): SecretStatus {
  const reading = readSecret(name, env);
  return {
    name: reading.name,
    direction: reading.direction,
    configured: reading.value !== undefined,
    rotating: reading.rotating,
    presentButBlank: reading.presentButBlank,
    fingerprint: fingerprint(reading.value),
    nextFingerprint: fingerprint(reading.next),
  };
}

/** Every registered secret's printable status. Used for a boot line; never a dump. */
export function secretInventory(env: NodeJS.ProcessEnv = process.env): SecretStatus[] {
  return REGISTRY.map((spec) => secretStatus(spec.name, env));
}
