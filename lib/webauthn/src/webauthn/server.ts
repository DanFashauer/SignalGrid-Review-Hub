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
  getStepUpSession,
  advanceCredentialCounter,
} from './store';
import {
  extractCredentialPublicKey,
  extractAuthData,
  verifyAssertionSignature,
  verifyAttestation,
  rpIdHashMatches,
  isUserPresent,
  isUserVerified,
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
  displayName: string,
  context?: Record<string, string>
): Promise<RegistrationOptions & { challengeId: string }> {
  const config = getWebAuthnConfig();
  const challenge = generateChallenge();
  const challengeId = generateCredentialId();

  // ONE challenge record, saved here and returned by id — the caller must not mint
  // and save a second copy (the earlier double-save left the internal record
  // unreachable and grew the store; adversarial-review finding).
  await saveChallenge(challengeId, {
    challenge,
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(), // 60s
    purpose: 'registration',
    userId,
    context,
  });

  return {
    challengeId,
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
      // No `authenticatorAttachment` restriction: SignalGrid's step-up IS the device
      // owner's own authenticator (Face ID / Touch ID — a PLATFORM authenticator, via
      // LAContext.deviceOwnerAuthentication on the shared device), so restricting to
      // 'cross-platform' would exclude the exact mechanism the product uses AND advertise
      // a flow a faithful client cannot complete. Both platform and cross-platform
      // (security-key) authenticators are permitted; UV below is what carries the security.
      requireResidentKey: false,
      // Create UV-capable credentials so the step-up path can require UV.
      userVerification: 'required',
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

  // A malformed CALL SHAPE is a refusal, not a crash. Everything below assumes
  // the WebAuthn envelope fields exist and are strings; a caller handing this
  // function a placeholder object used to surface as an unhandled TypeError —
  // an HTTP 500 — where fail-closed demands a clean rejection. Found by the
  // Bruno live run, whose ordered execution minted a real challenge and then
  // submitted a non-WebAuthn body against it. Checked BEFORE the challenge is
  // consumed, so a malformed attempt does not burn a valid ceremony.
  if (
    typeof response?.response?.clientDataJSON !== 'string' ||
    typeof response?.response?.attestationObject !== 'string'
  ) {
    return { success: false, error: 'Malformed WebAuthn registration response', timestamp };
  }

  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { success: false, error: 'Challenge not found or expired', timestamp };
  }

  // Enforce expiry, purpose, and user binding independently of the backing
  // store's TTL (the in-memory fallback has none): reject a stale challenge, one
  // minted for authentication, or one bound to a different user.
  // UNPARSEABLE MEANS EXPIRED. `Date.parse` returns NaN on a malformed value,
  // and every comparison with NaN is false — so the bare `< Date.now()` form
  // read a challenge with a corrupt `expiresAt` as NOT expired and accepted it.
  // That is the fail-closed rule inverted on an authentication surface: the one
  // input we cannot interpret was the one that bought unlimited time.
  const expiresAtMs = Date.parse(challengeData.challenge.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    return { success: false, error: 'Challenge expired', timestamp };
  }
  if (challengeData.challenge.purpose !== 'registration') {
    return { success: false, error: 'Challenge purpose mismatch', timestamp };
  }
  if (challengeData.challenge.userId !== undefined && challengeData.challenge.userId !== userId) {
    return { success: false, error: 'Challenge user mismatch', timestamp };
  }

  // Parse client data JSON (WebAuthn base64url-encodes clientDataJSON). A
  // payload that does not decode to JSON is the same refusal as a bad shape.
  let clientData;
  try {
    clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString()
    );
  } catch {
    return { success: false, error: 'Malformed clientDataJSON', timestamp };
  }

  // Verify challenge matches
  if (clientData.challenge !== challengeData.challenge.challenge) {
    return { success: false, error: 'Challenge mismatch', timestamp };
  }

  // Verify origin — EXACT match. A prefix check (startsWith) would accept a
  // look-alike origin like `https://good.example.evil.com`, so require equality.
  const config = getWebAuthnConfig();
  if (clientData.origin !== config.origin) {
    return { success: false, error: 'Invalid origin', timestamp };
  }

  // Verify type
  if (clientData.type !== 'webauthn.create') {
    return { success: false, error: 'Invalid credential type', timestamp };
  }

  // Verify the attestation STATEMENT before trusting the credential, with the
  // accepted-format policy stated EXPLICITLY at the call site: `none`
  // (self-attested) is accepted by current policy; `packed` and `fido-u2f` are
  // cryptographically verified over authData || SHA-256(clientDataJSON); any
  // format outside the allowlist, or a bad signature, is refused (fail closed).
  // Tightening policy to exclude `none` is now a one-array change here, not a
  // hunt through callers for who inspects `attested`.
  const attestation = verifyAttestation({
    attestationObjectB64: response.response.attestationObject,
    clientDataJSON: Buffer.from(response.response.clientDataJSON, 'base64url'),
    allowedFormats: ['none', 'packed', 'fido-u2f'],
  });
  if (!attestation.ok) {
    return {
      success: false,
      error: `Attestation verification failed (${attestation.fmt}): ${attestation.error ?? 'invalid'}`,
      timestamp,
    };
  }

  // Validate the authenticatorData flags at registration the same way the
  // authentication path does (WebAuthn §7.1 steps 13–15): the new credential
  // must be bound to OUR rpId, the user must have been present, and — because we
  // request `userVerification: required` in the options — the user must have been
  // verified (biometric / PIN). Fail closed if authData can't be read.
  const regAuthData = extractAuthData(response.response.attestationObject);
  if (!regAuthData) {
    return { success: false, error: 'Unreadable authenticator data', timestamp };
  }
  const config2 = getWebAuthnConfig();
  if (!rpIdHashMatches(regAuthData, config2.rpId)) {
    return { success: false, error: 'rpId hash mismatch', timestamp };
  }
  if (!isUserPresent(regAuthData)) {
    return { success: false, error: 'User presence flag not set', timestamp };
  }
  if (!isUserVerified(regAuthData)) {
    return { success: false, error: 'User verification required for registration', timestamp };
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

  // Seed the stored counter from the REGISTRATION authenticator data, not 0. An
  // authenticator that ships a non-zero signature counter at registration would
  // otherwise be recorded as counter:0, so the FIRST assertion — which the release
  // path now trusts — would accept ANY positive counter, including one equal to or
  // below the registration value presented by a clone. Recording the registration
  // counter means the regression check (newCounter must strictly exceed the stored
  // counter, both non-zero) catches a clone on its very first use. Always-zero
  // authenticators register 0 and stay exempt, exactly as the spec allows.
  // (Adversarial-review finding, complements the non-zero-to-zero reset check.)
  const registrationCounter = readSignCount(regAuthData);

  // Store the verifiable key (JWK + alg) so future assertions can be checked
  // cryptographically against it.
  const credential: WebAuthnCredential = {
    id: credentialId,
    publicKey: JSON.stringify(verifiable),
    counter: registrationCounter,
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
  userId: string,
  context?: Record<string, string>
): Promise<AuthenticationOptions & { challengeId: string }> {
  const config = getWebAuthnConfig();
  const challenge = generateChallenge();
  const challengeId = generateCredentialId();

  // Get user's credentials
  const credentials = await getCredentialsForUser(userId);

  // ONE challenge record (see generateRegistrationOptions). `context` binds this
  // challenge to the exact pending action; the completion route verifies it.
  await saveChallenge(challengeId, {
    challenge,
    expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    purpose: 'authentication',
    userId,
    context,
  });

  return {
    challengeId,
    challenge,
    timeout: 60000,
    rpId: config.rpId,
    allowCredentials: credentials.map(c => ({
      id: c.id,
      type: 'public-key',
    })),
    // Step-up demands verified users (biometric / PIN), enforced at verify time.
    userVerification: 'required',
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

  // Same shape refusal as verifyRegistration, same reason, same ordering:
  // checked before the challenge is consumed.
  if (
    typeof response?.response?.clientDataJSON !== 'string' ||
    typeof response?.response?.authenticatorData !== 'string' ||
    typeof response?.response?.signature !== 'string'
  ) {
    return { success: false, error: 'Malformed WebAuthn authentication response', timestamp };
  }

  // Get and delete challenge
  const challengeData = await getAndDeleteChallenge(challengeId);
  if (!challengeData) {
    return { success: false, error: 'Challenge not found or expired', timestamp };
  }

  // Enforce expiry, purpose, and user binding independently of store TTL: reject
  // a stale challenge, one minted for registration, or one bound to another user.
  // UNPARSEABLE MEANS EXPIRED. `Date.parse` returns NaN on a malformed value,
  // and every comparison with NaN is false — so the bare `< Date.now()` form
  // read a challenge with a corrupt `expiresAt` as NOT expired and accepted it.
  // That is the fail-closed rule inverted on an authentication surface: the one
  // input we cannot interpret was the one that bought unlimited time.
  const expiresAtMs = Date.parse(challengeData.challenge.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
    return { success: false, error: 'Challenge expired', timestamp };
  }
  if (challengeData.challenge.purpose !== 'authentication') {
    return { success: false, error: 'Challenge purpose mismatch', timestamp };
  }
  if (challengeData.challenge.userId !== undefined && challengeData.challenge.userId !== userId) {
    return { success: false, error: 'Challenge user mismatch', timestamp };
  }

  // Verify challenge matches (clientDataJSON is base64url-encoded). A payload
  // that does not decode to JSON is the same refusal as a bad shape.
  const clientDataBytes = Buffer.from(response.response.clientDataJSON, 'base64url');
  let clientData;
  try {
    clientData = JSON.parse(clientDataBytes.toString());
  } catch {
    return { success: false, error: 'Malformed clientDataJSON', timestamp };
  }

  if (clientData.challenge !== challengeData.challenge.challenge) {
    return { success: false, error: 'Challenge mismatch', timestamp };
  }

  // Verify origin — EXACT match (see verifyRegistration for why a prefix check
  // is unsafe).
  const config = getWebAuthnConfig();
  if (clientData.origin !== config.origin) {
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
  // A step-up is a high-assurance gate: require User Verification (biometric /
  // PIN), not merely user presence. Options request `userVerification: required`.
  if (!isUserVerified(authenticatorData)) {
    await appendAuditRecord(
      'security.webauthn.step_up.failure',
      { type: 'user', id: userId },
      { meta: { credentialId: credential.id, reason: 'user_verification_missing' } }
    );
    return { success: false, error: 'User verification required for step-up', timestamp };
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
  // A credential that has ALREADY advanced (stored counter > 0) reporting 0 now is a
  // cloned authenticator whose counter reset — and the general regression check below
  // MISSES it, because it only fires when BOTH counters are non-zero. A once-advanced
  // credential can never legitimately return to a zero counter, so reject it before the
  // spec exemption for always-zero authenticators can launder the clone through.
  if (credential.counter > 0 && newCounter === 0) {
    await appendAuditRecord(
      'security.webauthn.step_up.failure',
      { type: 'user', id: userId },
      { meta: { credentialId: credential.id, reason: 'counter_reset_to_zero' } }
    );
    return { success: false, error: 'Authenticator counter reset to zero (possible clone)', timestamp };
  }
  if (newCounter !== 0 && credential.counter !== 0 && newCounter <= credential.counter) {
    await appendAuditRecord(
      'security.webauthn.step_up.failure',
      { type: 'user', id: userId },
      { meta: { credentialId: credential.id, reason: 'counter_regression' } }
    );
    return { success: false, error: 'Authenticator counter did not increase (possible clone)', timestamp };
  }

  // Persist the advanced counter ATOMICALLY. Compare-and-advance against the exact
  // counter we ran the clone-regression check against (`credential.counter`): if a
  // concurrent completion already advanced the stored counter, the CAS fails and we fail
  // closed. A naive getUser→mutate→saveUser here let two valid challenges for the same
  // credential both pass the regression check against the same stored counter and then
  // write out of order, so the LOWER counter could overwrite the higher — after which a
  // clone can re-present the already-used higher count and pass. The CAS makes exactly
  // one writer win.
  if (newCounter > credential.counter) {
    const advanced = await advanceCredentialCounter(
      userId,
      credential.id,
      credential.counter,
      newCounter,
      timestamp,
    );
    if (!advanced) {
      await appendAuditRecord(
        'security.webauthn.step_up.failure',
        { type: 'user', id: userId },
        { meta: { credentialId: credential.id, reason: 'counter_advance_conflict' } }
      );
      return {
        success: false,
        error: 'Concurrent counter advance detected (possible clone/replay)',
        timestamp,
      };
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
 * Verify a step-up session is valid
 */
export async function verifyStepUp(sessionId: string): Promise<StepUpSession | null> {
  const session = await getStepUpSession(sessionId);
  
  if (!session) {
    return null;
  }

  // Check expiration
  // TENTH SITE of the same family, and the one that survived the sweep that was
  // supposed to end it. `new Date(bad)` is an Invalid Date; a relational compare
  // coerces both sides to numbers, `NaN < now` is false, and the step-up session
  // fell through and returned as VALID.
  //
  // It survived because the gate written to catch this family only recognised
  // `Date.parse(...)` and `.getTime()` as parse expressions — a bare `new Date(x)`
  // on one side of `<` matched nothing, so the scan reported zero and the sweep
  // read as complete. Found by external review after the in-repo reviewer passed
  // the same change. PARSE_EXPR now covers this form.
  const sessionExpiresAtMs = new Date(session.expiresAt).getTime();
  if (!Number.isFinite(sessionExpiresAtMs) || sessionExpiresAtMs < Date.now()) {
    return null;
  }

  return session;
}
