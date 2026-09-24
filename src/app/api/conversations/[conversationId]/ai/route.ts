import { authorize, isUuid, jsonError } from "@/lib/api";
import { setConversationAi } from "@/lib/inbox/queries";

export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[conversationId]/ai">) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;
  const { conversationId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!isUuid(conversationId) || typeof body?.enabled !== "boolean") {
    return jsonError(400, "Se espera { enabled: boolean }");
  }
  await setConversationAi(conversationId, auth.session.organizationId, body.enabled);
  return Response.json({ ok: true, enabled: body.enabled });
}
