import { authorize, isUuid, jsonError } from "@/lib/api";
import { getLabRun } from "@/lib/lab/run";

export async function GET(_req: Request, { params }: RouteContext<"/api/lab/runs/[runId]">) {
  const auth = await authorize("admin", { name: "lab-get", max: 120, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const { runId } = await params;
  if (!isUuid(runId)) return jsonError(400, "Corrida inválida");
  // Una corrida de otra inmobiliaria responde igual que una inexistente.
  const data = await getLabRun(auth.session.organizationId, runId);
  if (!data) return jsonError(404, "No encontrada");
  return Response.json(data);
}
