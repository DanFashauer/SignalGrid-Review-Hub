import { signWebhook } from "./sign";
import type { IntegrationEvent } from "./types";

type WebhookTarget = { url: string; secret: string };

const TARGETS: WebhookTarget[] = []; // TODO: admin-managed list (future /admin/integrations)

export async function dispatchIntegrationEvent(evt: IntegrationEvent) {
  if (!TARGETS.length) return;

  const body = JSON.stringify(evt);

  await Promise.allSettled(
    TARGETS.map(async (t) => {
      const sig = signWebhook(body, t.secret);
      await fetch(t.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": sig,
        },
        body,
      });
    })
  );
}
