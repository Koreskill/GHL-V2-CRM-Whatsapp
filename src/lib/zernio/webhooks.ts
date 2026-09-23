import { createHmac, timingSafeEqual } from "node:crypto";
import { zernioRequest, type Result } from "./client";
import type {
  CreateWebhookBody,
  ListWebhooksResponse,
  WebhookEventName,
  ZernioWebhook,
} from "./types";

export const SIGNATURE_HEADER = "x-zernio-signature";
export const EVENT_ID_HEADER = "x-zernio-event-id";
export const EVENT_HEADER = "x-zernio-event";

export const CRM_WEBHOOK_EVENTS: WebhookEventName[] = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "conversation.started",
  "referral.received",
  "account.connected",
  "account.disconnected",
];

// X-Zernio-Signature = hex(HMAC-SHA256(secret, body crudo)). Fail-closed: sin secreto no valida nada.
export function verifyZernioSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined = process.env.ZERNIO_WEBHOOK_SECRET,
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature.trim().toLowerCase(), "hex");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export function listWebhooks() {
  return zernioRequest<ListWebhooksResponse>("GET", "/v1/webhooks/settings");
}

// Busca por nombre y actualiza si ya existe: Zernio no valida URLs duplicadas.
export async function upsertWebhook(
  input: Omit<CreateWebhookBody, "events"> & { events?: WebhookEventName[] },
): Promise<Result<{ webhook: ZernioWebhook | undefined; action: "created" | "updated" }>> {
  const body = { ...input, events: input.events ?? CRM_WEBHOOK_EVENTS };

  const existing = await listWebhooks();
  if (!existing.success) return existing;
  const match = existing.data.webhooks?.find((w) => w.name === input.name);

  if (match?._id) {
    const res = await zernioRequest<{ webhook?: ZernioWebhook }>("PUT", "/v1/webhooks/settings", {
      body: { ...body, webhookId: match._id, isActive: true },
    });
    return res.success ? { success: true, data: { webhook: res.data.webhook, action: "updated" } } : res;
  }

  const res = await zernioRequest<{ webhook?: ZernioWebhook }>("POST", "/v1/webhooks/settings", { body });
  return res.success ? { success: true, data: { webhook: res.data.webhook, action: "created" } } : res;
}
