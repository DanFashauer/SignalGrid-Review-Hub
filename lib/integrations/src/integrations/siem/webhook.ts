/**
 * Webhook SIEM Adapter
 * 
 * Sends events to SIEM systems via signed webhook.
 * Supports HMAC-SHA256 signing for request integrity.
 */

import crypto from 'crypto';
import { resolveEmission, EMIT_SUPPRESSED, type EmissionCredential } from '../adapters/emit-gate';
import { SIGNING_SECRET_MISSING } from '../adapters/signing';
import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';

export interface WebhookSIEMConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method */
  method: 'POST' | 'PUT';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Signing secret for HMAC. MANDATORY on the live path: sendEvent() refuses
   *  rather than POSTing an unsigned audit event (see the refusal below). */
  signingSecret?: string;
  /** Signing algorithm */
  signingAlgorithm?: 'hmac-sha256' | 'hmac-sha512';
  /** Per-attempt request timeout in ms. READ by every fetch in this file as
   *  `AbortSignal.timeout(...)` — an unbounded fetch inside a retry loop is three
   *  unbounded hangs in series. */
  timeout?: number;
  /** Retry configuration */
  retryPolicy?: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
}

/**
 * Webhook SIEM Adapter
 */
export class WebhookSIEMAdapter implements SIEMAdapter {
  readonly name = 'webhook';
  readonly vendor = 'WebhookSIEM';
  readonly config: Required<WebhookSIEMConfig>;

  constructor(config: WebhookSIEMConfig) {
    this.config = {
      url: config.url,
      method: config.method || 'POST',
      headers: config.headers || { 'Content-Type': 'application/json' },
      signingSecret: config.signingSecret || '',
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

  /**
   * The credential this adapter holds, named so the gate's refusal can name it back.
   *
   * Passed at EVERY resolveEmission() site in this class. The parameter was optional
   * until 2026-09-02 and every site here omitted it, so the third clause of the
   * boundary — tier AND live flag AND a credential — was not enforced on this path:
   * an adapter built with an empty secret reached the vendor with an empty auth
   * header. The gate cannot read this itself; the shape is per-vendor, so the caller
   * names what it holds.
   */
  private emissionCredential(): EmissionCredential {
    // The signing secret IS this adapter's credential: sendEvent() refuses without it
    // and the HMAC is the only thing that authenticates us to the receiver. There is
    // no other secret in WebhookSIEMConfig.
    return { name: 'SIEM webhook signingSecret', value: this.config.signingSecret };
  }

  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    // Gate first: dev/alpha never emit outbound. See ../adapters/emit-gate.ts.
    const emission = resolveEmission(process.env, this.emissionCredential());
    if (emission.mode === 'suppressed') {
      return {
        eventId: `suppressed-${Date.now()}`,
        status: EMIT_SUPPRESSED,
        // The reason, carried onto the response. `SIEMEventResponse.reason` is
        // documented as present on every non-'sent' status the adapter decided, and it
        // was set on none of the suppressed branches: a caller saw status 'suppressed'
        // with nothing saying whether the tier, the flag or a missing credential
        // withheld it — the same "nothing was sent" / "nothing to send" ambiguity the
        // gate's own refusal text exists to remove.
        reason: emission.reason,
        receivedAt: new Date().toISOString(),
      };
    }

    // SIGNING IS NOT OPTIONAL PAST THE GATE.
    //
    // This was `if (this.config.signingSecret) { ...sign... }`, with the secret
    // defaulted to '' in the constructor. An adapter configured without a secret
    // therefore POSTed the audit event UNSIGNED to the configured collector and
    // returned status 'sent' — a receiver with no way to tell our event from
    // anyone else's, and a caller with no way to know. webhooks/dispatch.ts has
    // refused exactly this case, in exactly these words, the whole time; the two
    // outbound paths simply disagreed. They no longer do.
    //
    // Refusal, not a silent skip: status 'failed' with the reason, matching
    // dispatch.ts. 'suppressed' would be wrong here — nothing about policy
    // withheld this, an operator left a required field empty and should chase it.
    //
    // SECOND LAYER since 2026-09-02. The signing secret is also what this adapter
    // names to the emit gate above (it is the only secret in WebhookSIEMConfig), so an
    // absent one is now refused there first, with a reason naming the same field. This
    // stays: it is the layer that survives if the credential mapping ever changes, and
    // `check-signing-unconditional.mjs` holds its SHAPE (`if (!secret) refuse`, never
    // `if (secret) sign`) whether or not the gate reaches it first.
    if (!this.config.signingSecret.trim()) {
      return {
        // No clock read here on purpose: nothing left the process, so there is no
        // instant to stamp, and adding a Date.now() would put a new wall-clock read
        // into the connector boundary for an id nobody correlates against.
        eventId: event.correlationId || 'unsigned-refused',
        status: 'failed',
        reason: SIGNING_SECRET_MISSING,
        receivedAt: new Date().toISOString(),
      };
    }

    const payload = JSON.stringify(event);
    const headers = { ...this.config.headers };

    const signature = this.signPayload(payload);
    headers['X-Signature'] = signature;
    headers['X-Signing-Algorithm'] = this.config.signingAlgorithm;

    headers['X-Event-ID'] = event.correlationId || crypto.randomUUID();
    headers['X-Event-Type'] = event.type;

    const result = await this.executeWithRetry({
      url: this.config.url,
      method: this.config.method,
      headers,
      body: payload,
    });

    return {
      // The transport-failure arm carries its reason too. A 'failed' with no reason
      // is the same silence as a 'suppressed' with none: the caller learns that
      // nothing arrived and nothing about why, and the error text the retry loop
      // already collected was being dropped on the floor here.
      eventId: headers['X-Event-ID'] || crypto.randomUUID(),
      status: result.success ? 'sent' : 'failed',
      ...(result.success ? {} : { reason: result.error ?? 'transport failed without an error message' }),
      receivedAt: new Date().toISOString(),
    };
  }

  async sendEvents(events: SIEMEventRequest[]): Promise<SIEMEventResponse[]> {
    const results: SIEMEventResponse[] = [];

    for (const event of events) {
      const result = await this.sendEvent(event);
      results.push(result);
    }

    return results;
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
      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'EnterpriseShell-SIEM/1.0' },
        signal: AbortSignal.timeout(this.config.timeout),
      });
      return response.ok || response.status < 500;
    } catch {
      return false;
    }
  }

  private signPayload(payload: string): string {
    const hmac = crypto.createHmac(
      this.config.signingAlgorithm === 'hmac-sha512' ? 'sha512' : 'sha256',
      this.config.signingSecret!
    );
    hmac.update(payload);
    return hmac.digest('hex');
  }

  private async executeWithRetry(
    options: { url: string; method: string; headers: Record<string, string>; body: string },
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string }> {
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
      // Bounded PER ATTEMPT, not per call: this method recurses up to
      // maxAttempts times, so an unbounded fetch here is three unbounded hangs in
      // series behind whatever awaits sendEvent().
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (response.ok || response.status === 202) {
        return { success: true };
      }

      const errorText = await response.text();

      // Retry on 5xx
      if (response.status >= 500 && attempt < this.config.retryPolicy.maxAttempts) {
        const delay = Math.min(
          this.config.retryPolicy.initialDelayMs * Math.pow(this.config.retryPolicy.backoffMultiplier, attempt - 1),
          this.config.retryPolicy.maxDelayMs
        );
        await this.sleep(delay);
        return this.executeWithRetry(options, attempt + 1);
      }

      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (attempt < this.config.retryPolicy.maxAttempts) {
        const delay = Math.min(
          this.config.retryPolicy.initialDelayMs * Math.pow(this.config.retryPolicy.backoffMultiplier, attempt - 1),
          this.config.retryPolicy.maxDelayMs
        );
        await this.sleep(delay);
        return this.executeWithRetry(options, attempt + 1);
      }

      return { success: false, error: message };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
