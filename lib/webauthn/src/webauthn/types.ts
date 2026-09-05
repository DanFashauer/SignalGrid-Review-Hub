// WebAuthn/FIDO2 Types
// Web Authentication API types for security key (YubiKey) support

/**
 * WebAuthn Relying Party configuration
 */
export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origin: string;
  requireStepUpForAdmin: boolean;
}

/**
 * Registered credential for a user
 */
export interface WebAuthnCredential {
  id: string;
  publicKey: string;
  counter: number;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * User's WebAuthn credentials
 */
export interface WebAuthnUser {
  userId: string;
  credentials: WebAuthnCredential[];
  createdAt: string;
}

/**
 * Challenge generated for registration or authentication
 */
export interface WebAuthnChallenge {
  challenge: string;
  expiresAt: string;
  purpose: 'registration' | 'authentication';
  /** The user this challenge was minted for. REQUIRED (2026-09-05): the guard used
   *  to read `userId !== undefined && userId !== caller`, so a challenge saved with
   *  no binding was checked against nobody and a genuinely signed assertion under an
   *  unrelated user was accepted. Reproduced through the public `saveChallenge`. */
  userId: string;
  /** Server-persisted binding of this challenge to the EXACT action it was minted
   *  for (tenant, identity, integration, device). Verified at completion time so a
   *  gesture signed for one pending action can never release a different one — the
   *  guarded values come from this stored record, never from the caller's body. */
  context?: Record<string, string>;
}

/**
 * Client-side registration options (PublicKeyCredentialCreationOptions)
 */
export interface RegistrationOptions {
  challenge: string;
  rp: {
    id: string;
    name: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: {
    type: 'public-key';
    alg: number;
  }[];
  timeout: number;
  excludeCredentials: {
    id: string;
    type: 'public-key';
  }[];
  authenticatorSelection: {
    // Optional, as in the WebAuthn spec: omitting it permits BOTH platform (the
    // device's own Face ID / Touch ID — what SignalGrid step-up uses) and
    // cross-platform (security-key) authenticators.
    authenticatorAttachment?: 'platform' | 'cross-platform';
    requireResidentKey: boolean;
    userVerification: 'required' | 'preferred' | 'discouraged';
  };
  attestation: 'none' | 'indirect' | 'direct';
}

/**
 * Client-side authentication options (PublicKeyCredentialRequestOptions)
 */
export interface AuthenticationOptions {
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials: {
    id: string;
    type: 'public-key';
  }[];
  userVerification: 'required' | 'preferred' | 'discouraged';
}

/**
 * Verification result
 */
export interface VerificationResult {
  success: boolean;
  userId?: string;
  credentialId?: string;
  /** Registration only: true when this credential id was ALREADY enrolled and the
   *  store kept the existing key unchanged. The ceremony verified, nothing was
   *  stored — reported rather than folded into an unearned "enrolled". */
  alreadyEnrolled?: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Step-up session (temporary elevation)
 */
export interface StepUpSession {
  sessionId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  reason?: string;
}

/**
 * Get current WebAuthn configuration from environment
 */
export function getWebAuthnConfig(): WebAuthnConfig {
  return {
    rpId: process.env.WEBAUTHN_RP_ID || 'localhost',
    rpName: process.env.WEBAUTHN_RP_NAME || 'Enterprise Shell',
    origin: process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000',
    requireStepUpForAdmin: process.env.WEBAUTHN_REQUIRE_STEP_UP_FOR_ADMIN === 'true',
  };
}
