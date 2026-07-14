/**
 * Webhook SIEM Adapter
 * 
 * Sends events to SIEM systems via signed webhook.
 * Supports HMAC-SHA256 signing for request integrity.
 */

import crypto from 'crypto';
import type { SIEMAdapter, SIEMEventRequest, SIEMEventResponse } from '../adapters/types';

export interface WebhookSIEMConfig {
  /** Webhook URL */
  url: string;
  /** HTTP method */
  method: 'POST' | 'PUT';
  /** Custom headers */
  headers?: Record<string, string>;
  /** Signing secret for HMAC */
  signingSecret?: string;
  /** Signing algorithm */
  signingAlgorithm?: 'hmac-sha256' | 'hmac-sha512';
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
      retryPolicy: config.retryPolicy || {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    };
  }

  async sendEvent(event: SIEMEventRequest): Promise<SIEMEventResponse> {
    const payload = JSON.stringify(event);
    const headers = { ...this.config.headers };

    // Add signing if configured
    if (this.config.signingSecret) {
      const signature = this.signPayload(payload);
      headers['X-Signature'] = signature;
      headers['X-Signing-Algorithm'] = this.config.signingAlgorithm;
    }

    headers['X-Event-ID'] = event.correlationId || crypto.randomUUID();
    headers['X-Event-Type'] = event.type;

    const result = await this.executeWithRetry({
      url: this.config.url,
      method: this.config.method,
      headers,
      body: payload,
    });

    return {
      eventId: headers['X-Event-ID'] || crypto.randomUUID(),
      status: result.success ? 'sent' : 'failed',
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
    try {
      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'EnterpriseShell-SIEM/1.0' },
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
    try {
      const response = await fetch(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
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
