/**
 * ITSM Credential Store
 * 
 * Persists ITSM vendor configurations with AES-GCM encryption for secrets.
 * Supports Redis (production) or in-memory (development) storage.
 */

import crypto from 'crypto';
import Redis from 'ioredis';
import { z } from 'zod';

// ============================================================================
// Environment & Config
// ============================================================================

const REDIS_URL = process.env.REDIS_URL;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Encryption key from environment (must be 32 bytes for AES-256)
// AES-GCM's standard nonce is 12 bytes (NIST SP 800-38D 5.2.1.1): it is used
// directly, while any other length is first folded through GHASH. decrypt() reads the
// IV out of the payload rather than assuming this constant, so narrowing the WRITE
// side does not make previously written payloads unreadable.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ============================================================================
// Types
// ============================================================================

export const ITSMVendorSchema = z.enum([
  'servicenow',
  'jira',
  'zendesk',
  'freshservice',
  'bmc-helix',
  'ivanti',
  'manageengine',
  'generic_webhook',
]);
export type ITSMVendor = z.infer<typeof ITSMVendorSchema>;

// Generic webhook configuration (must be defined before ITSMConfigBaseSchema)
export const ITSMGenericWebhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  bodyTemplate: z.string().min(1),
  signingAlgorithm: z.enum(['hmac-sha256', 'hmac-sha512']).optional(),
  retryPolicy: z.object({
    maxAttempts: z.number().min(1).max(10).default(3),
    initialDelayMs: z.number().min(100).default(1000),
    maxDelayMs: z.number().min(1000).default(30000),
    backoffMultiplier: z.number().min(1).max(5).default(2),
  }).optional(),
});
export type ITSMGenericWebhookConfig = z.infer<typeof ITSMGenericWebhookConfigSchema>;

// Base config (non-sensitive)
export const ITSMConfigBaseSchema = z.object({
  vendor: ITSMVendorSchema,
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  // Connection settings (non-sensitive)
  instanceUrl: z.string().url().optional(),
  table: z.string().optional(), // For ServiceNow
  projectKey: z.string().optional(), // For Jira
  subdomain: z.string().optional(), // For Zendesk, Freshservice
  // Generic webhook config
  genericWebhook: ITSMGenericWebhookConfigSchema.optional(),
  // Timestamps
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastTestAt: z.string().optional(),
  lastTestResult: z.enum(['success', 'failed', 'not_tested']).default('not_tested'),
});
export type ITSMConfigBase = z.infer<typeof ITSMConfigBaseSchema>;

// Sensitive config (encrypted at rest)
export const ITSMCredentialsSchema = z.object({
  // OAuth
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  // Basic/API Token
  username: z.string().optional(),
  password: z.string().optional(),
  apiToken: z.string().optional(),
  // Webhook
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
  // Generic Webhook signing secret
  signingSecret: z.string().optional(),
});
export type ITSMCredentials = z.infer<typeof ITSMCredentialsSchema>;

// Full config (not stored directly)
export type ITSMFullConfig = ITSMConfigBase & {
  credentials?: ITSMCredentials;
  genericWebhook?: ITSMGenericWebhookConfig;
};

// Redis storage format
const ITSMStoredConfigSchema = z.object({
  base: ITSMConfigBaseSchema,
  encryptedCredentials: z.string().optional(), // AES-GCM encrypted JSON
});
type ITSMStoredConfig = z.infer<typeof ITSMStoredConfigSchema>;

// Create/Update request
export const CreateITSMConfigSchema = z.object({
  name: z.string().min(1).max(100),
  vendor: ITSMVendorSchema,
  enabled: z.boolean().default(true),
  instanceUrl: z.string().url().optional(),
  table: z.string().optional(),
  projectKey: z.string().optional(),
  subdomain: z.string().optional(),
  genericWebhook: ITSMGenericWebhookConfigSchema.optional(),
  credentials: ITSMCredentialsSchema.optional(),
});
export type CreateITSMConfigRequest = z.infer<typeof CreateITSMConfigSchema>;

export const UpdateITSMConfigSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  instanceUrl: z.string().url().optional(),
  table: z.string().optional(),
  projectKey: z.string().optional(),
  subdomain: z.string().optional(),
  genericWebhook: ITSMGenericWebhookConfigSchema.optional(),
  credentials: ITSMCredentialsSchema.optional(),
  clearCredentials: z.boolean().optional(),
});
export type UpdateITSMConfigRequest = z.infer<typeof UpdateITSMConfigSchema>;

// ============================================================================
// Redis Client
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
  }
  return redis;
}

// Keys
const ITSM_KEY_PREFIX = 'itsm:config';
const ITSM_INDEX_KEY = 'itsm:vendors';

// ============================================================================
// In-Memory Fallback
// ============================================================================

const memoryStore: {
  configs: Map<string, ITSMStoredConfig>;
} = {
  configs: new Map(),
};

// ============================================================================
// Encryption Utilities
// ============================================================================

/** Minimum configured secret length. 32 chars is the length of the hex-encoded
 *  128-bit secret an operator would naturally generate; anything shorter is a
 *  human-typed password and is refused rather than stretched. */
export const MIN_ENCRYPTION_KEY_LENGTH = 32;

/**
 * Derive the AES-256 key from the configured secret.
 *
 * WAS: `Buffer.from(encryptionKey.slice(0, 32).padEnd(32, '0'))` — truncate to 32
 * CHARACTERS and pad with ASCII '0'. Accurate about producing 32 bytes, and answering
 * a different question than the one being asked, which is whether those are 32 bytes
 * of ENTROPY. Two ways it silently lost entropy:
 *
 *   · A short secret was STRETCHED, not refused. `ITSM_ENCRYPTION_KEY=secret` yielded
 *     `secret` + 26 literal zero bytes — an AES-256 key with ~48 bits behind it.
 *   · The natural way to configure 32 bytes is 64 hex characters. `slice(0, 32)` took
 *     the first 32 of those, i.e. 16 bytes of entropy, and reported success.
 *
 * Fail-closed doctrine says an unknown or under-specified input must TIGHTEN the
 * answer. A weak key now throws; it is never padded into looking adequate.
 *
 * The sibling store in this same package already had this right —
 * `webhooks/store.ts` derives with `createHash('sha256')`. Two stores, one package,
 * two answers to the same question, and the weaker one held vendor API tokens.
 *
 * SHA-256 maps any secret of adequate length onto the full 32-byte key space without
 * truncating. This is a KEY-DERIVATION change: ciphertext written by the previous
 * implementation cannot be decrypted by this one. That is safe here and only here —
 * the config half of this store is wired to nothing (`itsm/index.ts` deliberately
 * exports only resolve+adapter, and no api-server route reaches it), so no stored
 * ciphertext exists to migrate. Anything that wires it up inherits this derivation.
 */
function getEncryptionKey(): Buffer {
  const encryptionKey = process.env.ITSM_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('ITSM encryption key not configured');
  }
  if (encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(
      `ITSM encryption key is too short: ${encryptionKey.length} characters, ` +
        `minimum ${MIN_ENCRYPTION_KEY_LENGTH}. It is refused rather than padded — ` +
        'a stretched short key is an AES-256 key with a password behind it.',
    );
  }
  return crypto.createHash('sha256').update(encryptionKey, 'utf8').digest();
}

/** Exposed for the crypto proof; not part of the store's operational surface. */
export const __cryptoInternals = {
  deriveKey: (): Buffer => getEncryptionKey(),
  encrypt: (plaintext: string): string => encrypt(plaintext),
  decrypt: (payload: string): string => decrypt(payload),
};

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = parts[2];
  
  const key = getEncryptionKey();
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============================================================================
// Store Operations
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Create a new ITSM configuration
 */
export async function createITSMConfig(
  input: CreateITSMConfigRequest
): Promise<ITSMConfigBase & { id: string }> {
  const r = getRedis();
  
  const id = generateId();
  const timestamp = now();
  
  // Build base config
  const base: ITSMConfigBase = {
    vendor: input.vendor,
    name: input.name,
    enabled: input.enabled ?? true,
    instanceUrl: input.instanceUrl,
    table: input.table,
    projectKey: input.projectKey,
    subdomain: input.subdomain,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTestResult: 'not_tested',
  };
  
  // Encrypt credentials if provided
  let encryptedCredentials: string | undefined;
  if (input.credentials) {
    const credsJson = JSON.stringify(input.credentials);
    encryptedCredentials = encrypt(credsJson);
  }
  
  const stored: ITSMStoredConfig = {
    base,
    encryptedCredentials,
  };
  
  // Store
  if (r) {
    await r.set(`${ITSM_KEY_PREFIX}:${id}`, JSON.stringify(stored));
    await r.sadd(ITSM_INDEX_KEY, id);
  } else {
    memoryStore.configs.set(id, stored);
  }
  
  return { id, ...base };
}

/**
 * Get ITSM configuration by ID (without credentials)
 */
export async function getITSMConfig(id: string): Promise<(ITSMConfigBase & { id: string }) | null> {
  const r = getRedis();
  
  let stored: ITSMStoredConfig | undefined;
  
  if (r) {
    const data = await r.get(`${ITSM_KEY_PREFIX}:${id}`);
    if (!data) return null;
    stored = JSON.parse(data);
  } else {
    stored = memoryStore.configs.get(id);
  }
  
  if (!stored) return null;
  
  return { id, ...stored.base };
}

/**
 * Get ITSM configuration by ID (with credentials, for internal use)
 */
export async function getITSMConfigWithCredentials(
  id: string
): Promise<(ITSMFullConfig & { id: string }) | null> {
  const r = getRedis();
  
  let stored: ITSMStoredConfig | undefined;
  
  if (r) {
    const data = await r.get(`${ITSM_KEY_PREFIX}:${id}`);
    if (!data) return null;
    stored = JSON.parse(data);
  } else {
    stored = memoryStore.configs.get(id);
  }
  
  if (!stored) return null;
  
  let credentials: ITSMCredentials | undefined;
  if (stored.encryptedCredentials) {
    try {
      const decrypted = decrypt(stored.encryptedCredentials);
      credentials = JSON.parse(decrypted);
    } catch (err) {
      console.error('Failed to decrypt ITSM credentials:', err);
    }
  }
  
  return { id, ...stored.base, credentials };
}

/**
 * Get all ITSM configurations
 */
export async function listITSMConfigs(): Promise<(ITSMConfigBase & { id: string })[]> {
  const r = getRedis();
  
  let ids: string[];
  
  if (r) {
    ids = await r.smembers(ITSM_INDEX_KEY);
  } else {
    ids = Array.from(memoryStore.configs.keys());
  }
  
  const configs: (ITSMConfigBase & { id: string })[] = [];
  
  for (const id of ids) {
    const config = await getITSMConfig(id);
    if (config) {
      configs.push(config);
    }
  }
  
  return configs;
}

/**
 * Get ITSM config by vendor name
 */
export async function getITSMConfigByVendor(
  vendor: ITSMVendor
): Promise<(ITSMFullConfig & { id: string }) | null> {
  const configs = await listITSMConfigs();
  
  for (const config of configs) {
    if (config.vendor === vendor && config.enabled) {
      return getITSMConfigWithCredentials(config.id);
    }
  }
  
  return null;
}

/**
 * Update ITSM configuration
 */
export async function updateITSMConfig(
  id: string,
  input: UpdateITSMConfigRequest
): Promise<(ITSMConfigBase & { id: string }) | null> {
  const r = getRedis();
  
  let stored: ITSMStoredConfig | undefined;
  
  if (r) {
    const data = await r.get(`${ITSM_KEY_PREFIX}:${id}`);
    if (!data) return null;
    stored = JSON.parse(data);
  } else {
    stored = memoryStore.configs.get(id);
  }
  
  if (!stored) return null;
  
  // Update base config
  const updatedBase: ITSMConfigBase = {
    ...stored.base,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.enabled !== undefined && { enabled: input.enabled }),
    ...(input.instanceUrl !== undefined && { instanceUrl: input.instanceUrl }),
    ...(input.table !== undefined && { table: input.table }),
    ...(input.projectKey !== undefined && { projectKey: input.projectKey }),
    ...(input.subdomain !== undefined && { subdomain: input.subdomain }),
    updatedAt: now(),
  };
  
  // Handle credentials
  let encryptedCredentials = stored.encryptedCredentials;
  
  if (input.clearCredentials) {
    encryptedCredentials = undefined;
  } else if (input.credentials) {
    const credsJson = JSON.stringify(input.credentials);
    encryptedCredentials = encrypt(credsJson);
  }
  
  const updated: ITSMStoredConfig = {
    base: updatedBase,
    encryptedCredentials,
  };
  
  // Store
  if (r) {
    await r.set(`${ITSM_KEY_PREFIX}:${id}`, JSON.stringify(updated));
  } else {
    memoryStore.configs.set(id, updated);
  }
  
  return { id, ...updatedBase };
}

/**
 * Delete ITSM configuration
 */
export async function deleteITSMConfig(id: string): Promise<boolean> {
  const r = getRedis();
  
  let existed = false;
  
  if (r) {
    const data = await r.get(`${ITSM_KEY_PREFIX}:${id}`);
    if (data) {
      existed = true;
      await r.del(`${ITSM_KEY_PREFIX}:${id}`);
      await r.srem(ITSM_INDEX_KEY, id);
    }
  } else {
    existed = memoryStore.configs.has(id);
    if (existed) {
      memoryStore.configs.delete(id);
    }
  }
  
  return existed;
}

/**
 * Update last test result
 */
export async function updateLastTestResult(
  id: string,
  result: 'success' | 'failed'
): Promise<void> {
  const r = getRedis();
  
  let stored: ITSMStoredConfig | undefined;
  
  if (r) {
    const data = await r.get(`${ITSM_KEY_PREFIX}:${id}`);
    if (!data) return;
    stored = JSON.parse(data);
  } else {
    stored = memoryStore.configs.get(id);
  }
  
  if (!stored) return;
  
  stored.base.lastTestAt = now();
  stored.base.lastTestResult = result;
  
  if (r) {
    await r.set(`${ITSM_KEY_PREFIX}:${id}`, JSON.stringify(stored));
  } else {
    memoryStore.configs.set(id, stored);
  }
}

// ============================================================================
// Ticket Templates
// ============================================================================

export const TicketTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'informational']),
  titleTemplate: z.string(),
  descriptionTemplate: z.string(),
});
export type TicketTemplate = z.infer<typeof TicketTemplateSchema>;

const TICKET_TEMPLATES_KEY = 'itsm:templates';

// Default templates
const DEFAULT_TEMPLATES: TicketTemplate[] = [
  {
    id: 'badge_mismatch',
    name: 'Badge ID Mismatch',
    description: 'Badge UID does not match expected user mapping',
    category: 'authentication_failure',
    severity: 'high',
    titleTemplate: 'Badge ID Mismatch - {{badgeUid}}',
    descriptionTemplate: `A badge scan detected a UID that does not match any enrolled user mapping.

**Event Details:**
- Badge UID: {{badgeUid}}
- Reader Type: {{readerType}}
- Device ID: {{deviceId}}
- Timestamp: {{timestamp}}

**Possible Causes:**
- Unenrolled badge
- Badge reassigned to different user
- Badge cloned or duplicated

Please investigate and take appropriate action.`,
  },
  {
    id: 'repeated_auth_failure',
    name: 'Repeated Authentication Failures',
    description: 'Multiple consecutive authentication failures for the same device',
    category: 'authentication_failure',
    severity: 'medium',
    titleTemplate: 'Repeated Auth Failures - Device {{deviceId}}',
    descriptionTemplate: `Multiple authentication failures have occurred for the same device.

**Device Information:**
- Device ID: {{deviceId}}
- Serial: {{serialNumber}}
- Platform: {{devicePlatform}}

**Failure Details:**
- Failure Count: {{failureCount}}
- Time Window: {{timeWindow}}
- First Failure: {{firstFailureTime}}
- Last Failure: {{lastFailureTime}}

This may indicate:
- Brute force attack attempt
- Device configuration issue
- Credential problems

Please investigate and consider temporarily locking the device.`,
  },
  {
    id: 'device_out_of_zone',
    name: 'Device Out of Allowed Zone',
    description: 'Device detected in location outside of allowed policy zone',
    category: 'location_violation',
    severity: 'medium',
    titleTemplate: 'Zone Violation - Device {{deviceId}}',
    descriptionTemplate: `A device has been detected in a location outside of its allowed zone.

**Device Information:**
- Device ID: {{deviceId}}
- User: {{userName}}
- Expected Zone: {{expectedZone}}

**Location Details:**
- Detected Location: {{detectedLocation}}
- Location Mode: {{locationMode}}
- Timestamp: {{timestamp}}

**Policy:**
- Policy Name: {{policyName}}
- Policy ID: {{policyId}}

Device access should be restricted until the device returns to an authorized zone.`,
  },
  {
    id: 'nac_quarantine_applied',
    name: 'NAC Quarantine Applied',
    description: 'Network Access Control has quarantined a device',
    category: 'network_security',
    severity: 'high',
    titleTemplate: 'NAC Quarantine - Device {{deviceId}}',
    descriptionTemplate: `A device has been quarantined by Network Access Control (NAC).

**Device Information:**
- Device ID: {{deviceId}}
- MAC Address: {{macAddress}}
- Serial: {{serialNumber}}

**Quarantine Details:**
- NAC System: {{nacSystem}}
- Reason: {{quarantineReason}}
- Applied At: {{timestamp}}

**Actions Taken:**
- Network access restricted via {{nacSystem}}
- Device moved to quarantine VLAN
- Admin notified

**Policy Trigger:**
- Policy Name: {{policyName}}

Please investigate the reason for quarantine and clear once resolved.`,
  },
  {
    id: 'lost_device',
    name: 'Lost Device',
    description: 'A device has been reported as lost or stolen',
    category: 'hardware_issue',
    severity: 'high',
    titleTemplate: 'Lost Device Alert - {{deviceName}}',
    descriptionTemplate: `A device has been reported as lost or stolen.

**Device Information:**
- Device ID: {{deviceId}}
- Platform: {{devicePlatform}}
- Last Known Location: {{location}}

**Reported By:** {{userName}} ({{userEmail}})
**Reported At:** {{timestamp}}

Please quarantine this device immediately and initiate recovery procedures.`,
  },
  {
    id: 'auth_failure_spike',
    name: 'Authentication Failure Spike',
    description: 'Multiple authentication failures detected for a user or device',
    category: 'authentication_failure',
    severity: 'medium',
    titleTemplate: 'Auth Failure Spike - {{userName}}',
    descriptionTemplate: `Multiple authentication failures have been detected.

**User Information:**
- User ID: {{userId}}
- User Name: {{userName}}
- Email: {{userEmail}}

**Failure Details:**
- Failure Count: {{failureCount}}
- Time Window: {{timeWindow}}
- Device ID: {{deviceId}}
- IP Address: {{ipAddress}}

Please investigate for potential credential compromise or brute force attack.`,
  },
  {
    id: 'noncompliant_device',
    name: 'Non-Compliant Device',
    description: 'A device has failed compliance checks',
    category: 'policy_violation',
    severity: 'medium',
    titleTemplate: 'Non-Compliant Device - {{deviceName}}',
    descriptionTemplate: `A device has failed compliance checks and requires attention.

**Device Information:**
- Device ID: {{deviceId}}
- Platform: {{devicePlatform}}
- OS Version: {{osVersion}}

**Compliance Failures:**
{{complianceFailures}}

**Policy:** {{policyName}}
**Checked At:** {{timestamp}}

Please remediate the compliance issues or quarantine the device.`,
  },
  {
    id: 'policy_quarantine',
    name: 'Policy-Quarantined Device',
    description: 'A device has been quarantined by policy engine',
    category: 'device_quarantine',
    severity: 'high',
    titleTemplate: 'Device Quarantined by Policy - {{deviceName}}',
    descriptionTemplate: `A device has been automatically quarantined by the policy engine.

**Device Information:**
- Device ID: {{deviceId}}
- Platform: {{devicePlatform}}
- Serial: {{serialNumber}}

**Quarantine Reason:**
{{quarantineReason}}

**Triggering Policy:**
- Policy ID: {{policyId}}
- Policy Name: {{policyName}}
- Matched At: {{timestamp}}

**Actions Taken:**
- Device quarantined in UEM
- Network access restricted
- Admin notified

Please investigate and clear quarantine once issue is resolved.`,
  },
];

/**
 * Get all ticket templates
 */
export async function getTicketTemplates(): Promise<TicketTemplate[]> {
  const r = getRedis();
  
  if (r) {
    const data = await r.get(TICKET_TEMPLATES_KEY);
    if (data) {
      return JSON.parse(data);
    }
  }
  
  // Return default templates
  return DEFAULT_TEMPLATES;
}

/**
 * Get ticket template by ID
 */
export async function getTicketTemplate(id: string): Promise<TicketTemplate | null> {
  const templates = await getTicketTemplates();
  return templates.find(t => t.id === id) || null;
}

/**
 * Create a new ticket template
 */
export async function createTicketTemplate(
  template: Omit<TicketTemplate, 'id'>
): Promise<TicketTemplate> {
  const r = getRedis();
  const id = `custom-${Date.now()}`;
  const newTemplate: TicketTemplate = {
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    severity: template.severity,
    titleTemplate: template.titleTemplate,
    descriptionTemplate: template.descriptionTemplate,
  };
  
  const templates = await getTicketTemplates();
  templates.push(newTemplate);
  
  if (r) {
    await r.set(TICKET_TEMPLATES_KEY, JSON.stringify(templates));
  }
  
  return newTemplate;
}

/**
 * Update an existing ticket template
 */
export async function updateTicketTemplate(
  id: string,
  updates: Partial<Omit<TicketTemplate, 'id'>>
): Promise<TicketTemplate | null> {
  const r = getRedis();
  const templates = await getTicketTemplates();
  
  const index = templates.findIndex(t => t.id === id);
  if (index === -1) {
    return null;
  }
  
  const updated: TicketTemplate = {
    ...templates[index],
    ...updates,
  };
  
  templates[index] = updated;
  
  if (r) {
    await r.set(TICKET_TEMPLATES_KEY, JSON.stringify(templates));
  }
  
  return updated;
}

/**
 * Delete a ticket template
 */
export async function deleteTicketTemplate(id: string): Promise<boolean> {
  const r = getRedis();
  const templates = await getTicketTemplates();
  
  const index = templates.findIndex(t => t.id === id);
  if (index === -1) {
    return false;
  }
  
  templates.splice(index, 1);
  
  if (r) {
    await r.set(TICKET_TEMPLATES_KEY, JSON.stringify(templates));
  }
  
  return true;
}

/**
 * Seed default templates (for initialization)
 */
export async function seedTicketTemplates(): Promise<void> {
  const r = getRedis();
  
  if (r) {
    // Only seed if not already present
    const existing = await r.get(TICKET_TEMPLATES_KEY);
    if (!existing) {
      await r.set(TICKET_TEMPLATES_KEY, JSON.stringify(DEFAULT_TEMPLATES));
    }
  }
}

// ============================================================================
// Template Variable Substitution
// ============================================================================

/**
 * Substitute {{key}} variables in template strings.
 *
 * Two injection surfaces are closed here, both inherited byte-identical from
 * the legacy DEV repo (its REMEDIATION_ROADMAP called this out and the fix was
 * never written there either):
 *
 * 1. The replacement is a FUNCTION, never a string. `String.replace` treats a
 *    string replacement as a pattern language — a variable VALUE containing
 *    `$&`, `$'`, `` $` `` or `$1` is expanded against the match instead of
 *    inserted verbatim, so ticket text built from signal evidence (which the
 *    caller does not control) could be silently rewritten. A function's return
 *    value is inserted literally, with no expansion.
 * 2. The KEY is regex-escaped before it is compiled. Keys are internal names
 *    today, but "internal today" is not a property the compiler enforces, and
 *    an unescaped `(` in a key is a crash while an unescaped `.` is a silent
 *    wrong match.
 */
export function substituteTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, "g");
    const replacement = value || `[${key} missing]`;
    result = result.replace(regex, () => replacement);
  }

  return result;
}
