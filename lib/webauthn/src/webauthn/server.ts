// WebAuthn Server
// Challenge generation and verification for WebAuthn/FIDO2

import { randomBytes, createHash } from 'crypto';
import type {
  RegistrationOptions,
  AuthenticationOptions,
  VerificationResult,
  WebAuthnCredential,
  StepUpSession,
} from './types';
import {
  getWebAuthnConfig,
  getWebAuthnConfig as getConfig,
} from './types';
import {
  saveChallenge,
  getAndDeleteChallenge,
  addCredential,
  getCredentialsForUser,
  createStepUpSession,
  getStepUpSession,
} from './store';
import { appendAuditRecord } from '@workspace/audit';

/**
 * Generate a random challenge (base64url encoded)
 */
function generateChallenge(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate a unique ID for the credential (base64url encoded)
 */
function generateCredentialId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Convert buffer to base64url
 */
function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  if (buffer instanceof Uint8Array) {
    return Buffer.from(buffer).toString('base64url');
  }
  return Buffer.from(buffer).toString('base64url');
}

/**
 * Convert base64url to ArrayBuffer
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const buffer = Buffer.from(base64url, 'base64url');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Generate registration options for a user
 */
export async function generateRegistrationOptions(
  userId: string,
  userName: string,
  displayName: string
): Promise<RegistrationOptions> {
  const config = getWebAuthnConfig();
  const challenge = generateChallenge();
  const challengeId = generateCredentialId();

  // Save challenge
  await saveChallenge(challengeId, {
    challenge,
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(), // 60s
    purpose: 'registration',
    userId,
  });

  return {
    challenge,
    rp: {
      id: config.rpId,
      name: config.rpName,
    },
    user: {
      id: bufferToBase64url(Buffer.from(userId)),
      name: userName,
      displayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    excludeCredentials: [], // Could check existing credentials here
    authenticatorSelection: {
      authenticatorAttachment: 'cross-platform',
      requireResidentKey: false,
      userVerification: 'preferred',
    },
    attestation: 'none',
  };
}

/**
 * Verify registration response and save credential
 */
export async function verifyRegistration(
  userId: string,
  challengeId: string,
  response: {
    id: string;
    rawId: string;
    response: {
      clientDataJSON: string;
      attestationObject: string;
    };
    type: string;
  }
): Promise<VerificationResult> {
  const timestamp = new Date().toISOString();

  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { success: false, error: 'Challenge not found or expired', timestamp };
  }

  // Parse client data JSON
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64').toString()
  );

  // Verify challenge matches
  if (clientData.challenge !== challengeData.challenge.challenge) {
    return { success: false, error: 'Challenge mismatch', timestamp };
  }

  // Verify origin
  const config = getWebAuthnConfig();
  if (!clientData.origin.startsWith(config.origin)) {
    return { success: false, error: 'Invalid origin', timestamp };
  }

  // Verify type
  if (clientData.type !== 'webauthn.create') {
    return { success: false, error: 'Invalid credential type', timestamp };
  }

  // Parse attestation object (simplified - real implementation would verify signature)
  // In production, you'd parse the CBOR attestationObject and verify the signature
  const attestationObject = Buffer.from(
    response.response.attestationObject,
    'base64'
  );

  // Extract public key from attestation (simplified)
  // Real implementation would use a CBOR library to parse this properly
  const credentialId = response.id || response.rawId;

  // Create credential record
  const credential: WebAuthnCredential = {
    id: credentialId,
    publicKey: bufferToBase64url(attestationObject), // Simplified - store full attestation in production
    counter: 0,
    createdAt: timestamp,
  };

  // Save credential
  await addCredential(userId, credential);

  // Audit
  await appendAuditRecord(
    'security.webauthn.registered',
    { type: 'user', id: userId },
    { meta: { credentialId: credential.id } }
  );

  return {
    success: true,
    userId,
    credentialId: credential.id,
    timestamp,
  };
}

/**
 * Generate authentication options for a user
 */
export async function generateAuthenticationOptions(
  userId: string
): Promise<AuthenticationOptions> {
  const config = getWebAuthnConfig();
  const challenge = generateChallenge();
  const challengeId = generateCredentialId();

  // Get user's credentials
  const credentials = await getCredentialsForUser(userId);

  // Save challenge
  await saveChallenge(challengeId, {
    challenge,
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    purpose: 'authentication',
    userId,
  });

  return {
    challenge,
    timeout: 60000,
    rpId: config.rpId,
    allowCredentials: credentials.map(c => ({
      id: c.id,
      type: 'public-key',
    })),
    userVerification: 'preferred',
  };
}

/**
 * Verify authentication response
 */
export async function verifyAuthentication(
  userId: string,
  challengeId: string,
  response: {
    id: string;
    rawId: string;
    response: {
      clientDataJSON: string;
      authenticatorData: string;
      signature: string;
    };
    type: string;
  }
): Promise<VerificationResult> {
  const timestamp = new Date().toISOString();

  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { success: false, error: 'Challenge not found or expired', timestamp };
  }

  // Verify challenge matches
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64').toString()
  );

  if (clientData.challenge !== challengeData.challenge.challenge) {
    return { success: false, error: 'Challenge mismatch', timestamp };
  }

  // Verify origin
  const config = getWebAuthnConfig();
  if (!clientData.origin.startsWith(config.origin)) {
    return { success: false, error: 'Invalid origin', timestamp };
  }

  // Verify type
  if (clientData.type !== 'webauthn.get') {
    return { success: false, error: 'Invalid credential type', timestamp };
  }

  // Verify credential exists
  const credentials = await getCredentialsForUser(userId);
  const credential = credentials.find(c => c.id === response.id);

  if (!credential) {
    return { success: false, error: 'Credential not found', timestamp };
  }

  // Audit
  await appendAuditRecord(
    'security.webauthn.step_up.success',
    { type: 'user', id: userId },
    { meta: { credentialId: credential.id } }
  );

  return {
    success: true,
    userId,
    credentialId: credential.id,
    timestamp,
  };
}

/**
 * Create a step-up session
 */
export async function createStepUp(
  userId: string,
  ttlSeconds: number = 300,
  reason?: string
): Promise<StepUpSession> {
  const sessionId = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const session: StepUpSession = {
    sessionId,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    reason,
  };

  await createStepUpSession(session);

  return session;
}

/**
 * Verify a step-up session is valid
 */
export async function verifyStepUp(sessionId: string): Promise<StepUpSession | null> {
  const session = await getStepUpSession(sessionId);
  
  if (!session) {
    return null;
  }

  // Check expiration
  if (new Date(session.expiresAt) < new Date()) {
    return null;
  }

  return session;
}
