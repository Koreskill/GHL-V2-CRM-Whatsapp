import { zernioRequest, type Result } from "./client";
import type {
  CreateConversationBody,
  CreateConversationResponse,
  ListConversationsQuery,
  ListConversationsResponse,
  ListMessagesQuery,
  ListMessagesResponse,
  RestConversation,
  RestMessage,
  SendMessageBody,
  SendMessageResponse,
} from "./types";

const conv = (conversationId: string) =>
  `/v1/inbox/conversations/${encodeURIComponent(conversationId)}`;

export function listConversationsPage(query: ListConversationsQuery = {}) {
  return zernioRequest<ListConversationsResponse>("GET", "/v1/inbox/conversations", { query });
}

// Recorre todas las páginas. Si una página falla, la entrega como error y corta.
export async function* listConversations(
  query: Omit<ListConversationsQuery, "cursor"> = {},
): AsyncGenerator<Result<RestConversation[]>> {
  let cursor: string | undefined;
  do {
    const page = await listConversationsPage({ ...query, cursor });
    if (!page.success) {
      yield page;
      return;
    }
    yield { success: true, data: page.data.data ?? [] };
    cursor = page.data.pagination?.hasMore ? (page.data.pagination.nextCursor ?? undefined) : undefined;
  } while (cursor);
}

export function listMessagesPage(conversationId: string, query: ListMessagesQuery) {
  return zernioRequest<ListMessagesResponse>("GET", `${conv(conversationId)}/messages`, { query });
}

export async function* listMessages(
  conversationId: string,
  query: Omit<ListMessagesQuery, "cursor">,
): AsyncGenerator<Result<RestMessage[]>> {
  let cursor: string | undefined;
  do {
    const page = await listMessagesPage(conversationId, { ...query, cursor });
    if (!page.success) {
      yield page;
      return;
    }
    yield { success: true, data: page.data.messages ?? [] };
    cursor = page.data.pagination?.hasMore ? (page.data.pagination.nextCursor ?? undefined) : undefined;
  } while (cursor);
}

// Responder en un hilo existente.
export function sendMessage(
  conversationId: string,
  body: SendMessageBody,
  idempotencyKey?: string,
) {
  return zernioRequest<SendMessageResponse>("POST", `${conv(conversationId)}/messages`, {
    body,
    idempotencyKey,
  });
}

// Abrir un hilo nuevo: es un endpoint distinto al de responder.
export function createConversation(body: CreateConversationBody, idempotencyKey?: string) {
  return zernioRequest<CreateConversationResponse>("POST", "/v1/inbox/conversations", {
    body,
    idempotencyKey,
  });
}

export function markConversationRead(conversationId: string, accountId: string) {
  return zernioRequest<{ success?: boolean; markedCount?: number }>(
    "POST",
    `${conv(conversationId)}/read`,
    { body: { accountId } },
  );
}
