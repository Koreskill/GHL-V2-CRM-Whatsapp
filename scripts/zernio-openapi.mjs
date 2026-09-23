// Descarga el OpenAPI oficial de Zernio y lo recorta a lo que usa el CRM,
// arrastrando todos los $ref de components que esas operaciones necesitan.
// Uso: node scripts/zernio-openapi.mjs [--offline]
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const SOURCE_URL = "https://zernio.com/openapi.yaml";
const FULL = "openapi/zernio.yaml";
const SLIM = "openapi/zernio.slim.json";

const PATHS = [
  "/v1/accounts",
  "/v1/accounts/{accountId}",
  "/v1/connect/{platform}",
  "/v1/webhooks/settings",
  "/v1/inbox/conversations",
  "/v1/inbox/conversations/{conversationId}",
  "/v1/inbox/conversations/{conversationId}/messages",
  "/v1/inbox/conversations/{conversationId}/read",
  "/v1/whatsapp/templates",
];

const WEBHOOKS = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "conversation.started",
  "referral.received",
  "account.connected",
  "account.disconnected",
  "webhook.test",
];

if (!process.argv.includes("--offline")) {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`No se pudo descargar ${SOURCE_URL}: ${res.status}`);
  writeFileSync(FULL, await res.text());
}

const spec = parse(readFileSync(FULL, "utf8"), { maxAliasCount: -1 });

const slim = {
  openapi: spec.openapi,
  info: spec.info,
  servers: spec.servers,
  security: spec.security,
  paths: {},
  webhooks: {},
  components: {},
};

for (const p of PATHS) {
  if (!spec.paths[p]) throw new Error(`Path ausente en el OpenAPI: ${p}`);
  slim.paths[p] = spec.paths[p];
}
for (const w of WEBHOOKS) {
  if (!spec.webhooks[w]) throw new Error(`Webhook ausente en el OpenAPI: ${w}`);
  slim.webhooks[w] = spec.webhooks[w];
}
if (spec.components.securitySchemes) {
  slim.components.securitySchemes = spec.components.securitySchemes;
}

const seen = new Set();
const queue = [slim.paths, slim.webhooks];
while (queue.length) {
  const node = queue.pop();
  if (!node || typeof node !== "object") continue;
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string" && value.startsWith("#/components/")) {
      if (seen.has(value)) continue;
      seen.add(value);
      const [, , section, name] = value.split("/");
      const target = spec.components[section]?.[name];
      if (!target) throw new Error(`$ref roto: ${value}`);
      slim.components[section] ??= {};
      slim.components[section][name] = target;
      queue.push(target);
    } else if (value && typeof value === "object") {
      queue.push(value);
    }
  }
}

writeFileSync(SLIM, JSON.stringify(slim, null, 2));
console.log(
  `OpenAPI ${spec.info.version}: ${PATHS.length} paths, ${WEBHOOKS.length} webhooks, ${seen.size} components -> ${SLIM}`,
);
