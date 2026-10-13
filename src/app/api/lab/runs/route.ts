import { after } from "next/server";
import { authorize, jsonError } from "@/lib/api";
import { createLabRun, listLabRuns } from "@/lib/lab/run";

// El tenant sale SIEMPRE de la sesión. Solo administradores: cada corrida consume modelos reales.
export async function GET() {
  const auth = await authorize("admin", { name: "lab-list", max: 60, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  return Response.json({ runs: await listLabRuns(auth.session.organizationId) });
}

export async function POST(req: Request) {
  const auth = await authorize("admin", { name: "lab-start", max: 6, windowMs: 3600_000 });
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => null)) as { scenarioKeys?: unknown } | null;
  const keys = Array.isArray(body?.scenarioKeys) ? body.scenarioKeys.filter((k): k is string => typeof k === "string").slice(0, 20) : undefined;

  const res = await createLabRun({ organizationId: auth.session.organizationId, userId: auth.session.user.id, scenarioKeys: keys });
  if (!res.ok) return jsonError(409, res.error);
  // El trabajo pesado corre después de responder; el módulo se importa dentro del after().
  after(async () => {
    const { executeLabRun } = await import("@/lib/lab/run");
    await executeLabRun(res.runId);
  });
  return Response.json({ runId: res.runId }, { status: 202 });
}
