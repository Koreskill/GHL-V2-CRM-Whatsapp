import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { readChoice, readNoul, readScore, type DecisionAnswer } from "../src/lib/ai/decisions";
import { LABELED_EXAMPLES } from "../src/lib/agent/triage/examples";
import { INTENTS, URGENCY_LEVELS } from "../src/lib/agent/triage/questions";
import { DEFAULT_POLICY, routeFor, type Decision } from "../src/lib/agent/triage/routes";
import { __parseReplyForTests as parseReply } from "../src/lib/agent/triage/generate";

// Triaje SIN llamar a ningún modelo: la tabla de rutas es determinista, así que se prueba sola.
// La calidad de la clasificación de Jev se mide aparte, con scripts/triage-calibrar.ts.

// ─── Lectura de las respuestas de la Decisions API ──────────────────────────
{
  // Tipos tomados del ejemplo literal del OpenAPI de OpenRouter.
  const noul: DecisionAnswer = { type: "noul", noul: 0.96 };
  assert.equal(readNoul(noul), 0.96);
  assert.equal(readNoul(undefined), null);
  // Un noul NO trae confidence: leerlo como choice tiene que fallar, no inventar.
  assert.equal(readChoice(noul, INTENTS), null);

  const choice: DecisionAnswer = {
    type: "choice",
    choice: "buy",
    confidence: 0.75,
    probabilities: { buy: 0.84, rent: 0.16 },
  };
  const read = readChoice(choice, INTENTS);
  assert.equal(read?.choice, "buy");
  assert.equal(read?.confidence, 0.75);

  // Una opción fuera del catálogo se descarta: no se enruta a algo que no existe.
  assert.equal(readChoice({ type: "choice", choice: "inventada" }, INTENTS), null);

  // Sin confidence se asume 0, para que caiga en revisión en vez de darse por buena.
  assert.equal(readChoice({ type: "choice", choice: "buy" }, INTENTS)?.confidence, 0);

  // score viene ponderado por probabilidad (1.99 con 3 niveles), no como entero.
  const score: DecisionAnswer = { type: "score", score: 1.99, confidence: 0.99 };
  assert.equal(readScore(score, URGENCY_LEVELS.length)?.level, 2, "1.99 redondea al nivel alto");
  assert.equal(readScore({ type: "score", score: 0.2 }, 3)?.level, 0);
  assert.equal(readScore({ type: "score", score: 1.4 }, 3)?.level, 1);
  // Fuera de rango se recorta en vez de romper.
  assert.equal(readScore({ type: "score", score: 9 }, 3)?.level, 2);
  assert.equal(readScore({ type: "score", score: -3 }, 3)?.level, 0);
}

// ─── Tabla de rutas ─────────────────────────────────────────────────────────
const decision = (p: Partial<Decision>): Decision => ({
  intent: "buy",
  intentConfidence: 0.9,
  containsVisitRequest: 0,
  requiresHuman: 0,
  urgency: "bajo",
  ...p,
});

// Cada ejemplo etiquetado, con una clasificación ideal, tiene que dar su ruta.
for (const ex of LABELED_EXAMPLES) {
  const result = routeFor(
    decision({
      intent: ex.intent,
      intentConfidence: 0.9,
      containsVisitRequest: ex.visita ? 0.9 : 0.02,
      requiresHuman: ex.humano ? 0.9 : 0.05,
    }),
  );
  assert.equal(result.route, ex.route, `${ex.id}: esperaba ${ex.route} y dio ${result.route}`);
}

// Prioridades de la política, que es donde se juega que un reclamo no reciba un pitch comercial.
{
  // Un reclamo manda aunque la confianza sea baja.
  assert.equal(routeFor(decision({ intent: "complaint", intentConfidence: 0.2 })).route, "derivar_reclamo");

  // requires_human alto pesa más que una intención comercial con confianza alta.
  const r = routeFor(decision({ intent: "buy", intentConfidence: 0.99, requiresHuman: 0.8 }));
  assert.equal(r.route, "derivar_reclamo");
  assert.equal(r.handoff, true);

  // Justo en el umbral cuenta como que sí (>=).
  assert.equal(
    routeFor(decision({ requiresHuman: DEFAULT_POLICY.humanThreshold })).route,
    "derivar_reclamo",
    "el umbral es inclusivo",
  );
  assert.equal(routeFor(decision({ requiresHuman: DEFAULT_POLICY.humanThreshold - 0.01 })).route, "busqueda_compra");

  // Confianza baja: se pregunta en vez de enrutar a ciegas.
  assert.equal(routeFor(decision({ intent: "rent", intentConfidence: 0.3 })).route, "aclaracion");
  assert.equal(routeFor(decision({ intent: "rent", intentConfidence: 0.61 })).route, "busqueda_alquiler");

  // Una visita metida dentro de otra consulta gana, porque tiene fecha.
  assert.equal(routeFor(decision({ intent: "buy", containsVisitRequest: 0.85 })).route, "coordinar_visita");
  // Pero no le gana a un reclamo.
  assert.equal(
    routeFor(decision({ intent: "complaint", containsVisitRequest: 0.85 })).route,
    "derivar_reclamo",
  );

  // Spam no abre conversación NI ocupa a una persona.
  const spam = routeFor(decision({ intent: "spam", requiresHuman: 0.99, containsVisitRequest: 0.99 }));
  assert.equal(spam.route, "spam");
  assert.equal(spam.handoff, false, "el spam no se deriva a nadie");

  // Pedir hablar con una persona siempre deriva, con o sin confianza.
  assert.equal(routeFor(decision({ intent: "human_request", intentConfidence: 0.1 })).handoff, true);

  // Política más estricta: la misma clasificación cambia de ruta.
  const estricta = { ...DEFAULT_POLICY, minConfidence: 0.95 };
  assert.equal(routeFor(decision({ intent: "buy", intentConfidence: 0.9 }), estricta).route, "aclaracion");
  const permisiva = { ...DEFAULT_POLICY, humanThreshold: 0.99 };
  assert.equal(routeFor(decision({ intent: "buy", requiresHuman: 0.8 }), permisiva).route, "busqueda_compra");
}

// Toda ruta de handoff tiene que venir marcada como tal.
for (const intent of ["complaint", "human_request"] as const) {
  assert.equal(routeFor(decision({ intent })).handoff, true, `${intent} tiene que derivar`);
}

// ─── Validación de lo que devuelve GPT ──────────────────────────────────────
{
  const ok = parseReply(
    JSON.stringify({
      reply_text: "Hola Ana, te paso los datos.",
      internal_summary: "Consulta por Thames 1500",
      missing_information: ["expensas"],
      suggested_crm_updates: { zona: "Palermo" },
      handoff_reason: null,
    }),
  );
  assert.equal(ok?.reply_text, "Hola Ana, te paso los datos.");
  assert.deepEqual(ok?.missing_information, ["expensas"]);
  assert.equal(ok?.handoff_reason, null);

  // Envuelto en ```json: varios proveedores lo devuelven así aunque se pida structured output.
  const fenced = parseReply('```json\n{"reply_text":"Hola"}\n```');
  assert.equal(fenced?.reply_text, "Hola");
  assert.deepEqual(fenced?.missing_information, [], "los campos que faltan quedan vacíos, no undefined");
  assert.deepEqual(fenced?.suggested_crm_updates, {});

  // Basura o forma equivocada: se descarta, no se manda nada a medias.
  assert.equal(parseReply("no soy json"), null);
  assert.equal(parseReply("{}"), null, "sin reply_text no sirve");
  assert.equal(parseReply(JSON.stringify({ reply_text: 42 })), null, "reply_text tiene que ser texto");

  // Campos con el tipo equivocado se normalizan en vez de romper.
  const raro = parseReply(
    JSON.stringify({ reply_text: "Hola", missing_information: "no es un array", suggested_crm_updates: [1, 2] }),
  );
  assert.deepEqual(raro?.missing_information, []);
  assert.deepEqual(raro?.suggested_crm_updates, {});

  // Un handoff_reason vacío es lo mismo que no tenerlo: no puede disparar una derivación.
  assert.equal(parseReply(JSON.stringify({ reply_text: "Hola", handoff_reason: "   " }))?.handoff_reason, null);
}

console.log(`triage: OK (${LABELED_EXAMPLES.length} ejemplos etiquetados)`);
