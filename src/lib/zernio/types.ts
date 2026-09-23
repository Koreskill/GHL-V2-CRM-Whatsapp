import type { components, paths } from "./openapi";

type Schemas = components["schemas"];
type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;

type Op<P extends keyof paths, M extends keyof paths[P]> = paths[P][M];
type Res200<P extends keyof paths, M extends keyof paths[P]> =
  Op<P, M> extends { responses: { 200: infer R } } ? Json<R> : never;
type Body<P extends keyof paths, M extends keyof paths[P]> =
  Op<P, M> extends { requestBody?: infer B } ? Json<NonNullable<B>> : never;
type Query<P extends keyof paths, M extends keyof paths[P]> =
  Op<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

// ---- REST (lo que devuelve la API). No confundir con los payloads de webhook. ----
export type ListAccountsResponse = Res200<"/v1/accounts", "get">;
export type ZernioAccount = ListAccountsResponse["accounts"][number];
export type ListAccountsQuery = Query<"/v1/accounts", "get">;

export type ConnectUrlResponse = Res200<"/v1/connect/{platform}", "get">;
export type ConnectPlatform = paths["/v1/connect/{platform}"]["get"]["parameters"]["path"]["platform"];

export type ListConversationsQuery = Query<"/v1/inbox/conversations", "get">;
export type ListConversationsResponse = Res200<"/v1/inbox/conversations", "get">;
export type RestConversation = NonNullable<ListConversationsResponse["data"]>[number];

export type CreateConversationBody = Body<"/v1/inbox/conversations", "post">;
export type CreateConversationResponse = Res200<"/v1/inbox/conversations", "post">;

export type ListMessagesQuery = Query<"/v1/inbox/conversations/{conversationId}/messages", "get">;
export type ListMessagesResponse = Res200<"/v1/inbox/conversations/{conversationId}/messages", "get">;
export type RestMessage = NonNullable<ListMessagesResponse["messages"]>[number];

export type SendMessageBody = Body<"/v1/inbox/conversations/{conversationId}/messages", "post">;
export type SendMessageResponse = Res200<"/v1/inbox/conversations/{conversationId}/messages", "post">;

export type ListWebhooksResponse = Res200<"/v1/webhooks/settings", "get">;
export type ZernioWebhook = NonNullable<ListWebhooksResponse["webhooks"]>[number];
export type CreateWebhookBody = Body<"/v1/webhooks/settings", "post">;
export type UpdateWebhookBody = Body<"/v1/webhooks/settings", "put">;
export type WebhookEventName = CreateWebhookBody["events"][number];

// ---- Webhooks (lo que Zernio nos POSTea). ----
export type WebhookMessageReceived = Schemas["WebhookPayloadMessage"];
export type WebhookMessageSent = Schemas["WebhookPayloadMessageSent"];
export type WebhookMessageStatus = Schemas["WebhookPayloadMessageDeliveryStatus"];
export type WebhookConversationStarted = Schemas["WebhookPayloadConversationStarted"];
export type WebhookReferral = Schemas["WebhookPayloadReferral"];
export type WebhookAccountConnected = Schemas["WebhookPayloadAccountConnected"];
export type WebhookAccountDisconnected = Schemas["WebhookPayloadAccountDisconnected"];
export type WebhookTest = Schemas["WebhookPayloadTest"];

export type ZernioWebhookPayload =
  | WebhookMessageReceived
  | WebhookMessageSent
  | WebhookMessageStatus
  | WebhookConversationStarted
  | WebhookReferral
  | WebhookAccountConnected
  | WebhookAccountDisconnected
  | WebhookTest;

export type InboxWebhookConversation = Schemas["InboxWebhookConversation"];
export type InboxWebhookAccount = Schemas["InboxWebhookAccount"];
