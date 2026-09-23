import { authorize, isUuid, jsonError } from "@/lib/api";
import { markConversationRead } from "@/lib/inbox/queries";

export async function POST(_req: Request, ctx: RouteContext<"/api/conversations/[conversationId]/read">) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;
  const { conversationId } = await ctx.params;
  if (!isUuid(conversationId)) return jsonError(400, "conversationId inválido");
  await markConversationRead(conversationId);
  return Response.json({ ok: true });
}
