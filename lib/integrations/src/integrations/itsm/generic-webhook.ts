/**
 * Generic Webhook ITSM Adapter
 * 
 * A universal webhook adapter that can work with ANY ITSM system via HTTP POST.
 * Supports:
 * - Custom URL, method, headers
 * - HMAC-SHA256 request signing
 * - Template-based JSON body mapping
 * - Variable substitution: deviceId, userId, badgeUid, location.zone, policyName, requestId
 * - Retry policy with exponential backoff
 */

import crypto from 'crypto';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';
import { SIGNING_SECRET_MISSING } from '../adapters/signing';
import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';
import { validateWebhookUrl } from '../adapters/url-guard';
import { isRedirectStatus, redirectRefusal } from '../adapters/redirect';
import { boundedText, VENDOR_ERROR_TEXT_LIMIT } from '../adapters/bounded-text';
import { v2SignatureHeaders } from '../webhooks/sign';

/**
 * A 2xx IS NOT A TICKET. The refusals below are exported so `proof:itsm-template`
 * asserts the REASON rather than merely that something failed — `success === false`
 * is satisfied by a 500, a timeout and each of these, and an assertion that cannot
 * tell them apart is not holding the behaviour it claims to.
 *
 * WHAT WAS WRONG. A JSON parse failure was swallowed (`catch { /* isn't JSON *\/ }`)
 * and createTicket then returned `ticketId: result.ticketId || context.requestId,
 * status: 'open'` — so an EMPTY 200 from anything listening on the configured URL
 * minted OUR OWN correlation id as a ticket number and reported the ticket open.
 * The ledger of what an incident said then contained an id that exists in no ITSM.
 */
export const ITSM_WEBHOOK_REFUSALS = {
  emptyBody: 'ITSM webhook refused: the endpoint returned a 2xx with an EMPTY body, which names no ticket',
  nonJsonBody: 'ITSM webhook refused: the endpoint returned a 2xx whose body is not JSON, which names no ticket',
  noTicketId: 'ITSM webhook refused: the 2xx JSON carries no non-empty id/ticketId/ticket_id/number, which names no ticket',
} as const;

/** Every string the 2xx-shape refusals can return. Derived, never retyped. */
export const ITSM_WEBHOOK_REFUSAL_REASONS: readonly string[] = Object.values(ITSM_WEBHOOK_REFUSALS);

export interface GenericWebhookConfig {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: Record<string, string>;
  bodyTemplate: string; // JSON template with {{variable}} placeholders
  /** MANDATORY on the live path — createTicket() throws rather than POSTing an
   *  unsigned ticket. createITSMAdapter() also refuses to build without it. */
  signingSecret?: string;
  /**
   * RETIRED KNOB, kept only so an existing config still parses. Under signature
   * scheme v2 the primitive is FIXED at HMAC-SHA256 and announced by the `v2=`
   * marker, so there is nothing for this to select; it used to be echoed on the wire
   * as `X-Signing-Algorithm`, which told a receiver the algorithm and bought it no
   * replay protection. Nothing reads it now, and deleting it would reject a config
   * an operator has already written.
   */
  signingAlgorithm?: 'hmac-sha256' | 'hmac-sha512';
  /** Per-attempt request timeout in ms, READ by every fetch below. */
  timeout?: number;
  retryPolicy?: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
}

interface VariableContext {
  deviceId: string;
  userId: string;
  badgeUid: string;
  location?: {
    zone?: string;
  };
  policyName?: string;
  requestId: string;
  timestamp: string;
  [key: string]: unknown;
}

/** Thrown when a template names something the context does not carry. */
export class UnresolvedTemplateVariableError extends Error {
  readonly unresolved: readonly string[];
  constructor(unresolved: readonly string[]) {
    super(`Generic webhook template has unresolved placeholder(s): ${unresolved.join(', ')}`);
    this.name = 'UnresolvedTemplateVariableError';
    this.unresolved = unresolved;
  }
}

/**
 * Substitute variables in template string.
 *
 * AN UNRESOLVED PLACEHOLDER IS A REFUSAL, NOT A DEFAULT. This used to
 * `return value !== undefined ? String(value) : match` — the literal `{{whatever}}`
 * was emitted into the outbound JSON body. So a template naming a field this
 * adapter does not carry produced a ticket in a customer's ITSM whose fields read
 * `{{assetTag}}`, and nothing anywhere reported a problem: the POST succeeded, the
 * ticket existed, and the ledger of what an incident SAID contained template
 * syntax where evidence belonged. Refusing is loud and fixable; emitting the
 * placeholder is silent and permanent.
 *
 * Exported so proof:itsm-template can drive it directly — a pure function of
 * (template, context), no clock and no network.
 */
export function substituteVariables(template: string, context: VariableContext): string {
  const unresolved: string[] = [];

  // Replace all {{variable}} patterns
  const regex = /\{\{([^}]+)\}\}/g;
  const result = template.replace(regex, (match, path) => {
    const value = path.trim().split('.').reduce((obj: unknown, key: string) => {
      if (obj && typeof obj === 'object') {
        return (obj as Record<string, unknown>)[key];
      }
      return undefined;
    }, context);

    if (value === undefined) {
      unresolved.push(String(path).trim());
      return match;
    }
    return String(value);
  });

  if (unresolved.length > 0) throw new UnresolvedTemplateVariableError(unresolved);

  return result;
}

/**
 * Build the template context for one ticket request.
 *
 * EXTRACTED so it can be proven. The ORDER inside is the security property and it
 * was inverted: `...request.rawEvent` used to be spread LAST, so any key a caller
 * put in the raw vendor event OVERRODE the sanctioned field of the same name — a
 * rawEvent carrying `deviceId` or `severity` decided what the ticket said, and the
 * values this adapter derives were discarded. rawEvent is untrusted passthrough
 * (it is whatever a vendor webhook posted at us), so it goes FIRST and the
 * sanctioned fields overwrite it. Extra keys stay template-addressable, which is
 * the feature; overriding a sanctioned one is not.
 */
export function buildTemplateContext(request: ITSMTicketRequest, requestId: string, timestamp: string): VariableContext {
  return {
    ...request.rawEvent as Record<string, unknown>,
    deviceId: request.deviceId || '',
    userId: request.userId || '',
    badgeUid: request.deviceId || '', // Use deviceId as fallback for badge
    location: request.devicePlatform ? { zone: request.devicePlatform } : undefined,
    requestId,
    timestamp,
    title: request.title,
    description: request.description,
    severity: request.severity,
    category: request.category,
    source: request.source || 'EnterpriseShell',
    userEmail: request.userEmail,
    userName: request.userName,
    deviceName: request.deviceName,
  };
}

export class GenericWebhookAdapter implements ITSMAdapter {
  readonly name = 'Generic Webhook';
  readonly vendor = 'generic_webhook';
  private config: GenericWebhookConfig;

  constructor(config: GenericWebhookConfig) {
    this.config = {
      ...config,
      method: config.method || 'POST',
      headers: config.headers || { 'Content-Type': 'application/json' },
      signingAlgorithm: config.signingAlgorithm || 'hmac-sha256',
      timeout: config.timeout || 30000,
      retryPolicy: config.retryPolicy || {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    };
  }

  /** The credential this adapter holds, named so the gate's refusal names it back.
   *  Passed at every resolveEmission() site in this class — see adapters/emit-gate.ts. */
  private emissionCredential(): EmissionCredential {
    // The signing secret, matching createTicket()'s refusal: this adapter has no other
    // secret, and an unsigned POST to a customer's webhook is the defect that refusal
    // exists to prevent.
    return { name: 'Generic webhook signingSecret', value: this.config.signingSecret };
  }

  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    // ONE INSTANT PER DELIVERY, sampled once here. The template context and the v2
    // signature timestamp are the SAME moment: under v2 the timestamp is inside the
    // MAC and executeWithRetry recurses, so a per-attempt instant would give one
    // ticket more than one signature. This is the clock read the adapter already
    // made for the template context — reused, not a second one.
    const deliveryInstant = new Date();
    const context = buildTemplateContext(
      request,
      request.correlationId || crypto.randomUUID(),
      deliveryInstant.toISOString(),
    );

    // Substitute variables in body template
    const body = substituteVariables(this.config.bodyTemplate, context);

    // THE TARGET IS VALIDATED, and it was not. This adapter POSTed to `config.url`
    // raw, and the ITSM config schema's `z.string().url()` accepts
    // `http://169.254.169.254/latest/meta-data/` — a URL validator validates SYNTAX
    // and says nothing about where the address points. UNCONDITIONAL for the address
    // rules, live-gated for HTTPS; see ../adapters/url-guard.ts. Past the emit gate
    // in executeWithRetry, `live` is true.
    const targetCheck = validateWebhookUrl(this.config.url, { live: true });
    if (!targetCheck.valid) {
      throw new Error(`Webhook target refused: ${targetCheck.error}`);
    }

    // Spread FIRST so a caller-supplied header can never overwrite the signature
    // written after it.
    const headers = { ...this.config.headers };

    // SIGNING IS NOT OPTIONAL. This was `if (this.config.signingSecret) { ...sign }`,
    // so an adapter built without a secret POSTed the ticket UNSIGNED and reported
    // it as created. webhooks/dispatch.ts refuses the same case in these exact
    // words; the two paths simply disagreed. Throwing is this adapter's existing
    // refusal shape — createTicket() already throws on a failed POST and on a
    // closed emit gate — so a caller cannot mistake a refusal for a ticket.
    if (!this.config.signingSecret?.trim()) {
      throw new Error(SIGNING_SECRET_MISSING);
    }
    // SIGNED UNDER SCHEME v2, minted ONCE for this delivery. This was `X-Signature`
    // over the BODY ALONE plus an `X-Signing-Algorithm` header and no timestamp —
    // v1, which webhooks/sign.ts's own verifier refuses by name as replayable. The
    // body here is the OPERATOR's template output and carries no field this could
    // derive an instant from, so the instant is THREADED: `deliveryInstant`, the same
    // moment the template context was built at.
    Object.assign(
      headers,
      v2SignatureHeaders(body, this.config.signingSecret, { timestampMs: deliveryInstant.getTime() }),
    );
    
    // Execute with retry
    const result = await this.executeWithRetry(this.config.url, {
      method: this.config.method,
      headers,
      body,
    });
    
    if (!result.success) {
      throw new Error(`Webhook failed: ${result.error}`);
    }
    
    // NO LOCAL FALLBACK. `result.ticketId || context.requestId` minted OUR OWN
    // correlation id as a ticket number whenever the endpoint answered 2xx with a
    // body naming none, and reported it 'open'. executeWithRetry now refuses those
    // three shapes by name above, so reaching here means the vendor named an id.
    if (typeof result.ticketId !== 'string' || result.ticketId.trim().length === 0) {
      throw new Error(ITSM_WEBHOOK_REFUSALS.noTicketId);
    }
    return {
      ticketId: result.ticketId,
      ticketUrl: result.ticketUrl,
      status: 'open',
      createdAt: deliveryInstant.toISOString(),
    };
  }

  private async executeWithRetry(
    url: string,
    options: { method: string; headers: Record<string, string>; body: string },
    attempt: number = 1
  ): Promise<{ success: boolean; ticketId?: string; ticketUrl?: string; error?: string }> {
    // GATED like healthCheck() above: this method reaches the network, and the
    // fixture/live boundary either covers every outbound path or it is not a
    // boundary. Nothing constructs this adapter in fixture mode today; the gate
    // makes that a property instead of a circumstance.
    {
      const emission = resolveEmission(process.env, this.emissionCredential());
      if (emission.mode !== "live") {
        throw new Error("refused: outbound call with the fixture/live boundary closed (mode is not live).");
      }
    }
    try {
      // Bounded PER ATTEMPT: this method recurses up to maxAttempts times, so an
      // unbounded fetch here is three unbounded hangs in series.
      const response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
        // NEVER FOLLOWED — see ../adapters/redirect.ts. The first hop is validated;
        // the second was handed to whatever the endpoint's `Location` named, and the
        // signature header survives the cross-origin hop.
        redirect: 'manual',
      });

      // Decided BEFORE the 2xx arm, because a 3xx is neither ok nor a 5xx and would
      // otherwise fall through to "HTTP 302: <body>" and be retried.
      if (isRedirectStatus(response.status)) {
        return { success: false, error: redirectRefusal(response.status, response.headers.get('location')) };
      }

      if (response.ok || response.status === 201 || response.status === 202) {
        // A 2xx IS NOT A TICKET. Each of the three shapes below is a named refusal
        // rather than a silent fall-through to our own correlation id.
        const text = await response.text();
        if (text.trim().length === 0) {
          return { success: false, error: ITSM_WEBHOOK_REFUSALS.emptyBody };
        }
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          return { success: false, error: ITSM_WEBHOOK_REFUSALS.nonJsonBody };
        }
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          return { success: false, error: ITSM_WEBHOOK_REFUSALS.nonJsonBody };
        }
        const record = data as Record<string, unknown>;
        const idCandidate = record.id ?? record.ticketId ?? record.ticket_id ?? record.number;
        // A NUMBER IS AN ID a great many ITSMs return; a boolean, an object or an
        // empty string is not. Normalised here rather than cast, because the cast is
        // what let `undefined` through in the first place.
        const ticketId =
          typeof idCandidate === 'string'
            ? idCandidate
            : typeof idCandidate === 'number' && Number.isFinite(idCandidate)
              ? String(idCandidate)
              : '';
        if (ticketId.trim().length === 0) {
          return { success: false, error: ITSM_WEBHOOK_REFUSALS.noTicketId };
        }
        const urlCandidate = record.url ?? record.webUrl ?? record.link;
        const ticketUrl = typeof urlCandidate === 'string' && urlCandidate.length > 0 ? urlCandidate : undefined;

        return { success: true, ticketId, ticketUrl };
      }

      // BOUNDED WHERE IT IS READ — see ../adapters/bounded-text.ts.
      const errorText = boundedText(await response.text(), VENDOR_ERROR_TEXT_LIMIT);
      
      // Retry on 5xx errors
      if (response.status >= 500 && attempt < this.config.retryPolicy!.maxAttempts) {
        const delay = Math.min(
          this.config.retryPolicy!.initialDelayMs * Math.pow(this.config.retryPolicy!.backoffMultiplier, attempt - 1),
          this.config.retryPolicy!.maxDelayMs
        );
        await this.sleep(delay);
        return this.executeWithRetry(url, options, attempt + 1);
      }
      
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    } catch (error) {
      const message = boundedText(
        error instanceof Error ? error.message : 'Unknown error',
        VENDOR_ERROR_TEXT_LIMIT,
      );

      // A HEADER VALUE undici refuses (a CR or LF in a header) throws a TypeError
      // BEFORE the socket opens. Retrying is retrying an unchanged string against an
      // unchanged library — three identical throws and the same answer. Permanent,
      // and named so the operator learns the header is malformed.
      if (error instanceof TypeError) {
        return { success: false, error: `permanent: request rejected before the socket: ${message}` };
      }

      // Retry on network errors
      if (attempt < this.config.retryPolicy!.maxAttempts) {
        const delay = Math.min(
          this.config.retryPolicy!.initialDelayMs * Math.pow(this.config.retryPolicy!.backoffMultiplier, attempt - 1),
          this.config.retryPolicy!.maxDelayMs
        );
        await this.sleep(delay);
        return this.executeWithRetry(url, options, attempt + 1);
      }
      
      return { success: false, error: message };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async healthCheck(): Promise<boolean> {
    // GATED, like every other outbound path. A health check is still a LIVE CALL:
    // it resolves a configured hostname and opens a connection from wherever the
    // process runs. Ungated, it reached the network in dev/alpha with no credential
    // — outside the three-condition boundary the security-review package tells an
    // assessor to verify FIRST. Found by review taking that document at its word.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode !== "live") return false;

    try {
      // Just test connectivity, not full auth
      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'EnterpriseShell-ITSM/1.0' },
        signal: AbortSignal.timeout(this.config.timeout ?? 30000),
        // Never followed — see ../adapters/redirect.ts.
        redirect: 'manual',
      });
      // A 3xx is not evidence the CONFIGURED endpoint is there; it is evidence some
      // other one might be, and we decline to find out.
      if (isRedirectStatus(response.status)) return false;
      if (response.ok) return true;
      // An AUTH CHALLENGE proves the endpoint is there and simply refused this
      // unauthenticated HEAD; so does "method not allowed". Those are evidence.
      //
      // 404 and 410 are the opposite: the server is telling us the resource is
      // not there. The previous condition was `response.status < 500`, which
      // reported a 404 — literally Not Found — as confirmation that the endpoint
      // was found, so a webhook pointed at a dead URL health-checked green.
      return response.status === 401 || response.status === 403 || response.status === 405;
    } catch {
      return false;
    }
  }
}
