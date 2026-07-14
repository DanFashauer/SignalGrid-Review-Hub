import crypto from "crypto";

export function signWebhook(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}
