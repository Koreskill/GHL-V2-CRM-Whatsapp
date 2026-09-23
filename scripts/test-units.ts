import assert from "node:assert/strict";
import { DEFAULT_SYSTEM_PROMPT, mergeAgentConfig } from "../src/lib/agent/config";
import { computeWindow } from "../src/lib/inbox/window";

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

console.log("units: OK");
