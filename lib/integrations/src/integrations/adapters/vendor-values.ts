/**
 * Reading a vendor's JSON: a value is what it is, not what the cast said.
 *
 * WHY THIS MODULE EXISTS — measured on this tree, 2026-09-02. Five OAuth paths
 * (`itsm/servicenow.ts`, `itsm/bmc-helix.ts`, `itsm/ivanti.ts`, `siem/sentinel.ts`,
 * `telemetry/mde.ts`) read a token with
 *
 *     const data = await response.json() as { access_token: string };
 *
 * A TypeScript `as` is a compile-time assertion and checks NOTHING at run time, so
 * a 200 whose body is `{"ok":true}` produced `Bearer undefined` on the next
 * request, and `{"access_token":""}` produced a bare `Bearer ` — both INSIDE the
 * boundary `docs/SECURITY_REVIEW_PACKAGE.md` tells an assessor is closed. Nothing
 * failed; nothing logged; the adapter went on to POST a ticket.
 *
 * The `expires_in` twin is the same defect in a different type: `Date.now() +
 * (undefined * 1000)` is `NaN`, and `Date.now() < NaN` is false, so every single
 * request re-ran the whole OAuth dance against the vendor — a working credential
 * turned into an unbounded token-endpoint loop.
 *
 * THE RULE: a value that came off a vendor's wire passes through a checked reader
 * before it is stored or interpolated. The reader THROWS with the field named, so
 * the caller's existing refusal path reports which field the vendor did not send
 * instead of failing one hop later with an authentication error.
 *
 * Assertion 1 of `scripts/check-emitter-wire-discipline.mjs` holds the shape: in
 * `lib/integrations`, an assignment to a token-shaped field from a `.json()`-derived
 * value must pass through one of these readers (or a zod `.parse(`).
 */

/** A vendor sent a field this code cannot use. Typed so callers can name it back. */
export class VendorFieldInvalid extends Error {
  constructor(
    /** The field as the VENDOR spells it — `access_token`, not `accessToken`. */
    readonly field: string,
    /** What was wrong, without echoing the value (it may be a secret). */
    readonly detail: string,
  ) {
    super(`vendor response field ${field} is unusable: ${detail}`);
    this.name = 'VendorFieldInvalid';
  }
}

/** Describe a value's shape for an error message WITHOUT echoing it — it may be a secret. */
function shapeOf(value: unknown): string {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length === 0 ? 'an empty string' : `a ${value.length}-character string`;
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return `a ${typeof value}`;
}

/**
 * The value as a non-empty string, or a thrown {@link VendorFieldInvalid}.
 *
 * WHITESPACE IS EMPTY. `"   "` interpolates into `Bearer    ` and authenticates
 * nothing; treating it as present would keep the exact hole this closes.
 */
export function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new VendorFieldInvalid(field, `expected a string, received ${shapeOf(value)}`);
  }
  if (value.trim().length === 0) {
    throw new VendorFieldInvalid(field, 'expected a non-empty string, received only whitespace');
  }
  return value;
}

/**
 * The numeric twin, for `expires_in` and every other count a vendor sends.
 *
 * Finite and positive: a zero or negative lifetime mints an already-expired token,
 * and `NaN` mints a comparison that is false forever (see the header). Accepts the
 * decimal STRING form too — several OAuth servers send `"3600"` — because refusing
 * a correct value spelled the other way would be a gate punishing an honest vendor.
 */
export function asPositiveNumber(value: unknown, field: string): number {
  const n = typeof value === 'string' && value.trim().length > 0 ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new VendorFieldInvalid(field, `expected a finite number, received ${shapeOf(value)}`);
  }
  if (n <= 0) {
    throw new VendorFieldInvalid(field, `expected a positive number, received ${n}`);
  }
  return n;
}

/**
 * A vendor instant, as an ISO-8601 string, or a thrown {@link VendorFieldInvalid}.
 *
 * WHY. `new Date(data.result.sys_created_on).toISOString()` throws a bare
 * `RangeError: Invalid time value` when the vendor omits the field or sends
 * something unparseable — `new Date(undefined)` is an Invalid Date, and
 * `.toISOString()` on one throws. That FAILS CLOSED, which is right, but it fails
 * UNNAMED: the caller sees a RangeError from deep inside an adapter and learns
 * nothing about which vendor field was missing. Three sites did this
 * (`itsm/servicenow.ts` create and update, `itsm/manageengine.ts`).
 *
 * Accepts what `Date` accepts, including ServiceNow's `'2026-01-01 00:00:00'` space
 * form — narrowing that would be refusing a value the vendor legitimately sends.
 */
export function asVendorInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new VendorFieldInvalid(field, `expected an instant, received ${shapeOf(value)}`);
  }
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new VendorFieldInvalid(field, 'expected a parseable date/time, received an unparseable one');
  }
  return new Date(ms).toISOString();
}
