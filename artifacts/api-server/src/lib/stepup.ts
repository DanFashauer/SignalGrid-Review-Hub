/**
 * Server-issued step-up proof for the app-workflow gate.
 *
 * When a decision is `step_up`, the HOST APP drives the platform's native
 * authenticator (Face ID / Touch ID / Windows Hello / badge tap) — the end user
 * never sees a SignalGrid screen (see docs/EMBEDDED_UX_PRINCIPLE.md). On a
 * successful gesture the server issues a short-lived, HMAC-signed proof bound to
 * the exact (identity, device, workflow). The app then re-evaluates presenting
 * that proof, and the held actions release.
 *
 * The proof is SERVER-ISSUED and server-verified: a caller cannot fabricate one
 * (it never sees the signing key) and cannot self-assert a step-up by sending a
 * boolean. `POST /v1/app-workflows/step-up` is the seam where real WebAuthn
 * assertion verification (the hardened @workspace/webauthn path) plugs in; in
 * this public-safe fixture it stands in for a completed native gesture.
 *
 * The signing key is a NON-SECRET demo default; a real deployment injects
 * STEPUP_SIGNING_KEY. There are no real credentials here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNING_KEY = process.env.STEPUP_SIGNING_KEY?.trim() || "stepup_demo_nonsecret_fixture_key";
const TTL_MS = 120_000; // a completed step-up is good for 2 minutes

interface StepUpPayload {
  a: string; // identityRef
  d: string; // deviceRef
  w: string; // workflowKey
  exp: number; // epoch ms expiry
}

function sign(body: string): string {
  return createHmac("sha256", SIGNING_KEY).update(body).digest("base64url");
}

/** Issue a proof bound to (identity, device, workflow), valid for TTL_MS. */
export function issueStepUpProof(
  identityRef: string,
  deviceRef: string,
  workflowKey: string,
  nowMs: number,
): { stepUpProof: string; expiresInMs: number } {
  const payload: StepUpPayload = { a: identityRef, d: deviceRef, w: workflowKey, exp: nowMs + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { stepUpProof: `${body}.${sign(body)}`, expiresInMs: TTL_MS };
}

/**
 * Verify a proof against the exact (identity, device, workflow) it must be bound
 * to. Fails closed on any tamper, mismatch, or expiry.
 */
export function verifyStepUpProof(
  proof: unknown,
  identityRef: string,
  deviceRef: string,
  workflowKey: string,
  nowMs: number,
): boolean {
  if (typeof proof !== "string" || !proof.includes(".")) return false;
  const [body, sig] = proof.split(".", 2);
  if (!body || !sig) return false;

  // Constant-time signature check.
  const expected = sign(body);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return false;

  let payload: StepUpPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StepUpPayload;
  } catch {
    return false;
  }
  if (payload.a !== identityRef || payload.d !== deviceRef || payload.w !== workflowKey) return false;
  if (typeof payload.exp !== "number" || nowMs > payload.exp) return false;
  return true;
}
