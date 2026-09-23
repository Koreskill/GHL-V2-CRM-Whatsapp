import { notFound } from "next/navigation";
import { ChatView } from "@/components/inbox/chat-view";
import { ConversationList } from "@/components/inbox/conversation-list";
import { parseInboxFilters } from "@/components/inbox/filters";
import { isUuid } from "@/lib/api";
import { countConversations, getConversation, listConversations, listMessages } from "@/lib/inbox/queries";

export default async function ConversationPage({ params, searchParams }: PageProps<"/conversaciones/[conversationId]">) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const filters = parseInboxFilters(await searchParams);

  const [conversation, messages, items, total] = await Promise.all([
    getConversation(conversationId),
    listMessages(conversationId),
    listConversations(filters),
    countConversations(),
  ]);
  if (!conversation) notFound();

  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <ConversationList items={items} total={total} filters={filters} activeId={conversationId} />
      <ChatView key={conversationId} conversation={conversation} messages={messages} />
    </div>
  );
}
