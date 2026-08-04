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
import type { ITSMAdapter, ITSMTicketRequest, ITSMTicketResponse } from '../adapters/types';

export interface GenericWebhookConfig {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: Record<string, string>;
  bodyTemplate: string; // JSON template with {{variable}} placeholders
  signingSecret?: string;
  signingAlgorithm?: 'hmac-sha256' | 'hmac-sha512';
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

/**
 * Substitute variables in template string
 */
function substituteVariables(template: string, context: VariableContext): string {
  let result = template;
  
  // Replace all {{variable}} patterns
  const regex = /\{\{([^}]+)\}\}/g;
  result = result.replace(regex, (match, path) => {
    const value = path.trim().split('.').reduce((obj: unknown, key: string) => {
      if (obj && typeof obj === 'object') {
        return (obj as Record<string, unknown>)[key];
      }
      return undefined;
    }, context);
    
    return value !== undefined ? String(value) : match;
  });
  
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
      retryPolicy: config.retryPolicy || {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    };
  }

  async createTicket(request: ITSMTicketRequest): Promise<ITSMTicketResponse> {
    // Build variable context from request fields
    const context: VariableContext = {
      deviceId: request.deviceId || '',
      userId: request.userId || '',
      badgeUid: request.deviceId || '', // Use deviceId as fallback for badge
      location: request.devicePlatform ? { zone: request.devicePlatform } : undefined,
      requestId: request.correlationId || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      title: request.title,
      description: request.description,
      severity: request.severity,
      category: request.category,
      source: request.source || 'EnterpriseShell',
      userEmail: request.userEmail,
      userName: request.userName,
      deviceName: request.deviceName,
      ...request.rawEvent as Record<string, unknown>,
    };
    
    // Substitute variables in body template
    const body = substituteVariables(this.config.bodyTemplate, context);
    
    // Build headers
    const headers = { ...this.config.headers };
    
    // Add signing if configured
    if (this.config.signingSecret) {
      const signature = signBody(body, this.config.signingSecret, this.config.signingAlgorithm || 'hmac-sha256');
      headers['X-Signature'] = signature;
      headers['X-Signing-Algorithm'] = this.config.signingAlgorithm || 'hmac-sha256';
    }
    
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
    try {
      const response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
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
    try {
      // Just test connectivity, not full auth
      const response = await fetch(this.config.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'EnterpriseShell-ITSM/1.0' },
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
