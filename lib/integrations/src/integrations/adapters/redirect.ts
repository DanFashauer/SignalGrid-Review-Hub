/**
 * Outbound redirects are REFUSED, never followed.
 *
 * WHY THIS MODULE EXISTS — measured, not reasoned. Every `fetch` in the six
 * emitter families inherited undici's default `redirect: "follow"`, and
 * `validateWebhookUrl` guarded only the FIRST hop. A 307 from a configured
 * collector therefore delivered the full signed body to whatever origin the
 * `Location` header named, with no validation of that origin at all:
 *
 *   · `X-Webhook-Signature` / `X-Signature` SURVIVE a cross-origin redirect in
 *     undici (only `Authorization`, `Cookie` and `Proxy-Authorization` are
 *     stripped), so the receiver at the second hop gets a correctly-signed
 *     audit event it was never meant to see.
 *   · the adapter reported `sent`, because the final response was a 200.
 *   · the final hop's body is READ and up to 1000 bytes are persisted to the
 *     tenant-visible delivery log, so the residue is not "blind" either.
 *
 * No emitter in this repository has a legitimate reason to follow a redirect: an
 * ITSM ticket write and a SIEM event POST both go to an endpoint the operator
 * configured, and an operator whose vendor moved should change the configuration
 * rather than have SignalGrid chase a `Location` header at run time.
 *
 * PERMANENT, not transient. A redirect is a property of the configured target,
 * not of this attempt: retrying re-fetches the same 3xx from the same host. The
 * refusal is therefore counted `failed` and the retry loop stops. Both halves are
 * derived from {@link REDIRECT_REFUSED} rather than retyped, because a retyped
 * copy of a refusal string is exactly what went stale in
 * `webhooks/dispatch.ts` once already.
 */

/**
 * The prefix every redirect refusal in this repository starts with.
 *
 * `isPermanentDeliveryError` and each family's retry loop test for THIS constant,
 * so the classifier and the site that mints the reason cannot drift apart.
 */
export const REDIRECT_REFUSED = 'REDIRECT_REFUSED';

/**
 * The `redirect` mode every outbound fetch in an emitter family must set.
 *
 * Exported as a value (rather than each site writing the literal) so the gate has
 * something to point at and a reader has one place to learn the rule. The literal
 * is still written at each call site — `redirect: 'manual'` — because
 * `scripts/check-ungated-fetch.mjs` asserts the OPTION is present in the call's
 * own argument list, the same shape as the `signal:` assertion beside it.
 */
export const OUTBOUND_REDIRECT_MODE = 'manual' as const;

/** Is this response a redirect the transport declined to follow? */
export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status <= 399;
}

/**
 * The refusal text for a 3xx that was not followed.
 *
 * THE HOST, NOT THE URL. The `Location` of an SSRF attempt is attacker-chosen and
 * ends up in a tenant-visible delivery log; the host is what an operator needs to
 * diagnose "my vendor moved" and is bounded in length. A `Location` that will not
 * parse is reported as unparseable rather than echoed back verbatim.
 */
export function redirectRefusal(status: number, location: string | null | undefined): string {
  let where: string;
  if (typeof location !== 'string' || location.length === 0) {
    where = 'no Location header';
  } else {
    try {
      where = `Location host "${new URL(location).host}"`;
    } catch {
      where = 'an unparseable Location header';
    }
  }
  return `${REDIRECT_REFUSED}: HTTP ${status} redirect NOT followed (${where}); the redirect target is unvalidated, so nothing was re-sent`;
}

/** Does this reason name a refused redirect? Used by the permanent-error classifiers. */
export function isRedirectRefusal(reason: string | undefined): boolean {
  return typeof reason === 'string' && reason.startsWith(REDIRECT_REFUSED);
}
