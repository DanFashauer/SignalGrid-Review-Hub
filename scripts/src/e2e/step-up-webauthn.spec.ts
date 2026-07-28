/// <reference lib="dom" />
// The page.evaluate body below runs in the BROWSER, so it uses DOM + WebAuthn
// globals (navigator.credentials, PublicKeyCredential, …). The scripts tsconfig
// targets Node, so this file-scoped DOM lib reference types the in-page code
// without widening the whole package's lib.
import { test, expect } from "@playwright/test";

// Browser-interop proof for the real step-up ceremony.
//
// test:api pins the SERVER's verify logic, but it hand-builds the assertion in
// Node — it never proves a genuine WebAuthn CLIENT interoperates with the
// endpoints. This does: a real Chromium virtual authenticator (Secure-Enclave
// stand-in) runs navigator.credentials.create/get from the console's origin, and
// the endpoints must accept its output and release a held step_up plan. Nothing
// here is fabricated — the browser's WebAuthn stack produces the attestation and
// assertion; we only shuttle bytes between it and /api/v1.
//
// Must match PORTS.admin in ../../playwright.config.ts (the console whose /api/*
// is proxied to the live api-server, with WEBAUTHN_ORIGIN set to this origin).
const CONSOLE = `http://localhost:${Number(process.env.E2E_ADMIN_PORT ?? 4614)}`;

// The held-step_up scenario, same seeds test:api uses.
const IDENTITY = "nurse.baseline_drift";
const DEVICE = "ipad-ward-06";
const INTEGRATION = "bcma";

test("a real browser WebAuthn ceremony releases a held step_up", async ({ page }) => {
  // A user-verified platform authenticator: UV on (our endpoints require it),
  // presence auto-confirmed so no OS gesture is needed in headless.
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });
  expect(authenticatorId).toBeTruthy();

  await page.goto(`${CONSOLE}/`, { waitUntil: "domcontentloaded" });

  // The whole ceremony runs IN THE PAGE so navigator.credentials is the real
  // browser API and the request origin is the page origin.
  const result = await page.evaluate(
    async ({ identity, device, integration }) => {
      const b64urlToBuf = (s: string) => {
        const pad = "=".repeat((4 - (s.length % 4)) % 4);
        const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
      };
      const bufToB64url = (b: ArrayBuffer) => {
        const bytes = new Uint8Array(b);
        let bin = "";
        for (const byte of bytes) bin += String.fromCharCode(byte);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };
      const post = async (path: string, body: unknown, token: string): Promise<{ status: number; json: any }> => {
        const res = await fetch(`/api${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        return { status: res.status, json: await res.json().catch(() => null) };
      };

      // Public demo key (operator) — discovered, not hardcoded.
      const keys = (await (await fetch("/api/v1/keys")).json()) as any;
      const token: string = keys.keys.find((k: { role: string }) => k.role === "operator").token;

      // 1) Enroll — real navigator.credentials.create.
      const enrollOpts = await post("/v1/step-up/enroll/options", { identityRef: identity }, token);
      if (enrollOpts.status !== 200) return { stage: "enroll-options", ...enrollOpts };
      const ro = enrollOpts.json.publicKey;
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: b64urlToBuf(ro.challenge),
          rp: ro.rp,
          user: { id: b64urlToBuf(ro.user.id), name: ro.user.name, displayName: ro.user.displayName },
          pubKeyCredParams: ro.pubKeyCredParams,
          timeout: ro.timeout,
          // Forward the server's ACTUAL authenticatorSelection (no binary fields to
          // convert) rather than substituting our own — otherwise the test could pass
          // while a faithful client that honors the returned options (e.g. an
          // attachment restriction) cannot complete this advertised flow.
          authenticatorSelection: ro.authenticatorSelection ?? { userVerification: "required" },
          attestation: "none",
        },
      })) as PublicKeyCredential;
      const attRes = cred.response as AuthenticatorAttestationResponse;
      const enrollVerify = await post(
        "/v1/step-up/enroll/verify",
        {
          identityRef: identity,
          challengeId: enrollOpts.json.challengeId,
          response: {
            id: cred.id,
            rawId: bufToB64url(cred.rawId),
            type: cred.type,
            response: {
              clientDataJSON: bufToB64url(attRes.clientDataJSON),
              attestationObject: bufToB64url(attRes.attestationObject),
            },
          },
        },
        token,
      );
      if (enrollVerify.status !== 200) return { stage: "enroll-verify", ...enrollVerify };

      // 2) Challenge + real navigator.credentials.get.
      // The challenge is bound to the exact pending action at mint time; completion
      // verifies the binding, so the same integration/device must be named here.
      const chal = await post("/v1/step-up/challenge", { identityRef: identity, integrationId: integration, deviceRef: device }, token);
      if (chal.status !== 200) return { stage: "challenge", ...chal };
      const ao = chal.json.publicKey;
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: b64urlToBuf(ao.challenge),
          rpId: ao.rpId,
          timeout: ao.timeout,
          userVerification: "required",
          allowCredentials: (ao.allowCredentials ?? []).map((c: { id: string }) => ({
            id: b64urlToBuf(c.id),
            type: "public-key",
          })),
        },
      })) as PublicKeyCredential;
      const asrt = assertion.response as AuthenticatorAssertionResponse;

      // 3) Complete — the endpoint verifies the assertion and re-cuts the plan.
      const done = await post(
        "/v1/app-workflows/complete-step-up",
        {
          integrationId: integration,
          identityRef: identity,
          deviceRef: device,
          challengeId: chal.json.challengeId,
          assertion: {
            id: assertion.id,
            rawId: bufToB64url(assertion.rawId),
            type: assertion.type,
            response: {
              clientDataJSON: bufToB64url(asrt.clientDataJSON),
              authenticatorData: bufToB64url(asrt.authenticatorData),
              signature: bufToB64url(asrt.signature),
            },
          },
        },
        token,
      );
      return { stage: "complete", ...done };
    },
    { identity: IDENTITY, device: DEVICE, integration: INTEGRATION },
  );

  // The real browser assertion was accepted and the held plan released.
  expect(result.stage, `failed at ${result.stage}: ${JSON.stringify(result.json)}`).toBe("complete");
  expect(result.status).toBe(200);
  const payload = result.json;
  expect(payload.stepUp?.released, "held step_up released by a real browser assertion").toBe(true);
  expect(payload.stepUp?.method).toBe("webauthn");
  expect(payload.plan?.mode).not.toBe("step_up");
  const held = payload.plan?.actions?.find((a: { key: string }) => a.key === "controlled.administer");
  expect(held?.disposition, "the held controlled action is no longer step_up").not.toBe("step_up");
});
