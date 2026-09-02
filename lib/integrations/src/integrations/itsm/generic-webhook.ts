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

export interface GenericWebhookConfig {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: Record<string, string>;
  bodyTemplate: string; // JSON template with {{variable}} placeholders
  /** MANDATORY on the live path — createTicket() throws rather than POSTing an
   *  unsigned ticket. createITSMAdapter() also refuses to build without it. */
  signingSecret?: string;
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
 * Sign request body with HMAC
 */
function signBody(body: string, secret: string, algorithm: 'hmac-sha256' | 'hmac-sha512'): string {
  const hmac = crypto.createHmac(algorithm === 'hmac-sha512' ? 'sha512' : 'sha256', secret);
  hmac.update(body);
  return hmac.digest('hex');
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
    const context = buildTemplateContext(
      request,
      request.correlationId || crypto.randomUUID(),
      new Date().toISOString(),
    );

    // Substitute variables in body template
    const body = substituteVariables(this.config.bodyTemplate, context);
    
    // Build headers
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
    const signature = signBody(body, this.config.signingSecret, this.config.signingAlgorithm || 'hmac-sha256');
    headers['X-Signature'] = signature;
    headers['X-Signing-Algorithm'] = this.config.signingAlgorithm || 'hmac-sha256';
    
    // Execute with retry
    const result = await this.executeWithRetry(this.config.url, {
      method: this.config.method,
      headers,
      body,
    });
    
    if (!result.success) {
      throw new Error(`Webhook failed: ${result.error}`);
    }
    
    return {
      ticketId: result.ticketId || context.requestId,
      ticketUrl: result.ticketUrl,
      status: 'open',
      createdAt: new Date().toISOString(),
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
      });
      
      if (response.ok || response.status === 201 || response.status === 202) {
        // Try to parse response for ticket ID
        let ticketId: string | undefined;
        let ticketUrl: string | undefined;
        
        try {
          const data = await response.json() as Record<string, unknown>;
          ticketId = (data.id || data.ticketId || data.ticket_id || data.number) as string | undefined;
          ticketUrl = (data.url || data.webUrl || data.link) as string | undefined;
        } catch {
          // Response isn't JSON, use request ID
        }
        
        return { success: true, ticketId, ticketUrl };
      }
      
      const errorText = await response.text();
      
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      
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
      });
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
