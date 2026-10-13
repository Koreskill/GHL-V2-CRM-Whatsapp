import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb, getRootDb, runInSandbox } from "@/db";
import { channelAccounts, contacts, conversations, labFindings, labRuns, labTurns, messages, organizations } from "@/db/schema";
import { resolveAgentConfig } from "@/lib/agent/config";
import { reportIncident } from "@/lib/incidents/report";
import { safeError } from "@/lib/safe-error";
import { LAB_SCENARIOS, MAX_SCENARIOS_PER_RUN, MAX_TURNS_PER_SCENARIO, SCENARIO_KEYS, type LabScenario } from "./scenarios";

// El Laboratorio corre el MISMO compositor que producción (composeReply) pero en una transacción que se
// revierte y que solo ve este contexto asíncrono (ver runInSandbox). composeReply no envía nada: el único
// camino de salida (deliverMessage) no se invoca desde acá, así que ningún mensaje llega a un proveedor.

const STALE_MS = 20 * 60_000;
const HOURLY_LIMIT = 4;
// Corridas simultáneas en toda la plataforma (el pool de la base es chico y los webhooks reales lo comparten).
const MAX_CONCURRENT_RUNS = Number(process.env.LAB_MAX_CONCURRENT_RUNS) > 0 ? Number(process.env.LAB_MAX_CONCURRENT_RUNS) : 2;

type Finding = { scenarioKey: string; turnIdx: number | null; severity: "critico" | "alto" | "medio" | "info"; rule: string; evidence: string };
type TurnRecord = {
  scenarioKey: string;
  idx: number;
  clientText: string;
  disposition: string | null;
  route: string | null;
  intent: string | null;
  source: string | null;
  replyText: string | null;
  shownPropertyIds: string[];
  violations: unknown[];
  simulatedActions: string[];
};

const CRITICAL_VIOLATIONS = new Set(["monto_inventado", "superficie_inventada", "plazo_inventado", "compromiso", "medio_inexistente"]);

export type StartResult = { ok: true; runId: string } | { ok: false; error: string };

export async function createLabRun(input: { organizationId: string; userId: string; scenarioKeys?: string[] }): Promise<StartResult> {
  const keys = (input.scenarioKeys?.length ? input.scenarioKeys : SCENARIO_KEYS).filter((k) => SCENARIO_KEYS.includes(k)).slice(0, MAX_SCENARIOS_PER_RUN);
  if (keys.length === 0) return { ok: false, error: "Elige al menos un escenario." };
  if (!process.env.OPENROUTER_API_KEY) return { ok: false, error: "Falta OPENROUTER_API_KEY en el servidor." };

  const db = getRootDb();
  await expireStaleRuns(input.organizationId);
  const active = await db
    .select({ id: labRuns.id })
    .from(labRuns)
    .where(and(eq(labRuns.organizationId, input.organizationId), inArray(labRuns.status, ["queued", "running"])))
    .limit(1);
  if (active.length) return { ok: false, error: "Ya hay una corrida en curso. Espera a que termine o cancélala." };
  // Tope GLOBAL: cada corrida mantiene una conexión con la transacción abierta mientras espera a los modelos.
  const running = await db
    .select({ id: labRuns.id })
    .from(labRuns)
    .where(and(inArray(labRuns.status, ["queued", "running"]), gt(labRuns.updatedAt, new Date(Date.now() - STALE_MS))));
  if (running.length >= MAX_CONCURRENT_RUNS) return { ok: false, error: "El Laboratorio está ocupado con otras corridas. Reintenta en unos minutos." };
  const recent = await db
    .select({ id: labRuns.id })
    .from(labRuns)
    .where(and(eq(labRuns.organizationId, input.organizationId), gt(labRuns.createdAt, new Date(Date.now() - 3600_000))));
  if (recent.length >= HOURLY_LIMIT) return { ok: false, error: `Máximo ${HOURLY_LIMIT} corridas por hora: cada una consume modelos reales.` };

  const [run] = await db
    .insert(labRuns)
    .values({ organizationId: input.organizationId, createdBy: input.userId, scenarioKeys: keys })
    .returning({ id: labRuns.id });
  return { ok: true, runId: run.id };
}

/** Una corrida "running" que no avanza (el contenedor se reinició) deja de bloquear nuevas corridas. */
export async function expireStaleRuns(organizationId: string) {
  await getRootDb()
    .update(labRuns)
    .set({ status: "error", error: "La corrida se interrumpió (reinicio del servidor).", finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(labRuns.organizationId, organizationId),
        inArray(labRuns.status, ["queued", "running"]),
        // updatedAt avanza con cada escenario: sin avance en 20 minutos se considera caída.
        lt(labRuns.updatedAt, new Date(Date.now() - STALE_MS)),
      ),
    )
    .catch(() => {});
}

export async function cancelLabRun(organizationId: string, runId: string) {
  await getRootDb()
    .update(labRuns)
    .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(labRuns.id, runId), eq(labRuns.organizationId, organizationId), inArray(labRuns.status, ["queued", "running"])));
}

async function isCancelled(runId: string) {
  const [r] = await getRootDb().select({ status: labRuns.status }).from(labRuns).where(eq(labRuns.id, runId));
  return !r || r.status === "cancelled";
}

function evaluateTurn(
  scenario: LabScenario,
  turnIdx: number,
  result: { disposition: string; text: string | null; shownPropertyIds: string[]; violations: { code: string; detail: string }[] },
): Finding[] {
  const out: Finding[] = [];
  const expect = scenario.turns[turnIdx].expect;
  const at = { scenarioKey: scenario.key, turnIdx };
  for (const v of result.violations) {
    out.push({ ...at, severity: CRITICAL_VIOLATIONS.has(v.code) ? "critico" : "alto", rule: `validador:${v.code}`, evidence: v.detail });
  }
  if (!expect) return out;
  if (expect.disposition && !expect.disposition.includes(result.disposition as never)) {
    out.push({ ...at, severity: "alto", rule: "resultado_inesperado", evidence: `Esperado ${expect.disposition.join(" o ")} y fue «${result.disposition}».` });
  }
  if (expect.noProperties && result.shownPropertyIds.length) {
    out.push({ ...at, severity: "alto", rule: "propiedades_no_permitidas", evidence: `Mostró ${result.shownPropertyIds.length} propiedad(es) donde no correspondía.` });
  }
  for (const f of expect.forbid ?? []) {
    const m = result.text?.match(f.pattern);
    if (m) out.push({ ...at, severity: "critico", rule: "texto_prohibido", evidence: `${f.why}: «${m[0]}»` });
  }
  return out;
}

async function runScenario(orgId: string, scenario: LabScenario): Promise<{ turns: TurnRecord[]; findings: Finding[] }> {
  const [{ composeReply }, { resolvePolicy }, { loadOfferableCatalog }] = await Promise.all([
    import("@/lib/agent/triage/compose"),
    import("@/lib/agent/triage/run"),
    import("@/lib/agent/triage/catalog-search"),
  ]);

  return runInSandbox(async () => {
    const db = getDb(); // dentro del sandbox: la transacción de esta corrida
    const [contact] = await db.insert(contacts).values({ organizationId: orgId, name: `Laboratorio ${scenario.key}` }).returning();
    const [account] = await db
      .insert(channelAccounts)
      .values({ organizationId: orgId, provider: "zernio", channel: "whatsapp", externalId: `lab-${randomUUID()}` })
      .returning();
    const [conv] = await db
      .insert(conversations)
      .values({
        organizationId: orgId,
        accountId: account.id,
        contactId: contact.id,
        channel: "whatsapp",
        provider: "zernio",
        externalId: `lab-${randomUUID()}`,
        lastInboundAt: new Date(),
      })
      .returning();

    const config = await resolveAgentConfig(orgId, "whatsapp");
    const policy = await resolvePolicy(orgId, "whatsapp");
    const catalog = await loadOfferableCatalog(orgId);
    const turns: TurnRecord[] = [];
    const findings: Finding[] = [];
    let t = Date.now() - scenario.turns.length * 60_000;

    for (const [idx, turn] of scenario.turns.slice(0, MAX_TURNS_PER_SCENARIO).entries()) {
      await db.insert(messages).values({
        organizationId: orgId,
        conversationId: conv.id,
        channel: "whatsapp",
        provider: "zernio",
        direction: "inbound",
        type: "text",
        status: "received",
        body: turn.client,
        sentAt: new Date((t += 20_000)),
      });
      const r = await composeReply({
        organizationId: orgId,
        conversationId: conv.id,
        channel: "whatsapp",
        contactId: contact.id,
        text: turn.client,
        config,
        policy,
        catalog,
        requestRef: { lab: scenario.key },
      });

      const simulated: string[] = [];
      if (r.shownPropertyIds.length) simulated.push("Registrar propiedades mostradas en la oportunidad");
      if (r.notifyTeam) simulated.push("Avisar al equipo (campanita)");
      if (r.visitRequest) simulated.push("Crear una visita «solicitada»");
      if (r.disposition === "derivar") simulated.push("Enviar acuse y pausar la IA del hilo");
      if (r.disposition === "responder" && r.text) simulated.push("Enviar la respuesta por WhatsApp");

      turns.push({
        scenarioKey: scenario.key,
        idx,
        clientText: turn.client,
        disposition: r.disposition,
        route: r.routing?.route ?? null,
        intent: r.classification?.intent ?? null,
        source: r.source,
        replyText: r.text,
        shownPropertyIds: r.shownPropertyIds,
        violations: r.violations,
        simulatedActions: simulated,
      });
      if (r.disposition === "error") {
        findings.push({ scenarioKey: scenario.key, turnIdx: idx, severity: "alto", rule: "sin_resultado", evidence: safeError(r.error ?? "sin detalle").slice(0, 300) });
        break;
      }
      findings.push(...evaluateTurn(scenario, idx, r));

      if (r.text && r.disposition !== "descartar") {
        await db.insert(messages).values({
          organizationId: orgId,
          conversationId: conv.id,
          channel: "whatsapp",
          provider: "zernio",
          direction: "outbound",
          type: "text",
          status: "sent",
          body: r.text,
          rawPayload: { source: "agent" },
          sentAt: new Date((t += 5_000)),
        });
      }
      if (r.disposition === "derivar") break;
    }
    return { turns, findings };
  });
}

/** Ejecuta una corrida ya creada. Se llama dentro de `after()`: nunca bloquea la respuesta HTTP. */
export async function executeLabRun(runId: string) {
  const db = getRootDb();
  const [run] = await db.select().from(labRuns).where(eq(labRuns.id, runId));
  if (!run || run.status !== "queued") return;
  const orgId = run.organizationId;

  try {
    const config = await resolveAgentConfig(orgId, "whatsapp");
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    await db
      .update(labRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        updatedAt: new Date(),
        // Qué se probó, para poder reproducirlo: sin claves ni textos privados.
        snapshot: {
          organization: org?.name ?? null,
          channel: "whatsapp",
          capturedAt: new Date().toISOString(),
          decisionModel: process.env.OPENROUTER_DECISION_MODEL ?? "default",
          agentEnabled: config.enabled,
          promptHash: config.systemPrompt ? (await import("node:crypto")).createHash("sha256").update(config.systemPrompt).digest("hex").slice(0, 12) : null,
        },
      })
      .where(eq(labRuns.id, runId));

    let totalFindings = 0;
    const bySeverity: Record<string, number> = {};
    let passed = 0;
    const scenarios = run.scenarioKeys.map((k) => LAB_SCENARIOS.find((s) => s.key === k)).filter((s): s is LabScenario => Boolean(s));

    for (const scenario of scenarios) {
      if (await isCancelled(runId)) return;
      const { turns, findings } = await runScenario(orgId, scenario);
      if (turns.length) await db.insert(labTurns).values(turns.map((x) => ({ ...x, organizationId: orgId, runId })));
      if (findings.length) await db.insert(labFindings).values(findings.map((f) => ({ ...f, organizationId: orgId, runId })));
      const blocking = findings.filter((f) => f.severity === "critico" || f.severity === "alto");
      if (blocking.length === 0) passed++;
      totalFindings += findings.length;
      for (const f of findings) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      // Cada escenario marca avance: es lo que distingue una corrida viva de una caída.
      await db.update(labRuns).set({ updatedAt: new Date() }).where(eq(labRuns.id, runId));
    }

    if (await isCancelled(runId)) return;
    await db
      .update(labRuns)
      .set({
        status: "done",
        finishedAt: new Date(),
        updatedAt: new Date(),
        // Un puntaje agregado no compensa un hallazgo crítico: se informa aparte.
        summary: { scenarios: scenarios.length, passed, findings: totalFindings, bySeverity, critical: bySeverity.critico ?? 0 },
      })
      .where(eq(labRuns.id, runId));
  } catch (error) {
    await db
      .update(labRuns)
      .set({ status: "error", error: safeError(error).slice(0, 500), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(labRuns.id, runId))
      .catch(() => {});
    await reportIncident({ organizationId: orgId, module: "agente", key: "laboratorio", message: "Falló una corrida del Laboratorio", detail: error, severity: "advertencia" });
  }
}

// ─── Lectura ────────────────────────────────────────────────────────────────

export async function listLabRuns(organizationId: string, limit = 20) {
  return getRootDb().select().from(labRuns).where(eq(labRuns.organizationId, organizationId)).orderBy(desc(labRuns.createdAt)).limit(limit);
}

export async function getLabRun(organizationId: string, runId: string) {
  const db = getRootDb();
  const [run] = await db.select().from(labRuns).where(and(eq(labRuns.id, runId), eq(labRuns.organizationId, organizationId)));
  if (!run) return null;
  const [turns, findings] = await Promise.all([
    db.select().from(labTurns).where(and(eq(labTurns.runId, runId), eq(labTurns.organizationId, organizationId))).orderBy(labTurns.scenarioKey, labTurns.idx),
    db.select().from(labFindings).where(and(eq(labFindings.runId, runId), eq(labFindings.organizationId, organizationId))),
  ]);
  return { run, turns, findings };
}
