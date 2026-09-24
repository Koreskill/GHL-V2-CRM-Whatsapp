import { notFound } from "next/navigation";
import { ChatView } from "@/components/inbox/chat-view";
import { ConversationList } from "@/components/inbox/conversation-list";
import { parseInboxFilters } from "@/components/inbox/filters";
import { isUuid } from "@/lib/api";
import { requireOrgId } from "@/lib/auth";
import { countConversations, getConversation, listConversations, listMessages } from "@/lib/inbox/queries";
import { getLatestTriage, markTriageSeen } from "@/lib/agent/triage/queries";

export default async function ConversationPage({ params, searchParams }: PageProps<"/conversaciones/[conversationId]">) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const orgId = await requireOrgId();
  const filters = parseInboxFilters(await searchParams);

  const [conversation, messages, items, total, triage] = await Promise.all([
    getConversation(conversationId, orgId),
    listMessages(conversationId, orgId),
    listConversations(orgId, filters),
    countConversations(orgId),
    getLatestTriage(conversationId, orgId),
  ]);
  if (!conversation) notFound();

  // Abrir la conversación cuenta como verla: la campanita solo muestra lo que nadie miró.
  await markTriageSeen(conversationId, orgId);

  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <ConversationList items={items} total={total} filters={filters} activeId={conversationId} />
      <ChatView key={conversationId} conversation={conversation} messages={messages} triage={triage} />
    </div>
  );
}
