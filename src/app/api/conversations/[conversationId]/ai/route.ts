import { isUuid, jsonError, requireUser } from "@/lib/api";
import { setConversationAi } from "@/lib/inbox/queries";

export async function POST(req: Request, ctx: RouteContext<"/api/conversations/[conversationId]/ai">) {
  if (!(await requireUser())) return jsonError(401, "unauthorized");
  const { conversationId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!isUuid(conversationId) || typeof body?.enabled !== "boolean") {
    return jsonError(400, "Se espera { enabled: boolean }");
  }
  await setConversationAi(conversationId, body.enabled);
  return Response.json({ ok: true, enabled: body.enabled });
}
