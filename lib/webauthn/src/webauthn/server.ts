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
  getUser,
  saveUser,
} from './store';
import {
  extractCredentialPublicKey,
  verifyAssertionSignature,
  rpIdHashMatches,
  isUserPresent,
  readSignCount,
  type VerifiableKey,
} from './verify';
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

  // Parse client data JSON (WebAuthn base64url-encodes clientDataJSON).
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, 'base64url').toString()
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

  // Extract the attested credential public key from the attestation object.
  // Fail closed: if the key can't be parsed into a supported (ES256/RS256)
  // verifiable key, we refuse to register it rather than store an unusable
  // credential that would later be un-verifiable.
  const verifiable = extractCredentialPublicKey(response.response.attestationObject);
  if (!verifiable) {
    return {
      success: false,
      error: 'Unsupported or unparseable credential public key',
      timestamp,
    };
  }

  const credentialId = response.id || response.rawId;

  // Store the verifiable key (JWK + alg) so future assertions can be checked
  // cryptographically against it.
  const credential: WebAuthnCredential = {
    id: credentialId,
    publicKey: JSON.stringify(verifiable),
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

  // Verify challenge matches (clientDataJSON is base64url-encoded).
  const clientDataBytes = Buffer.from(response.response.clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataBytes.toString());

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

  // Fail closed: the credential must carry a verifiable public key. Legacy
  // credentials stored before cryptographic verification existed (raw
  // attestation blobs) are not JSON VerifiableKeys and are rejected — they
  // must be re-registered rather than trusted un-verified.
  let key: VerifiableKey;
  try {
    const parsed = JSON.parse(credential.publicKey);
    if (!parsed || typeof parsed !== 'object' || !parsed.jwk || !parsed.alg) {
      throw new Error('not a verifiable key');
    }
    key = parsed as VerifiableKey;
  } catch {
    return {
      success: false,
      error: 'Credential has no verifiable public key — re-registration required',
      timestamp,
    };
  }

  const authenticatorData = Buffer.from(response.response.authenticatorData, 'base64url');
  const signature = Buffer.from(response.response.signature, 'base64url');

  // Bind the assertion to our RP and require user presence.
  if (!rpIdHashMatches(authenticatorData, config.rpId)) {
    return { success: false, error: 'rpId hash mismatch', timestamp };
  }
  if (!isUserPresent(authenticatorData)) {
    return { success: false, error: 'User presence flag not set', timestamp };
  }

  // The core check: verify the authenticator's signature over
  // authenticatorData || SHA-256(clientDataJSON) with the stored public key.
  const signatureValid = verifyAssertionSignature({
    key,
    authenticatorData,
    clientDataJSON: clientDataBytes,
    signature,
  });
  if (!signatureValid) {
    await appendAuditRecord(
      'security.webauthn.step_up.failure',
      { type: 'user', id: userId },
      { meta: { credentialId: credential.id, reason: 'signature_invalid' } }
    );
    return { success: false, error: 'Assertion signature verification failed', timestamp };
  }

  // Signature-counter clone detection: a non-zero counter must strictly
  // increase. (Authenticators that always report 0 are exempt, per spec.)
  const newCounter = readSignCount(authenticatorData);
  if (newCounter !== 0 && credential.counter !== 0 && newCounter <= credential.counter) {
    await appendAuditRecord(
      'security.webauthn.step_up.failure',
      { type: 'user', id: userId },
      { meta: { credentialId: credential.id, reason: 'counter_regression' } }
    );
    return { success: false, error: 'Authenticator counter did not increase (possible clone)', timestamp };
  }

  // Persist the advanced counter + last-used time.
  if (newCounter > credential.counter) {
    const user = await getUser(userId);
    if (user) {
      const stored = user.credentials.find(c => c.id === credential.id);
      if (stored) {
        stored.counter = newCounter;
        stored.lastUsedAt = timestamp;
        await saveUser(user);
      }
    }
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
