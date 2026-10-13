import { authorize, isUuid, jsonError } from "@/lib/api";
import { cancelLabRun } from "@/lib/lab/run";

export async function POST(_req: Request, { params }: RouteContext<"/api/lab/runs/[runId]/cancel">) {
  const auth = await authorize("admin", { name: "lab-cancel", max: 30, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const { runId } = await params;
  if (!isUuid(runId)) return jsonError(400, "Corrida inválida");
  await cancelLabRun(auth.session.organizationId, runId);
  return Response.json({ ok: true });
}
