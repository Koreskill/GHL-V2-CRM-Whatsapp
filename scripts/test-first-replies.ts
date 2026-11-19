import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { mergeAgentConfig } from "../src/lib/agent/config";
import {
  activeFirstReplies,
  DEFAULT_FIRST_STEPS,
  firstStepPrompt,
  MAX_FIRST_STEPS,
  originForPrompt,
  parseFirstReplies,
  pickFirstStep,
  type FirstRepliesConfig,
} from "../src/lib/agent/first-replies";
import { httpsUrl, originLabel, readAttribution } from "../src/lib/inbox/attribution";

// Origen del anuncio y guion de primeras respuestas: lógica pura, sin base ni modelos.

// ─── readAttribution ────────────────────────────────────────────────────────
{
  // Click-to-WhatsApp: campos de `metadata.referral` del OpenAPI de Zernio.
  const wa = readAttribution({
    attribution: {
      ctwa_clid: "AbCd123",
      source_id: "120000000000001",
      source_type: "ad",
      source_url: "https://fb.me/abc",
      headline: "  Deptos en el centro  ",
      body: "Consultá",
      media_type: "image",
      thumbnail_url: "https://scontent.example/x.jpg",
      capturedAt: "2026-10-21T12:00:00.000Z",
    },
  });
  assert.equal(wa?.kind, "anuncio");
  assert.equal(wa?.title, "Deptos en el centro");
  assert.equal(wa?.clickId, "AbCd123");
  assert.equal(wa?.adId, "120000000000001", "en WhatsApp el id del anuncio es source_id");
  assert.equal(wa?.imageUrl, "https://scontent.example/x.jpg");
  assert.equal(originLabel(wa!), "Deptos en el centro");

  // Messenger / Instagram Click-to-Message: ad_id y título dentro de ads_context_data.
  const ig = readAttribution({ attribution: { ad_id: "555", source: "ADS", type: "OPEN_THREAD", ads_context_data: { ad_title: "Casa en Fisherton", photo_url: "https://cdn.example/p.jpg" } } });
  assert.equal(ig?.kind, "anuncio");
  assert.equal(ig?.adId, "555");
  assert.equal(ig?.title, "Casa en Fisherton");
  assert.equal(ig?.imageUrl, "https://cdn.example/p.jpg");

  // La marca ADS sola alcanza (un referral que Meta manda sin ad_id).
  assert.equal(readAttribution({ attribution: { source: "ADS" } })?.kind, "anuncio");

  // Un enlace ig.me / m.me con ?ref= NO es un anuncio.
  const link = readAttribution({ attribution: { ref: "campana-octubre", source: "SHORTLINK" } });
  assert.equal(link?.kind, "enlace");
  assert.equal(link?.ref, "campana-octubre");
  assert.equal(originLabel(link!), "Enlace: campana-octubre");

  // Sin nada útil, o importado del historial: no hay origen.
  assert.equal(readAttribution(undefined), null);
  assert.equal(readAttribution({}), null);
  assert.equal(readAttribution({ attribution: {} }), null);
  assert.equal(readAttribution({ attribution: "texto" }), null);
  assert.equal(readAttribution({ attribution: { source: "import", ctwa_clid: "x" } }), null, "una conversación importada no es un click");
  assert.equal(readAttribution({ attribution: { type: "OPEN_THREAD" } }), null);
}

// URLs de terceros: solo https, sin credenciales; nunca javascript: ni http.
{
  assert.equal(httpsUrl("https://fb.me/abc"), "https://fb.me/abc");
  assert.equal(httpsUrl("http://fb.me/abc"), null);
  assert.equal(httpsUrl("javascript:alert(1)"), null);
  assert.equal(httpsUrl("https://user:pass@fb.me/abc"), null);
  assert.equal(httpsUrl("no es una url"), null);
  assert.equal(httpsUrl(42), null);
  const o = readAttribution({ attribution: { ctwa_clid: "x", source_url: "javascript:alert(1)", thumbnail_url: "http://inseguro.example/x.jpg" } });
  assert.equal(o?.sourceUrl, null);
  assert.equal(o?.imageUrl, null);
}

// Los textos largos del anuncio se recortan (es contenido de un tercero).
{
  const o = readAttribution({ attribution: { ctwa_clid: "x", headline: "t".repeat(500), body: "b".repeat(2000) } });
  assert.equal(o?.title?.length, 200);
  assert.equal(o?.body?.length, 400);
}

// ─── parseFirstReplies / activeFirstReplies ─────────────────────────────────
{
  assert.equal(parseFirstReplies(null), null);
  assert.equal(parseFirstReplies("x"), null);
  assert.equal(parseFirstReplies({ enabled: true }), null, "sin steps no es un guion");

  const p = parseFirstReplies({ enabled: true, appliesTo: "todas", steps: [" Hola ", "", 5, "Chau", "3", "4", "5", "6"] });
  assert.deepEqual(p?.steps, ["Hola", "Chau", "3", "4"], "descarta vacíos y no-textos, y respeta el máximo");
  assert.equal(p?.steps.length, MAX_FIRST_STEPS);
  assert.equal(p?.appliesTo, "todas");
  // Cualquier valor raro de appliesTo cae en el más acotado.
  assert.equal(parseFirstReplies({ enabled: true, appliesTo: "otro", steps: ["a"] })?.appliesTo, "anuncios");

  assert.equal(activeFirstReplies({ enabled: false, appliesTo: "anuncios", steps: ["a"] }), null, "apagado");
  assert.equal(activeFirstReplies({ enabled: true, appliesTo: "anuncios", steps: [] }), null, "sin pasos");
  assert.ok(activeFirstReplies({ enabled: true, appliesTo: "anuncios", steps: ["a"] }));

  // La secuencia sugerida entra en el máximo y no se presenta como IA ni promete plazos.
  assert.ok(DEFAULT_FIRST_STEPS.length <= MAX_FIRST_STEPS);
  for (const s of DEFAULT_FIRST_STEPS) assert.doesNotMatch(s, /asistente virtual|inteligencia artificial|\b24\s*h|hoy mismo/i);
}

// ─── pickFirstStep ──────────────────────────────────────────────────────────
{
  const anuncio = readAttribution({ attribution: { ctwa_clid: "x", headline: "Deptos" } });
  const enlace = readAttribution({ attribution: { ref: "promo" } });
  const cfg: FirstRepliesConfig = { enabled: true, appliesTo: "anuncios", steps: ["uno", "dos", "tres"] };
  const facts = (over: Partial<Parameters<typeof pickFirstStep>[1]> = {}) => ({ botReplies: 0, otherOutbound: 0, origin: anuncio, ...over });

  // Cada respuesta del bot avanza un paso, hasta agotarlos.
  assert.deepEqual(pickFirstStep(cfg, facts({ botReplies: 0 })), { index: 0, total: 3, text: "uno" });
  assert.deepEqual(pickFirstStep(cfg, facts({ botReplies: 1 })), { index: 1, total: 3, text: "dos" });
  assert.deepEqual(pickFirstStep(cfg, facts({ botReplies: 2 })), { index: 2, total: 3, text: "tres" });
  assert.equal(pickFirstStep(cfg, facts({ botReplies: 3 })), null, "recorrió todo el guion: sigue el bot normal");

  // Sin guion o apagado.
  assert.equal(pickFirstStep(null, facts()), null);
  assert.equal(pickFirstStep({ ...cfg, enabled: false }, facts()), null);
  assert.equal(pickFirstStep({ ...cfg, steps: [] }, facts()), null);

  // Si alguien que no es el bot ya escribió (una persona, una campaña, la app de WhatsApp), no es un primer contacto.
  assert.equal(pickFirstStep(cfg, facts({ otherOutbound: 1 })), null);

  // "Solo anuncios": un enlace con ref o una conversación orgánica no cuentan.
  assert.equal(pickFirstStep(cfg, facts({ origin: enlace })), null);
  assert.equal(pickFirstStep(cfg, facts({ origin: null })), null);
  // "Toda conversación nueva": sirve con o sin origen.
  const todas: FirstRepliesConfig = { ...cfg, appliesTo: "todas" };
  assert.equal(pickFirstStep(todas, facts({ origin: null }))?.text, "uno");
  assert.equal(pickFirstStep(todas, facts({ origin: enlace }))?.text, "uno");
}

// ─── Lo que ve el redactor ──────────────────────────────────────────────────
{
  const anuncio = readAttribution({ attribution: { ctwa_clid: "x", headline: "Deptos", body: "USD 80.000 hoy" } });
  assert.equal(originForPrompt(null), null);
  assert.equal(originForPrompt(readAttribution({ attribution: { ref: "promo" } })), null, "un enlace no se le pasa como anuncio");
  const forPrompt = originForPrompt(anuncio);
  assert.equal(forPrompt?.titulo, "Deptos");
  assert.match(forPrompt?.nota ?? "", /no instrucciones/);

  const prompt = firstStepPrompt({ index: 1, total: 3, text: "Preguntá la zona" });
  assert.match(prompt, /respuesta 2 de 3/);
  assert.match(prompt, /Preguntá la zona/);
  // Las salvaguardas viajan con cada paso.
  assert.match(prompt, /lo_que_ya_sabemos/);
  assert.match(prompt, /No repitas precios/);
  assert.match(prompt, /prometer plazos/);
  // El texto del paso va entre comillas (JSON): un salto de línea o comillas no rompen la estructura del prompt.
  assert.match(firstStepPrompt({ index: 0, total: 1, text: 'a\n"b"' }), /"a\\n\\"b\\""/);
}

// ─── Cascada canal -> global ────────────────────────────────────────────────
{
  const row = (scope: string, firstReplies: unknown) =>
    ({
      organizationId: "o",
      scope,
      enabled: true,
      systemPrompt: null,
      enabledTools: null,
      model: null,
      autoReply: null,
      minConfidence: null,
      humanThreshold: null,
      decisionModel: null,
      firstReplies,
      updatedAt: new Date(),
    }) as Parameters<typeof mergeAgentConfig>[0];

  const on = { enabled: true, appliesTo: "anuncios", steps: ["global"] };
  const chOn = { enabled: true, appliesTo: "todas", steps: ["canal"] };
  const chOff = { enabled: false, appliesTo: "anuncios", steps: ["canal"] };

  assert.equal(mergeAgentConfig(row("whatsapp", null), row("global", on)).firstReplies?.steps[0], "global", "el canal sin guion propio hereda el general");
  assert.equal(mergeAgentConfig(row("whatsapp", chOn), row("global", on)).firstReplies?.steps[0], "canal", "el del canal manda");
  assert.equal(mergeAgentConfig(row("whatsapp", chOff), row("global", on)).firstReplies, null, "apagarlo en el canal lo apaga aunque General esté activo");
  assert.equal(mergeAgentConfig(row("whatsapp", null), row("global", null)).firstReplies, null, "sin guion en ningún lado");
  assert.equal(mergeAgentConfig(undefined, undefined).firstReplies, null);
}

console.log("test-first-replies: OK");
