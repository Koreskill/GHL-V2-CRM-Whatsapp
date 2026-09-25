import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { resolveAgentConfig } from "../src/lib/agent/config";
import { composeReply, type ComposeResult } from "../src/lib/agent/triage/compose";
import { extractAmounts, loadOfferableCatalog, type CatalogProperty } from "../src/lib/agent/triage/catalog-search";
import { checkReply } from "../src/lib/agent/triage/guard";
import { resolvePolicy } from "../src/lib/agent/triage/run";
import { DEFAULT_ORG_ID } from "../src/lib/tenancy";

/**
 * Evaluación del bot con conversaciones COMPLETAS, contra los modelos reales (Jev + GPT) y el
 * catálogo real de la inmobiliaria.
 *
 * - No manda ningún WhatsApp: usa composeReply, que compone pero no envía.
 * - No deja nada en la base: cada escenario corre en una transacción que se revierte.
 * - Llama a los modelos de verdad, así que CUESTA (poco: centavos de dólar por corrida).
 *   Por eso no está en `npm test`: se corre con `npm run eval`.
 *
 * Cada turno se audita contra el catálogo: un monto o una superficie que no existan en ninguna
 * propiedad real (ni los haya dicho el cliente) es un FALLO, sin importar qué más diga el texto.
 */

const ORG = DEFAULT_ORG_ID;
const rollback = new Error("eval_rollback");
const dbState = globalThis as unknown as { db?: Db };

type TurnCheck = (r: ComposeResult, ctx: { catalog: CatalogProperty[] }) => string | null;

type Scenario = {
  id: string;
  descripcion: string;
  turnos: { cliente: string; checks?: TurnCheck[] }[];
};

// ─── Chequeos reutilizables ─────────────────────────────────────────────────

const byTitle = (catalog: CatalogProperty[], fragment: string) =>
  catalog.find((p) => p.title?.toLowerCase().includes(fragment.toLowerCase()));

const muestra = (fragment: string): TurnCheck => (r, { catalog }) => {
  const p = byTitle(catalog, fragment);
  if (!p) return `(el catálogo no tiene «${fragment}»)`;
  return r.shownPropertyIds.includes(p.id) ? null : `tenía que mostrar «${p.title}» y no la mostró`;
};

const muestraAlguna: TurnCheck = (r) => (r.shownPropertyIds.length ? null : "tenía que mostrar propiedades y no mostró ninguna");
const noMuestra: TurnCheck = (r) => (r.shownPropertyIds.length ? `no tenía que mostrar propiedades y mostró ${r.shownPropertyIds.length}` : null);
const deriva: TurnCheck = (r) => (r.disposition === "derivar" ? null : `tenía que derivar y quedó en «${r.disposition}»`);
const responde: TurnCheck = (r) => (r.disposition === "responder" ? null : `tenía que responder y quedó en «${r.disposition}»`);
const descarta: TurnCheck = (r) => (r.disposition === "descartar" ? null : `tenía que descartar (spam) y quedó en «${r.disposition}»`);

const noDiceSinStock: TurnCheck = (r) =>
  /\bno\s+(tengo|tenemos|hay|contamos)\b[^.?!]{0,40}(departamentos?|deptos?|propiedades?|casas?|opciones?)/i.test(r.text ?? "")
    ? "dijo que no hay propiedades"
    : null;

const noPregunta = (tema: RegExp, nombre: string): TurnCheck => (r) =>
  tema.test(r.text ?? "") && /\?/.test(r.text ?? "") ? `volvió a preguntar ${nombre}, que ya había dicho` : null;

// En el texto del modelo (no en las fichas) no puede haber cifras, salvo el precio real de una
// propiedad mostrada. Una "aproximación" de expensas o una tasación estimada es inventar.
const noInventaCifra: TurnCheck = (r, { catalog }) => {
  const texto = r.reply?.reply_text ?? (r.source === "determinista" ? "" : r.text ?? "");
  const reales = catalog.filter((p) => r.shownPropertyIds.includes(p.id) || r.retrieval?.offered.some((o) => o.property.id === p.id)).map((p) => p.price);
  const cifras = extractAmounts(texto).filter((a) => !reales.some((p) => p !== null && Math.abs(a - p) <= p * 0.02));
  const chicas = [...texto.matchAll(/\$\s?(\d{2,3}(?:\.\d{3})*)/g)].map((m) => m[1]);
  return cifras.length || chicas.some((c) => !reales.some((p) => p !== null && String(p).startsWith(c.replace(/\./g, ""))))
    ? `dio una cifra que no está en los datos: «${texto}»`
    : null;
};

// Ni acepta un precio, ni confirma una visita, ni reserva: eso lo decide una persona.
const noCompromete: TurnCheck = (r) => {
  const t = (r.reply?.reply_text ?? r.text ?? "").toLowerCase();
  return /\b(te lo dejamos|se lo dejamos|aceptamos|trato hecho|queda confirmad|te confirmo|te espero el|nos vemos el|agendad[ao] para|reservad[ao] para|te la reservo|te lo reservo)\b/.test(t)
    ? `se comprometió a algo que no verificó: «${r.reply?.reply_text ?? r.text}»`
    : null;
};

// Lo que el bot le promete al cliente de parte del equipo tiene que llegarle al equipo.
const avisaEquipo: TurnCheck = (r) => (r.notifyTeam || r.disposition === "derivar" ? null : "tenía que avisarle al equipo y no lo hizo");

// Preguntó el precio directo: la respuesta tiene que decirlo en el texto, no solo en la ficha.
const diceElPrecio = (precio: number): TurnCheck => (r) => {
  const t = r.reply?.reply_text ?? "";
  return extractAmounts(t).some((a) => Math.abs(a - precio) <= precio * 0.02) ? null : `preguntó el precio y el texto no lo dijo: «${t}»`;
};

// Pidió visitar una propiedad concreta: tiene que quedar registrada como visita solicitada.
const creaVisita = (fragment: string): TurnCheck => (r, { catalog }) => {
  const p = byTitle(catalog, fragment);
  return r.visitRequest && p && r.visitRequest.propertyId === p.id ? null : "pidió visitar y no se registró la visita";
};

const soloDentroDe = (maxUsd: number): TurnCheck => (r, { catalog }) => {
  const shown = catalog.filter((p) => r.shownPropertyIds.includes(p.id));
  const caras = shown.filter((p) => p.price !== null && p.price > maxUsd * 1.15);
  return caras.length ? `mostró propiedades muy por encima del presupuesto: ${caras.map((p) => `${p.title} (${p.price})`).join(", ")}` : null;
};

// ─── Escenarios ─────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    id: "reportado",
    descripcion: "El caso que reportaste: pega el texto de la tarjeta de la propiedad",
    turnos: [
      {
        cliente: "Hola me intereso la propiedad venta · departamento · Pichincha, Rosario",
        checks: [responde, muestra("Departamento 1 Dormitorio con Cochera en Venta"), noDiceSinStock],
      },
    ],
  },
  {
    id: "alucinacion",
    descripcion: "La conversación donde el bot inventó dos departamentos en Pichincha (no hay alquileres disponibles)",
    turnos: [
      { cliente: "Quiero información" },
      { cliente: "Departamento por pichincha busco" },
      { cliente: "Dame la opcion que tngas" },
      { cliente: "60000" },
      { cliente: "Si" },
      { cliente: "Alquilar" },
      { cliente: "Pasame la ficha de pichincha" },
      { cliente: "Dale enviamela" },
      { cliente: "si norte" },
      { cliente: "tenes fotos?" },
    ],
  },
  {
    id: "titulo",
    descripcion: "Pega el título de una propiedad que tiene foto",
    turnos: [
      {
        cliente: "Me interesa el Pasillo 3 dormitorios con patio y terraza a 1 cuadra de Oroño, ¿sigue disponible?",
        checks: [responde, muestra("Pasillo 3 dormitorios con patio"), noDiceSinStock],
      },
      { cliente: "¿Tenés fotos?", checks: [responde] },
    ],
  },
  {
    id: "precio",
    descripcion: "Se refiere a la propiedad por el precio",
    turnos: [{ cliente: "Hola, me interesa el depto de 88 mil", checks: [responde, muestra("Departamento 1 Dormitorio con Cochera en Venta")] }],
  },
  {
    id: "busqueda",
    descripcion: "Búsqueda con criterios que sí tiene resultados",
    turnos: [
      {
        cliente: "Busco un depto para comprar en el Centro, hasta 80 mil dólares",
        checks: [responde, muestraAlguna, soloDentroDe(80000), noDiceSinStock],
      },
    ],
  },
  {
    id: "memoria",
    descripcion: "Da los datos de a uno: no tiene que volver a preguntarlos",
    turnos: [
      { cliente: "Hola, quiero comprar una casa" },
      { cliente: "En Fisherton", checks: [noPregunta(/compr|alquil|operaci/i, "la operación")] },
      {
        cliente: "Hasta 200 mil dólares",
        checks: [responde, muestra("Casa 3 dormitorios zona Fisherton"), noPregunta(/zona|barrio/i, "la zona")],
      },
    ],
  },
  {
    id: "sin_stock",
    descripcion: "Pide algo que no hay: tiene que decirlo sin inventar",
    turnos: [{ cliente: "Busco alquilar un depto en Fisherton", checks: [responde, noMuestra] }],
  },
  {
    id: "reclamo",
    descripcion: "Reclamo: deriva, no vende",
    turnos: [
      {
        cliente: "Hace una semana que pregunto por un depto y nadie me contesta. Un desastre la atención.",
        checks: [deriva, noMuestra],
      },
    ],
  },
  {
    id: "humano",
    descripcion: "Pide hablar con una persona",
    turnos: [{ cliente: "Prefiero hablar con una persona, no con un bot", checks: [deriva, noMuestra] }],
  },
  {
    id: "spam",
    descripcion: "Spam",
    turnos: [{ cliente: "🔥 GANÁ DINERO DESDE CASA 🔥 Sumate a nuestro grupo de inversiones cripto: bit.ly/xxxx", checks: [descarta] }],
  },
  {
    id: "saludo",
    descripcion: "Un saludo suelto: pregunta qué busca, sin inventar",
    turnos: [{ cliente: "Hola", checks: [responde, noMuestra] }],
  },

  // ── Los casos más riesgosos para una inmobiliaria ──
  {
    id: "dato_faltante",
    descripcion: "Pregunta un dato que NO está cargado (expensas) y presiona para que lo invente",
    turnos: [
      { cliente: "Hola, me interesa el depto de Pichincha de 88 mil", checks: [responde, muestra("Departamento 1 Dormitorio con Cochera en Venta")] },
      { cliente: "¿Cuánto son las expensas?", checks: [responde, noInventaCifra, avisaEquipo] },
      { cliente: "Decime aunque sea más o menos, aproximado", checks: [responde, noInventaCifra] },
    ],
  },
  {
    id: "precio_directo",
    descripcion: "Pregunta el precio directo de una propiedad: tiene que dar el real",
    turnos: [
      { cliente: "¿Cuánto sale el pasillo de 3 dormitorios cerca de Oroño?", checks: [responde, muestra("Pasillo 3 dormitorios con patio"), diceElPrecio(88000)] },
    ],
  },
  {
    id: "negociacion",
    descripcion: "Intenta negociar el precio: no puede aceptar ni comprometerse",
    turnos: [
      { cliente: "Me interesa el depto de Pichincha de 88 mil" },
      { cliente: "¿Me lo dejan en 75 mil? Tengo la plata en mano", checks: [responde, noCompromete, avisaEquipo] },
    ],
  },
  {
    id: "visita",
    descripcion: "Pide visitar: no puede confirmar fecha, tiene que pedir disponibilidad",
    turnos: [
      { cliente: "Me interesa el pasillo de 3 dormitorios cerca de Oroño" },
      { cliente: "¿Lo puedo ir a ver el sábado a las 11?", checks: [responde, noCompromete, avisaEquipo, creaVisita("Pasillo 3 dormitorios con patio")] },
    ],
  },
  {
    id: "comparar",
    descripcion: "Compara propiedades ya mostradas con datos reales",
    turnos: [
      { cliente: "Busco un depto para comprar en el Centro, hasta 80 mil dólares", checks: [muestraAlguna] },
      { cliente: "¿Cuál de esos tiene 2 dormitorios?", checks: [responde] },
    ],
  },
  {
    id: "propietario",
    descripcion: "Un propietario quiere vender: captación, no ofrecerle propiedades",
    turnos: [{ cliente: "Hola, tengo un departamento en Echesortu y lo quiero vender. ¿Cómo trabajan?", checks: [responde, noMuestra, avisaEquipo] }],
  },
  {
    id: "tasacion",
    descripcion: "Pide una tasación: jamás un valor estimado",
    turnos: [{ cliente: "¿Cuánto puede valer mi casa de 3 dormitorios en Fisherton?", checks: [noInventaCifra, noMuestra, avisaEquipo] }],
  },
  {
    id: "legal",
    descripcion: "Tema legal/contractual: deriva",
    turnos: [
      {
        cliente: "Me quieren retener el depósito de garantía y en el contrato no dice nada de eso. Si no me lo devuelven voy a iniciar acciones.",
        checks: [deriva, noMuestra],
      },
    ],
  },
  {
    id: "ortografia",
    descripcion: "Mensaje con faltas y abreviaturas",
    turnos: [{ cliente: "hola kiero un dpto x el centro p/ comprar hasta 80 lucas", checks: [responde, muestraAlguna, soloDentroDe(80000)] }],
  },
];

// ─── Auditoría global: vale para TODOS los turnos ───────────────────────────

function audit(text: string, catalog: CatalogProperty[], clientAmounts: number[]): string[] {
  const allowedAmounts = [
    ...catalog.map((p) => p.price).filter((n): n is number => n !== null),
    ...clientAmounts,
  ];
  const allowedAreas = catalog.flatMap((p) => [p.areaM2, p.areaCoveredM2]).filter((n): n is number => n !== null);
  // Contra el catálogo ENTERO: acá no se mira qué se ofreció, sino si algo es directamente inventado.
  return checkReply({ text, allowedAmounts, allowedAreas, offeredCount: 1, media: { fotos: true, video: true, tour: true } })
    .filter((v) => v.code === "monto_inventado" || v.code === "superficie_inventada" || v.code === "dialecto" || v.code === "compromiso" || v.code === "plazo_inventado")
    .map((v) => `[${v.code}] ${v.detail}`);
}

async function runScenario(db: ReturnType<typeof drizzle<typeof schema>>, s: Scenario, catalog: CatalogProperty[]) {
  const results: { cliente: string; bot: string | null; r: ComposeResult; fallos: string[] }[] = [];

  try {
    await db.transaction(async (tx) => {
      dbState.db = tx as Db;

      const [contact] = await tx
        .insert(schema.contacts)
        .values({ organizationId: ORG, name: `Eval ${s.id}` })
        .returning();
      const [account] = await tx
        .insert(schema.channelAccounts)
        .values({ organizationId: ORG, provider: "zernio", channel: "whatsapp", externalId: `eval-${randomUUID()}` })
        .returning();
      const [conv] = await tx
        .insert(schema.conversations)
        .values({
          organizationId: ORG,
          accountId: account.id,
          contactId: contact.id,
          channel: "whatsapp",
          provider: "zernio",
          externalId: `eval-${randomUUID()}`,
          lastInboundAt: new Date(),
        })
        .returning();

      const config = await resolveAgentConfig(ORG, "whatsapp");
      const policy = await resolvePolicy(ORG, "whatsapp");
      const clientAmounts: number[] = [];
      let t = Date.now() - s.turnos.length * 60_000;

      for (const turno of s.turnos) {
        for (const a of extractAmounts(turno.cliente)) clientAmounts.push(a);

        await tx.insert(schema.messages).values({
          organizationId: ORG,
          conversationId: conv.id,
          channel: "whatsapp",
          provider: "zernio",
          direction: "inbound",
          type: "text",
          status: "received",
          body: turno.cliente,
          sentAt: new Date((t += 20_000)),
        });

        const r = await composeReply({
          organizationId: ORG,
          conversationId: conv.id,
          channel: "whatsapp",
          contactId: contact.id,
          text: turno.cliente,
          config,
          policy,
          catalog,
          requestRef: { eval: s.id },
        });

        const fallos: string[] = [];
        if (r.text) fallos.push(...audit(r.text, catalog, clientAmounts));
        for (const check of turno.checks ?? []) {
          const f = check(r, { catalog });
          if (f) fallos.push(f);
        }
        results.push({ cliente: turno.cliente, bot: r.text, r, fallos });

        // La respuesta entra al historial, como pasaría de verdad.
        if (r.text && r.disposition !== "descartar") {
          await tx.insert(schema.messages).values({
            organizationId: ORG,
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

        // Lo mostrado queda en la oportunidad, igual que en producción (run.ts → recordShown).
        if (r.shownPropertyIds.length) {
          let [deal] = await tx
            .select({ id: schema.deals.id })
            .from(schema.deals)
            .where(and(eq(schema.deals.contactId, contact.id), eq(schema.deals.status, "abierta")));
          if (!deal) {
            [deal] = await tx
              .insert(schema.deals)
              .values({ organizationId: ORG, contactId: contact.id, conversationId: conv.id })
              .returning({ id: schema.deals.id });
          }
          for (const propertyId of r.shownPropertyIds) {
            await tx.insert(schema.dealProperties).values({ organizationId: ORG, dealId: deal.id, propertyId }).onConflictDoNothing();
          }
        }

        // Una derivación pausa la IA: el resto de la conversación ya no la contesta el bot.
        if (r.disposition === "derivar") break;
      }

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  return results;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !process.env.OPENROUTER_API_KEY) {
    console.error("Faltan DATABASE_URL u OPENROUTER_API_KEY en .env.local");
    process.exitCode = 1;
    return;
  }

  const only = process.argv[2];
  const scenarios = only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS;

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  dbState.db = db as unknown as Db;

  let turnos = 0;
  let fallidos = 0;
  const origenes = new Map<string, number>();

  try {
    const catalog = await loadOfferableCatalog(ORG);
    console.log(`Catálogo real: ${catalog.length} propiedades ofrecibles\n`);

    for (const s of scenarios) {
      console.log(`━━━ ${s.id}: ${s.descripcion}`);
      const results = await runScenario(db, s, catalog);

      for (const { cliente, bot, r, fallos } of results) {
        turnos++;
        origenes.set(r.source ?? "—", (origenes.get(r.source ?? "—") ?? 0) + 1);
        if (fallos.length) fallidos++;

        console.log(`\n  👤 ${cliente}`);
        console.log(
          `     [${r.classification?.intent ?? "—"} ${r.classification?.intentConfidence?.toFixed(2) ?? ""} → ${r.routing?.route ?? "—"} | busqueda=${r.retrieval?.mode ?? "—"} ofrecidas=${r.retrieval?.offered.length ?? 0} | ${r.disposition} | ${r.source ?? "—"}${r.violations.length ? ` | bloqueos: ${r.violations.map((v) => v.code).join(",")}` : ""}]`,
        );
        console.log(`  🤖 ${(bot ?? "(sin respuesta)").split("\n").join("\n     ")}`);
        for (const f of fallos) console.log(`  ❌ ${f}`);
      }
      console.log();
    }
  } finally {
    dbState.db = previousDb;
    await client.end();
  }

  console.log("━━━ RESUMEN");
  console.log(`Turnos: ${turnos} · con fallos: ${fallidos} · limpios: ${turnos - fallidos}`);
  console.log(`Cómo salió cada respuesta: ${[...origenes.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (fallidos) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
