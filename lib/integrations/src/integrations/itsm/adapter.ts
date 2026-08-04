/**
 * ITSM Adapter Factory
 * 
 * Creates ITSM adapter instances based on vendor and configuration.
 */

import type { ITSMAdapter, ITSMAdapterHealth, ITSMTicketRequest } from '../adapters/types';
import { ServiceNowAdapter } from './servicenow';
import { JiraAdapter } from './jira';
import { ZendeskAdapter } from './zendesk';
import { FreshserviceAdapter } from './freshservice';
import { BMCHelixAdapter } from './bmc-helix';
import { IvantiAdapter } from './ivanti';
import { ManageEngineAdapter } from './manageengine';
import { GenericWebhookAdapter } from './generic-webhook';
import type { ITSMFullConfig, ITSMVendor, ITSMGenericWebhookConfig } from './store';

export { ServiceNowAdapter } from './servicenow';
export { JiraAdapter } from './jira';
export { ZendeskAdapter } from './zendesk';
export { FreshserviceAdapter } from './freshservice';
export { BMCHelixAdapter } from './bmc-helix';
export { IvantiAdapter } from './ivanti';
export { ManageEngineAdapter } from './manageengine';
export { GenericWebhookAdapter } from './generic-webhook';
import { resolveEmission } from '../adapters/emit-gate';

/**
 * Create an ITSM adapter based on vendor and configuration
 */
export function createITSMAdapter(
  vendor: ITSMVendor,
  config: ITSMFullConfig
): ITSMAdapter | null {
  // Tier gate at the FACTORY — the one chokepoint every vendor passes through.
  // All eight adapters POST real tickets into a customer's ITSM; gating here
  // means a non-emitting tier cannot even construct one, so a new vendor added
  // later inherits the gate instead of having to remember it.
  //
  // Returning null is the existing contract for "cannot build an adapter"
  // (see the missing-credentials branch below), so no caller changes.
  const emission = resolveEmission();
  if (emission.mode === 'suppressed') {
    console.warn(`ITSM adapter not created for ${vendor}: ${emission.reason}`);
    return null;
  }

  const credentials = config.credentials;
  
  if (!credentials) {
    console.warn(`No credentials provided for ITSM vendor: ${vendor}`);
    return null;
  }
  
  switch (vendor) {
    case 'servicenow':
      if (!config.instanceUrl) {
        console.warn('ServiceNow adapter requires instanceUrl');
        return null;
      }
      return new ServiceNowAdapter({
        instanceUrl: config.instanceUrl,
        table: config.table || 'incident',
        auth: {
          type: credentials.clientId ? 'oauth' : 'api_token',
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          username: credentials.username,
          apiToken: credentials.apiToken,
        },
      });
    
    case 'jira':
      if (!config.instanceUrl || !config.projectKey) {
        console.warn('Jira adapter requires instanceUrl and projectKey');
        return null;
      }
      // Jira uses email as username and apiToken for auth
      if (!credentials.username || !credentials.apiToken) {
        console.warn('Jira adapter requires username and apiToken');
        return null;
      }
      return new JiraAdapter({
        baseUrl: config.instanceUrl,
        email: credentials.username,
        apiToken: credentials.apiToken,
        projectKey: config.projectKey,
        serviceDeskId: '1', // Default - can be configured via credentials
        useJSM: true,
      });
    
    case 'zendesk':
      if (!config.subdomain) {
        console.warn('Zendesk adapter requires subdomain');
        return null;
      }
      // Construct instanceUrl from subdomain
      const zendeskUrl = `https://${config.subdomain}.zendesk.com`;
      return new ZendeskAdapter({
        instanceUrl: zendeskUrl,
        email: credentials.username || '',
        apiToken: credentials.apiToken || '',
      });
    
    case 'freshservice':
      if (!config.subdomain) {
        console.warn('Freshservice adapter requires subdomain');
        return null;
      }
      // Construct instanceUrl from subdomain
      const freshserviceUrl = `https://${config.subdomain}.freshservice.com`;
      return new FreshserviceAdapter({
        instanceUrl: freshserviceUrl,
        apiKey: credentials.apiToken || '',
      });
    
    case 'bmc-helix':
      if (!config.instanceUrl) {
        console.warn('BMC Helix adapter requires instanceUrl');
        return null;
      }
      return new BMCHelixAdapter({
        instanceUrl: config.instanceUrl,
        auth: {
          type: credentials.clientId ? 'oauth' : 'api_token',
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          tokenUrl: credentials.clientId ? `${config.instanceUrl}/oauth/token` : undefined,
          username: credentials.username,
          apiToken: credentials.apiToken,
        },
      });
    
    case 'ivanti':
      if (!config.instanceUrl) {
        console.warn('Ivanti adapter requires instanceUrl');
        return null;
      }
      if (!credentials.clientId || !credentials.clientSecret) {
        console.warn('Ivanti adapter requires clientId and clientSecret');
        return null;
      }
      return new IvantiAdapter({
        instanceUrl: config.instanceUrl,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      });
    
    case 'manageengine':
      if (!config.instanceUrl) {
        console.warn('ManageEngine adapter requires instanceUrl');
        return null;
      }
      // ManageEngine uses technicianKey for auth
      const techKey = credentials.apiToken || '';
      if (!techKey) {
        console.warn('ManageEngine adapter requires apiToken (technicianKey)');
        return null;
      }
      return new ManageEngineAdapter({
        instanceUrl: config.instanceUrl,
        technicianKey: techKey,
      });
    
    case 'generic_webhook':
      if (!config.genericWebhook) {
        console.warn('Generic webhook adapter requires webhook configuration');
        return null;
      }
      return new GenericWebhookAdapter({
        url: config.genericWebhook.url,
        method: config.genericWebhook.method || 'POST',
        headers: config.genericWebhook.headers || { 'Content-Type': 'application/json' },
        bodyTemplate: config.genericWebhook.bodyTemplate,
        signingSecret: credentials.signingSecret,
        signingAlgorithm: config.genericWebhook.signingAlgorithm,
        retryPolicy: config.genericWebhook.retryPolicy,
      });
    
    default:
      console.warn(`Unknown ITSM vendor: ${vendor}`);
      return null;
  }
}

/**
 * ITSM Adapter Manager
 * 
 * Manages adapter instances and provides a unified interface.
 */
export class ITSMAdapterManager {
  private adapters: Map<ITSMVendor, ITSMAdapter> = new Map();
  
  /**
   * Register an adapter for a vendor
   */
  registerAdapter(vendor: ITSMVendor, adapter: ITSMAdapter): void {
    this.adapters.set(vendor, adapter);
  }
  
  /**
   * Get adapter for a vendor
   */
  getAdapter(vendor: ITSMVendor): ITSMAdapter | null {
    return this.adapters.get(vendor) || null;
  }
  
  /**
   * Get default (first enabled) adapter
   */
  getDefaultAdapter(): ITSMAdapter | null {
    const adapters = Array.from(this.adapters.values());
    return adapters[0] || null;
  }
  
  /**
   * Check if a vendor is available
   */
  hasAdapter(vendor: ITSMVendor): boolean {
    return this.adapters.has(vendor);
  }
  
  /**
   * Get all registered vendors
   */
  getRegisteredVendors(): ITSMVendor[] {
    return Array.from(this.adapters.keys());
  }
  
  /**
   * Create a ticket using a specific vendor
   */
  async createTicket(
    vendor: ITSMVendor,
    request: ITSMTicketRequest
  ): Promise<ReturnType<ITSMAdapter['createTicket']>> {
    const adapter = this.getAdapter(vendor);
    if (!adapter) {
      throw new Error(`No adapter registered for vendor: ${vendor}`);
    }
    return adapter.createTicket(request);
  }
  
  /**
   * Health check all adapters.
   *
   * Returns a THREE-state result per vendor, not a boolean. `healthCheck` is
   * optional on `ITSMAdapter`, and this method used to record `true` for an
   * adapter that exposes none — so "we never asked" and "we asked and it is
   * fine" arrived at the caller as the same value. Nothing downstream could
   * tell them apart, which is the unearned affirmative this repository keeps
   * finding: a green state reported without the thing that would establish it.
   *
   * An adapter that throws is `unhealthy`, not an exception that aborts the
   * sweep. Every shipped adapter catches internally, but the interface does not
   * require it, and one bad adapter taking down the whole result would leave
   * every OTHER vendor unreported — a worse failure than the one being reported.
   */
  async healthCheck(): Promise<Record<ITSMVendor, ITSMAdapterHealth>> {
    const results: Record<ITSMVendor, ITSMAdapterHealth> = {} as Record<
      ITSMVendor,
      ITSMAdapterHealth
    >;

    for (const [vendor, adapter] of this.adapters) {
      if (!adapter.healthCheck) {
        results[vendor] = 'unchecked';
        continue;
      }
      try {
        results[vendor] = (await adapter.healthCheck()) ? 'healthy' : 'unhealthy';
      } catch {
        results[vendor] = 'unhealthy';
      }
    }

    return results;
  }
}

// Singleton instance
export const itsmAdapterManager = new ITSMAdapterManager();
