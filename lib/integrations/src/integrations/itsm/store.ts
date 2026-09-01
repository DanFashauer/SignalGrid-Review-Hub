/**
 * ITSM Credential Store
 *
 * Type/schema definitions shared with the vendor adapter, plus the encryption
 * primitives used by the crypto proof and the template-substitution utility
 * used by the template proof. The CRUD/persistence half of this module
 * (Redis- or memory-backed config storage, ticket-template storage) was
 * removed as dead code: `itsm/index.ts` deliberately exports only
 * `resolve`+`adapter`, no api-server route reaches this store, and the sole
 * caller of the CRUD functions was a test importing a `@/*` alias that
 * resolves nowhere in this repo's tsconfigs.
 */

import crypto from 'crypto';
import { z } from 'zod';

// ============================================================================
// Environment & Config
// ============================================================================

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
