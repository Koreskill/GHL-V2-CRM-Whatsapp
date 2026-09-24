import assert from "node:assert/strict";
import { DEFAULT_SYSTEM_PROMPT, mergeAgentConfig } from "../src/lib/agent/config";
import { roleOf } from "../src/lib/auth";
import { clientIp, rateLimit } from "../src/lib/rate-limit";
import { safeError } from "../src/lib/safe-error";
import { computeWindow } from "../src/lib/inbox/window";
import { renderTemplate, templateParamCount } from "../src/lib/zernio/templates";
import { scoreMatch, type MatchCandidate, type MatchRequirement } from "../src/lib/matching/score";

const H = 3_600_000;
const now = Date.parse("2026-09-23T12:00:00Z");
const ago = (h: number) => new Date(now - h * H);

// Ventana de 24 h
assert.equal(computeWindow("whatsapp", ago(1), now).state, "open");
assert.equal(computeWindow("whatsapp", ago(25), now).state, "template_only");
assert.equal(computeWindow("whatsapp", null, now).state, "template_only");
assert.equal(computeWindow("instagram", ago(23), now).state, "open");
assert.equal(computeWindow("instagram", ago(30), now).state, "human_agent");
assert.equal(computeWindow("facebook", ago(24 * 6), now).state, "human_agent");
assert.equal(computeWindow("facebook", ago(24 * 8), now).state, "closed");
assert.equal(computeWindow("instagram", null, now).state, "closed");
assert.equal(computeWindow("whatsapp", ago(1), now).expiresAt, new Date(now + 23 * H).toISOString());

// Cascada canal -> global -> default
const row = (scope: string, p: Partial<{ enabled: boolean; systemPrompt: string | null; model: string | null; enabledTools: string[] | null }>) => ({
  organizationId: "00000000-0000-0000-0000-000000000001",
  scope,
  enabled: p.enabled ?? false,
  systemPrompt: p.systemPrompt ?? null,
  model: p.model ?? null,
  enabledTools: p.enabledTools ?? null,
  updatedAt: new Date(),
});
const global = row("global", { enabled: true, systemPrompt: "GLOBAL", model: "gpt-global", enabledTools: [] });

const inherits = mergeAgentConfig(row("whatsapp", { enabled: true, systemPrompt: "  " }), global);
assert.equal(inherits.systemPrompt, "GLOBAL", "prompt vacío hereda de global");
assert.equal(inherits.model, "gpt-global");
assert.deepEqual(inherits.tools, [], "herramientas heredadas de global");
assert.equal(inherits.enabled, true);

const own = mergeAgentConfig(row("instagram", { systemPrompt: "IG", model: "gpt-ig", enabledTools: ["handoff_to_human", "inventada"] }), global);
assert.equal(own.systemPrompt, "IG");
assert.equal(own.enabled, false, "enabled es solo del canal");
assert.deepEqual(own.tools, ["handoff_to_human"], "descarta herramientas desconocidas");

const nothing = mergeAgentConfig(undefined, undefined);
assert.equal(nothing.enabled, false, "canal sin fila arranca apagado");
assert.equal(nothing.systemPrompt, DEFAULT_SYSTEM_PROMPT);
assert.deepEqual(nothing.tools, ["handoff_to_human"]);

// Plantillas: Meta devuelve BODY en mayúsculas; las variables pueden repetirse o traer espacios.
const tpl = { components: [{ type: "HEADER", text: "{{9}}" }, { type: "BODY", text: "Hola {{1}}, tu visita es el {{ 2 }}. Gracias {{1}}" }] };
assert.equal(templateParamCount(tpl), 2, "cuenta el máximo {{n}} del cuerpo, ignora el header");
assert.equal(renderTemplate(tpl, ["Ana", "lunes"]), "Hola Ana, tu visita es el lunes. Gracias Ana");
assert.equal(templateParamCount({ components: [{ type: "body", text: "Sin variables" }] }), 0);
assert.equal(templateParamCount({ components: undefined }), 0);

// Roles: solo app_metadata.crm_role cuenta; user_metadata lo puede editar el propio usuario.
assert.equal(roleOf({ app_metadata: { crm_role: "admin" } }), "admin");
assert.equal(roleOf({ app_metadata: { crm_role: "agent" } }), "agent");
assert.equal(roleOf({ app_metadata: { crm_role: "superadmin" } }), null, "rol desconocido no entra");
assert.equal(roleOf({ app_metadata: {} }), null, "registrado sin rol no entra");
assert.equal(roleOf(null), null);

// Límite de peticiones: el sexto intento dentro de la ventana se rechaza; otra clave no se ve afectada.
for (let i = 0; i < 5; i++) assert.equal(rateLimit("test:login", 5, 60_000).ok, true);
assert.equal(rateLimit("test:login", 5, 60_000).ok, false, "fuerza bruta cortada");
assert.equal(rateLimit("test:otra", 5, 60_000).ok, true);
assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9", "usa la IP que agregó nuestro proxy");
assert.equal(clientIp(new Headers({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" })), "8.8.8.8");

// Logs sin datos personales: los parámetros de la consulta no salen del error.
const dbErr = new Error('Failed query: insert into "contacts" ("name","phone") values ($1, $2)\nparams: Juan Pérez,+5493410000000');
assert.ok(!safeError(dbErr).includes("5493410000000") && !safeError(dbErr).includes("Juan"), "sin teléfono ni nombre");
const pgErr = Object.assign(new Error("Failed query: ...\nparams: secreto"), { cause: { code: "23505", message: "duplicate key value" } });
assert.equal(safeError(pgErr), "23505 duplicate key value");

// Matching: operación distinta excluye; precio fuera de rango o must-have faltante excluyen.
const baseReq: MatchRequirement = {
  operation: "venta",
  propertyTypes: ["departamento"],
  zones: ["Palermo"],
  bedroomsMin: 2,
  bathroomsMin: null,
  priceMin: 100000,
  priceMax: 200000,
  areaMin: null,
  mustHave: ["cochera"],
  niceToHave: ["balcon"],
};
const baseCand: MatchCandidate = {
  operation: "venta",
  propertyType: "departamento",
  price: 150000,
  zone: "Palermo",
  bedrooms: 3,
  bathrooms: 2,
  areaM2: 80,
  features: { cochera: true, balcon: true },
};
const good = scoreMatch(baseReq, baseCand);
assert.equal(good.excluded, false, "candidato ideal no se excluye");
assert.ok(good.score > 0.9, `score alto para match casi perfecto (fue ${good.score})`);
assert.equal(scoreMatch(baseReq, { ...baseCand, operation: "alquiler" }).excluded, true, "operación distinta excluye");
assert.equal(scoreMatch(baseReq, { ...baseCand, price: 500000 }).excluded, true, "precio fuera de rango excluye");
assert.equal(scoreMatch(baseReq, { ...baseCand, features: { balcon: true } }).excluded, true, "falta un must-have: excluye");
assert.equal(scoreMatch(baseReq, { ...baseCand, propertyType: "casa" }).excluded, true, "tipo fuera de lo buscado excluye");
const otherZone = scoreMatch(baseReq, { ...baseCand, zone: "Belgrano" });
assert.equal(otherZone.excluded, false, "otra zona no excluye, solo baja el score");
assert.ok(otherZone.score < good.score, "zona distinta puntúa menos");

console.log("units: OK");
