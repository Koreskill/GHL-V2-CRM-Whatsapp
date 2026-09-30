import { notFound } from "next/navigation";
import { ChatView } from "@/components/inbox/chat-view";
import { ConversationList } from "@/components/inbox/conversation-list";
import { parseInboxFilters } from "@/components/inbox/filters";
import { isUuid } from "@/lib/api";
import { requireOrgId } from "@/lib/auth";
import { getConversation, listMessages } from "@/lib/inbox/queries";
import { loadInboxSidebar } from "@/lib/inbox/sidebar";
import { activeNetworkIds, getDelegationOfConversation } from "@/lib/delegations/flow";
import { getLatestTriage, markTriageSeen } from "@/lib/agent/triage/queries";
import { getContactTagSummary } from "@/lib/crm/tags";

export default async function ConversationPage({ params, searchParams }: PageProps<"/conversaciones/[conversationId]">) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const orgId = await requireOrgId();
  const filters = parseInboxFilters(await searchParams);

  const [conversation, messages, sidebar, delegation, triage] = await Promise.all([
    getConversation(conversationId, orgId),
    listMessages(conversationId, orgId),
    loadInboxSidebar(orgId, filters),
    getDelegationOfConversation(orgId, conversationId),
    getLatestTriage(conversationId, orgId),
  ]);
  if (!conversation) notFound();

  const tags = conversation.contactId ? await getContactTagSummary(conversation.contactId, orgId) : null;

  const canDelegate = !conversation.delegatedFrom && (await activeNetworkIds(orgId)).length > 0;

  // Abrir la conversación cuenta como verla: la campanita solo muestra lo que nadie miró.
  await markTriageSeen(conversationId, orgId);

  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <ConversationList items={sidebar.items} counts={sidebar.counts} delegations={sidebar.delegations} filters={filters} activeId={conversationId} />
      <ChatView
        key={conversationId}
        conversation={conversation}
        messages={messages}
        triage={triage}
        tags={tags}
        delegation={delegation ? { id: delegation.id, status: delegation.status } : null}
        canDelegate={canDelegate}
      />
    </div>
  );
}
