/**
 * One SSRF guard for every operator-supplied outbound endpoint.
 *
 * WHY IT MOVED HERE. This function lived in `webhooks/dispatch.ts` and was called
 * by exactly one of the three families that POST to a URL an operator typed in.
 * `siem/webhook.ts` and `itsm/generic-webhook.ts` both fetched `config.url` raw —
 * and the ITSM config schema's `z.string().url()` happily accepts
 * `http://169.254.169.254/latest/meta-data/`, because a URL validator validates
 * SYNTAX and says nothing about where the address points. Two of three callers
 * skipping a guard that already existed is a guard in the wrong place, so it is now
 * in `adapters/` beside the other shared outbound rules, and `webhooks/dispatch.ts`
 * re-exports the same symbols under the same names so nothing downstream moves.
 *
 * TWO RULES, and they are deliberately different in kind.
 *
 * THE SSRF BLOCK IS UNCONDITIONAL. Loopback, link-local, RFC1918 private and
 * RFC6598 shared ranges are refused in every tier, because there is no tier in
 * which posting a signed customer payload at 127.0.0.1 — or at a neighbour on the
 * internal network — is the intended behaviour. It was previously gated on
 * production AND covered only four loopback spellings: 192.168.0.5, 10.0.0.7 and
 * every other RFC1918 address passed the guard even when it fired.
 *
 * THE HTTPS RULE IS GATED ON LIVE DELIVERY, passed in by the caller from the same
 * emission resolution that decides whether to send at all. One resolution, read
 * once, per call. A suppressed tier may legitimately point a fixture at a
 * plain-HTTP mock; a live one may not.
 *
 * WHAT THIS CANNOT DO, stated because the tempting reading overclaims: it checks
 * the URL's LITERAL host. A public hostname whose DNS resolves to 169.254.169.254
 * passes here and is stopped by nothing in this repository — that is the residue,
 * and it is named in `docs/COMPANY_BUILD_PLAN.md`. What it DOES now cover that it
 * did not before: the redirect hop, because no emitter follows one any more
 * (`adapters/redirect.ts`).
 */

/**
 * EVERY operator-supplied URL field in the six emitter families, and whether the
 * guard is GATED on it or its absence is merely REPORTED.
 *
 * WHY A REGISTRY AND NOT A NAME TEST. The first version of the wire gate split on
 * the field being named exactly `url`, which read as principled and was not: it
 * left `hecUrl` unguarded, and a literal loopback `hecUrl` at prod + live POSTed the
 * whole event — with the HEC token in the `Authorization` header — to 127.0.0.1 and
 * returned `sent`. Reproduced 2026-09-02 against a real socket. A distinction that
 * cannot survive one counter-example is a convenience, so the classification is now
 * WRITTEN DOWN with its reason, and `scripts/check-emitter-wire-discipline.mjs`
 * asserts this registry against the fields it DERIVES from the family sources: a
 * field that appears in the tree and not here fails, and an entry here that no
 * source declares fails too. The scope stays derived; only the verdict is declared.
 *
 * THE LINE, stated so the next field can be classified rather than guessed:
 *   GATED    — the value IS the destination. The adapter appends a fixed collector
 *              path or nothing, and an operator typing an internal address here
 *              sends the payload there. `url`, `hecUrl`, `webhookUrl`.
 *   REPORTED — the value is a vendor TENANT HOST that the adapter builds many
 *              different API paths on (`instanceUrl`, `baseUrl`, `tokenUrl`). These
 *              are equally reachable at an internal address and equally unguarded;
 *              what is missing is not the check but the DESIGN — what a refusal
 *              means for a half-configured tenant, and whether an on-premise
 *              ServiceNow at 10.x is a legitimate deployment. Until that is decided,
 *              claiming they are guarded would be the overclaim this file exists to
 *              prevent.
 */
export interface OperatorUrlField {
  /** The emitter family the field belongs to. */
  readonly family: string;
  /** The config field name, exactly as declared in that family's source. */
  readonly field: string;
  /** GATED: the family must call validateWebhookUrl on it. REPORTED: it must not claim to. */
  readonly enforcement: 'GATED' | 'REPORTED';
  /** Why it sits on that side of the line. */
  readonly reason: string;
}

export const OPERATOR_URL_FIELDS: readonly OperatorUrlField[] = [
  { family: 'webhooks', field: 'url', enforcement: 'GATED',
    reason: 'the subscriber endpoint — the value IS the destination' },
  { family: 'siem', field: 'url', enforcement: 'GATED',
    reason: 'the collector endpoint on the signed-webhook adapter' },
  { family: 'siem', field: 'hecUrl', enforcement: 'GATED',
    reason: 'Splunk HEC: the adapter appends only the fixed /services/collector path' },
  { family: 'itsm', field: 'url', enforcement: 'GATED',
    reason: 'the generic-webhook endpoint — the operator names the whole target' },
  { family: 'itsm', field: 'webhookUrl', enforcement: 'GATED',
    reason: 'a stored ITSM credential naming a whole outbound endpoint; guarded where it is PARSED, since no adapter fetches it yet' },
  { family: 'itsm', field: 'instanceUrl', enforcement: 'REPORTED',
    reason: 'vendor tenant host (ServiceNow/Freshservice/Zendesk/ManageEngine/Ivanti/BMC); refusal semantics for an on-premise tenant are undesigned' },
  { family: 'itsm', field: 'baseUrl', enforcement: 'REPORTED', reason: 'Jira tenant host — same' },
  { family: 'itsm', field: 'tokenUrl', enforcement: 'REPORTED', reason: 'BMC Helix token host — same' },
  { family: 'telemetry', field: 'baseUrl', enforcement: 'REPORTED', reason: 'FleetDM tenant host — same' },
];

export const WEBHOOK_URL_REFUSALS = {
  httpsRequired: 'HTTPS required for live webhook delivery',
  loopback: 'Loopback and unspecified addresses are never valid webhook targets',
  privateRange: 'Private and link-local addresses are never valid webhook targets',
  invalidUrl: 'Invalid URL',
} as const;

/** Every string `validateWebhookUrl` can return in its `error` field. Derived from
 *  the object above rather than retyped, because the retyped copy is exactly what
 *  went stale: `isPermanentError` in dispatch.ts compared against 'HTTPS required in
 *  production' and 'Localhost not allowed in production', two strings this function
 *  stopped returning when the rules were rewritten. Nothing failed — the comparison
 *  just silently stopped matching, and a plain-http target at a live tier was
 *  retried six times over ~31 seconds instead of being refused once. */
export const WEBHOOK_URL_REFUSAL_REASONS: readonly string[] = Object.values(WEBHOOK_URL_REFUSALS);

export function validateWebhookUrl(
  url: string,
  opts: { live: boolean },
): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url);

    if (opts.live && parsed.protocol !== 'https:') {
      return { valid: false, error: WEBHOOK_URL_REFUSALS.httpsRequired };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Loopback and unspecified, in both families.
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '0.0.0.0' ||
      hostname === '::' ||
      hostname === '::1' ||
      /^127\./.test(hostname)
    ) {
      return { valid: false, error: WEBHOOK_URL_REFUSALS.loopback };
    }

    // RFC1918 private ranges, RFC6598 shared address space, and link-local —
    // including IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
    if (
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^f[cd][0-9a-f]{2}:/.test(hostname) ||
      /^fe[89ab][0-9a-f]:/.test(hostname)
    ) {
      return { valid: false, error: WEBHOOK_URL_REFUSALS.privateRange };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: WEBHOOK_URL_REFUSALS.invalidUrl };
  }
}
