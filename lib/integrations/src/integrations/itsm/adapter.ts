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
// The 2xx-shape refusals, re-exported so a proof asserts the REASON rather than
// merely that something failed. `success === false` is satisfied by a 500, a
// timeout and each of these.
export { ITSM_WEBHOOK_REFUSALS, ITSM_WEBHOOK_REFUSAL_REASONS } from './generic-webhook';
// The two pure halves of the generic-webhook template path, exported so
// proof:itsm-template can drive them without a network: the context BUILDER (whose
// field order is the security property) and the SUBSTITUTER (which refuses an
// unresolved placeholder rather than emitting the literal `{{var}}`).
export { buildTemplateContext, substituteVariables, UnresolvedTemplateVariableError } from './generic-webhook';
import { resolveEmission, type EmissionCredential } from '../adapters/emit-gate';

/**
 * The one credential each vendor must hold before an adapter may be built.
 *
 * WHY. Three vendors already refused an absent credential — jira (username +
 * apiToken), ivanti (clientId + clientSecret), manageengine (technicianKey). The
 * other five did not: zendesk read `credentials.apiToken || ''`, freshservice the
 * same, servicenow and bmc-helix passed `apiToken: undefined` straight into an
 * auth block, and generic_webhook never looked at signingSecret at all. At
 * beta/prod with the live flag on, that constructed an adapter whose Basic or
 * Bearer header was EMPTY and pointed it at a customer's real ITSM.
 *
 * Fail-closed on an unknown vendor: a ninth vendor added to ITSMVendorSchema
 * without a rule here lands in the `default` branch and is REFUSED, rather than
 * silently inheriting "no credential required". proof:emit-gate derives the
 * vendor list from the schema, so the omission fails a proof, not a customer.
 */
function requiredCredential(vendor: ITSMVendor, config: ITSMFullConfig): EmissionCredential {
  const c = config.credentials;
  switch (vendor) {
    case 'servicenow':
      return c?.clientId
        ? { name: 'ServiceNow clientSecret', value: c?.clientSecret }
        : { name: 'ServiceNow apiToken', value: c?.apiToken };
    case 'jira':
      return { name: 'Jira apiToken', value: c?.apiToken };
    case 'zendesk':
      return { name: 'Zendesk apiToken', value: c?.apiToken };
    case 'freshservice':
      return { name: 'Freshservice apiToken', value: c?.apiToken };
    case 'bmc-helix':
      return c?.clientId
        ? { name: 'BMC Helix clientSecret', value: c?.clientSecret }
        : { name: 'BMC Helix apiToken', value: c?.apiToken };
    case 'ivanti':
      return { name: 'Ivanti clientSecret', value: c?.clientSecret };
    case 'manageengine':
      return { name: 'ManageEngine apiToken (technicianKey)', value: c?.apiToken };
    case 'generic_webhook':
      return { name: 'Generic webhook signingSecret', value: c?.signingSecret };
    default:
      return { name: `unknown ITSM vendor "${String(vendor)}" declares no credential rule`, value: undefined };
  }
}

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
  //
  // The gate is passed the vendor's REQUIRED credential, so all three documented
  // conditions are checked here rather than two — an empty apiToken now refuses
  // at the same chokepoint the tier does, with a reason that names the field.
  const emission = resolveEmission(process.env, requiredCredential(vendor, config));
  if (emission.mode === 'suppressed') {
    console.warn(`ITSM adapter not created for ${vendor}: ${emission.reason}`);
    return null;
  }

  const credentials = config.credentials;
  
  if (!credentials) {
    console.warn(`No credentials provided for ITSM vendor: ${vendor}`);
    return null;
  }

  // The `|| ''` fallbacks in the vendor branches below are now UNREACHABLE with an
  // empty credential: requiredCredential() named the field to the gate above and a
  // blank one returned null there. They are left in place as the type-level default
  // only. Do not read them as "an empty token is acceptable here" — it is not, and
  // proof:emit-gate drives every vendor in ITSMVendorSchema through the refusal.

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
