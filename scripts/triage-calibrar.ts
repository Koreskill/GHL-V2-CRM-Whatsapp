import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { aiDecide, readChoice, readNoul } from "../src/lib/ai/decisions";
import { LABELED_EXAMPLES, type LabeledExample } from "../src/lib/agent/triage/examples";
import { INTENTS, TRIAGE_QUESTIONS } from "../src/lib/agent/triage/questions";
import { DEFAULT_POLICY, routeFor } from "../src/lib/agent/triage/routes";
import { DEFAULT_DECISION_MODEL } from "../src/lib/agent/triage/run";

/**
 * Calibración del umbral de confianza.
 *
 * Esto NO es parte de `npm test`: llama a Jev de verdad, una vez por ejemplo, y eso se paga.
 * Se corre a mano cuando hay mensajes etiquetados:
 *
 *   npx tsx scripts/triage-calibrar.ts [ruta/a/mensajes.json]
 *
 * El archivo opcional tiene el mismo formato que `LABELED_EXAMPLES`. Sin archivo usa los
 * ejemplos del repositorio, que sirven para probar el circuito pero **no alcanzan para
 * calibrar**: son pocos y los escribimos nosotros, no son mensajes reales de clientes.
 *
 * Lo que mide, para cada umbral posible:
 *   - aciertos de intención
 *   - aciertos de ruta (que es lo que de verdad importa)
 *   - cuántos reclamos o pedidos de humano se escaparon a una respuesta automática (lo más caro)
 *   - cuántas consultas normales terminaron en revisión innecesaria
 */

const ORG = "00000000-0000-0000-0000-000000000001";

async function load(path: string | undefined): Promise<LabeledExample[]> {
  if (!path) return LABELED_EXAMPLES;
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(path, "utf8");
  const parsed = JSON.parse(raw) as LabeledExample[];
  if (!Array.isArray(parsed) || parsed.some((e) => !e.mensaje || !e.intent || !e.route)) {
    throw new Error("El archivo tiene que ser un array con { id, mensaje, intent, route }");
  }
  return parsed;
}

type Row = {
  ex: LabeledExample;
  intent: string | null;
  confidence: number;
  visit: number;
  human: number;
};

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Falta OPENROUTER_API_KEY en .env.local");
    process.exitCode = 1;
    return;
  }

  const examples = await load(process.argv[2]);
  const model = DEFAULT_DECISION_MODEL();
  console.log(`Clasificando ${examples.length} mensajes con ${model}…`);
  if (!process.argv[2]) {
    console.log(
      "AVISO: son los ejemplos del repositorio, no mensajes reales. Sirven para ver que el circuito\n" +
        "        funciona, no para fijar un umbral. Pasá un archivo con mensajes de la inmobiliaria.\n",
    );
  }

  const rows: Row[] = [];
  for (const ex of examples) {
    const res = await aiDecide({
      organizationId: ORG,
      fn: "calificacion",
      model,
      // Solo el mensaje: acá se mide la clasificación, no el aporte del contexto.
      state: { canal: "whatsapp", mensaje_entrante: ex.mensaje, contexto_reciente: [] },
      questions: TRIAGE_QUESTIONS,
      requestRef: { calibracion: ex.id },
    });

    if (!res.success) {
      console.log(`  ${ex.id}: ERROR ${res.error}`);
      rows.push({ ex, intent: null, confidence: 0, visit: 0, human: 1 });
      continue;
    }

    const intent = readChoice(res.data.answers.intent, INTENTS);
    const row: Row = {
      ex,
      intent: intent?.choice ?? null,
      confidence: intent?.confidence ?? 0,
      visit: readNoul(res.data.answers.contains_visit_request) ?? 0,
      human: readNoul(res.data.answers.requires_human) ?? 1,
    };
    rows.push(row);

    const ok = row.intent === ex.intent ? "ok " : "MAL";
    console.log(
      `  ${ok} ${ex.id.padEnd(24)} esperado=${ex.intent.padEnd(14)} dio=${(row.intent ?? "-").padEnd(14)} conf=${row.confidence.toFixed(2)} humano=${row.human.toFixed(2)}`,
    );
  }

  const intentOk = rows.filter((r) => r.intent === r.ex.intent).length;
  console.log(`\nIntención correcta: ${intentOk}/${rows.length} (${((intentOk / rows.length) * 100).toFixed(0)}%)`);

  // Barrido de umbrales. Se busca el que no deje escapar reclamos y no mande todo a revisión.
  console.log("\numbral  rutas_ok  escapes  revision_de_mas");
  let mejor = { umbral: DEFAULT_POLICY.minConfidence, rutasOk: -1, escapes: Infinity };

  for (let umbral = 0.3; umbral <= 0.95; umbral += 0.05) {
    let rutasOk = 0;
    let escapes = 0;
    let revisionDeMas = 0;

    for (const r of rows) {
      if (!r.intent) continue;
      const result = routeFor(
        {
          intent: r.intent as LabeledExample["intent"],
          intentConfidence: r.confidence,
          containsVisitRequest: r.visit,
          requiresHuman: r.human,
          urgency: "bajo",
        },
        { ...DEFAULT_POLICY, minConfidence: umbral },
      );

      if (result.route === r.ex.route) rutasOk++;
      // Lo más caro: un reclamo o un pedido de persona contestado por el bot.
      if (r.ex.humano && !result.handoff) escapes++;
      // Lo molesto: una consulta normal que termina en el escritorio de alguien.
      if (!r.ex.humano && result.route === "aclaracion" && r.ex.route !== "aclaracion") revisionDeMas++;
    }

    console.log(
      `  ${umbral.toFixed(2)}   ${String(rutasOk).padStart(3)}/${rows.length}     ${String(escapes).padStart(2)}       ${String(revisionDeMas).padStart(2)}`,
    );

    // Se prefiere cero escapes; entre los que empatan, el que más rutas acierta.
    if (escapes < mejor.escapes || (escapes === mejor.escapes && rutasOk > mejor.rutasOk)) {
      mejor = { umbral, rutasOk, escapes };
    }
  }

  console.log(
    `\nSugerido: minConfidence = ${mejor.umbral.toFixed(2)} (${mejor.rutasOk}/${rows.length} rutas, ${mejor.escapes} escapes)`,
  );
  console.log("Se carga por inmobiliaria en Configuración, no en el código.");
  if (rows.length < 100) {
    console.log(
      `\nOJO: ${rows.length} mensajes son POCOS para calibrar. Con menos de ~100 por categoría el\n` +
        "      número de arriba es orientativo, no una garantía de acierto.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
