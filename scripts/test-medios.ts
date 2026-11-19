import assert from "node:assert/strict";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

import { fetchMedia } from "../src/lib/ai/media";
import { DEFAULT_REPLY_DELAY_SECONDS, MAX_REPLY_DELAY_SECONDS, mergeAgentConfig, parseReplyDelay } from "../src/lib/agent/config";
import { planIncoming, unusableAck, unusableReason } from "../src/lib/agent/triage/incoming";
import {
  attachmentsFromPayload,
  audioFormatFor,
  cleanDescription,
  cleanTranscript,
  derivedForPrompt,
  imageMimeFor,
  kindOfType,
  mediaFetchPlan,
  parseRange,
  responseMime,
  type Attachment,
} from "../src/lib/inbox/media";

// Medios entrantes (Fase 1): lectura de adjuntos, descarga segura, plan del triaje y espera antes de responder.
// Lógica pura: sin base, sin red y sin modelos.

// ─── Adjuntos del payload ───────────────────────────────────────────────────
{
  const webhook = {
    event: "message.received",
    message: {
      attachments: [
        { type: "audio", url: "https://zernio.com/api/v1/whatsapp/media/abc123", payload: { mime_type: "audio/ogg; codecs=opus" } },
        { type: "image", url: "https://zernio.com/api/v1/whatsapp/media/def456", payload: { filename: "foto.jpg" } },
      ],
    },
  };
  const list = attachmentsFromPayload(webhook);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((a) => a.kind), ["audio", "image"]);
  assert.deepEqual(list.map((a) => a.index), [0, 1]);
  assert.equal(list[0].mime, "audio/ogg; codecs=opus");
  assert.equal(list[1].name, "foto.jpg");

  // Un mensaje suelto (sin el envoltorio del webhook) también se lee.
  assert.equal(attachmentsFromPayload({ attachments: [{ type: "video", url: "https://cdn.example.com/v.mp4" }] })[0].kind, "video");

  // Mensajes sin medios, importados o con basura: lista vacía, nunca una excepción.
  assert.deepEqual(attachmentsFromPayload(null), []);
  assert.deepEqual(attachmentsFromPayload({ source: "import", sentVia: null }), []);
  assert.deepEqual(attachmentsFromPayload({ message: { attachments: "no es una lista" } }), []);
  assert.deepEqual(attachmentsFromPayload({ message: { attachments: [null, 5] } }).map((a) => a.kind), ["unknown", "unknown"]);

  // Una URL que no es https no se usa (queda como "no disponible").
  assert.equal(attachmentsFromPayload({ attachments: [{ type: "image", url: "http://inseguro.example/x.jpg" }] })[0].url, null);
  assert.equal(attachmentsFromPayload({ attachments: [{ type: "image", url: "javascript:alert(1)" }] })[0].url, null);

  // Tope de adjuntos por mensaje.
  assert.equal(attachmentsFromPayload({ attachments: Array.from({ length: 30 }, () => ({ type: "image", url: "https://a.example.com/x" })) }).length, 10);

  assert.equal(kindOfType("voice"), "audio");
  assert.equal(kindOfType("document"), "file");
  assert.equal(kindOfType("ig_reel"), "unknown");
  assert.equal(kindOfType(undefined), "unknown");
}

// ─── Descarga segura ────────────────────────────────────────────────────────
{
  // La clave de Zernio viaja SOLO al host de Zernio.
  const own = mediaFetchPlan("https://zernio.com/api/v1/whatsapp/media/abc");
  assert.deepEqual(own, { ok: true, url: "https://zernio.com/api/v1/whatsapp/media/abc", withAuth: true });
  const cdn = mediaFetchPlan("https://scontent.cdninstagram.com/v/x.jpg");
  assert.equal(cdn.ok && cdn.withAuth, false);
  // Un host que solo se PARECE al de Zernio no recibe la clave.
  for (const evil of ["https://zernio.com.evil.example/x", "https://evil-zernio.com/x", "https://zernio.com@evil.example/x"]) {
    const p = mediaFetchPlan(evil);
    assert.equal(p.ok && p.withAuth, false, `sin clave para ${evil}`);
  }
  // El servidor no puede usarse para mirar la red de adentro.
  for (const bad of [
    "http://zernio.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://base-interna/x",
    "https://servicio.internal/x",
    "https://impresora.local/x",
    "https://user:pass@zernio.com/x",
    "ftp://zernio.com/x",
    "no es una url",
    null,
  ]) {
    assert.equal(mediaFetchPlan(bad).ok, false, `rechaza ${String(bad)}`);
  }
}


// ─── Qué se sirve al navegador ──────────────────────────────────────────────
{
  assert.deepEqual(responseMime("audio/ogg; codecs=opus", "audio"), { type: "audio/ogg", inline: true });
  assert.deepEqual(responseMime("image/jpeg", "image"), { type: "image/jpeg", inline: true });
  assert.deepEqual(responseMime("video/mp4", "video"), { type: "video/mp4", inline: true });
  // Nada que el navegador pueda ejecutar: HTML y SVG bajan como descarga.
  assert.deepEqual(responseMime("text/html", "file"), { type: "application/octet-stream", inline: false });
  assert.deepEqual(responseMime("image/svg+xml", "image"), { type: "application/octet-stream", inline: false });
  // El tipo declarado no alcanza si el medio no es de ese tipo.
  assert.equal(responseMime("audio/ogg", "file").inline, false);
  assert.equal(responseMime(null, "audio").inline, false);
}

// ─── Range (Safari no reproduce sin él) ─────────────────────────────────────
{
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=0-99999", 1000), { start: 0, end: 999 });
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange("bytes=900-100", 1000), null);
  assert.equal(parseRange("bytes=2000-3000", 1000), null);
  assert.equal(parseRange("bytes=-", 1000), null);
  assert.equal(parseRange("items=0-5", 1000), null);
  assert.equal(parseRange("bytes=0-5", 0), null);
}

// ─── Formatos y limpieza de lo que devuelven los modelos ────────────────────
{
  assert.equal(audioFormatFor("audio/ogg; codecs=opus"), "ogg");
  assert.equal(audioFormatFor("audio/mpeg"), "mp3");
  assert.equal(audioFormatFor("audio/mp4"), "m4a");
  assert.equal(audioFormatFor(null), "ogg", "las notas de voz de WhatsApp son Ogg/Opus");

  assert.equal(imageMimeFor("image/jpg"), "image/jpeg");
  assert.equal(imageMimeFor("image/svg+xml"), null);
  assert.equal(imageMimeFor(null, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(imageMimeFor(null, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/png");
  assert.equal(imageMimeFor(null, new Uint8Array([1, 2, 3])), null);

  assert.equal(cleanTranscript("  Hola, busco un depto en Pichincha  "), "Hola, busco un depto en Pichincha");
  assert.equal(cleanTranscript("\"Quiero alquilar\""), "Quiero alquilar");
  assert.equal(cleanTranscript("```\nhola\n```"), "hola");
  assert.equal(cleanTranscript("[inaudible]"), null);
  assert.equal(cleanTranscript("Inaudible."), null);
  assert.equal(cleanTranscript(""), null);
  assert.equal(cleanTranscript(undefined), null);
  assert.equal(cleanTranscript("a".repeat(5000))?.length, 2000);

  assert.equal(cleanDescription("[ilegible]"), null);
  assert.equal(cleanDescription("Captura de un aviso: depto 2 ambientes, USD 85.000"), "Captura de un aviso: depto 2 ambientes, USD 85.000");
  assert.equal(cleanDescription("x".repeat(3000))?.length, 800);

  // El agente sabe que es una lectura automática (y no lo que la persona escribió).
  assert.match(derivedForPrompt("transcripcion", "hola"), /^\[Audio del cliente, transcripción automática\] hola$/);
  assert.match(derivedForPrompt("descripcion_imagen", "un cartel"), /descripción automática/);
}

// ─── Qué se le pasa al agente ───────────────────────────────────────────────
{
  const att = (kind: Attachment["kind"]): Attachment => ({ index: 0, kind, url: "https://zernio.com/x", mime: null, name: null });
  const audio = att("audio");
  const image = att("image");

  // Un audio bien leído entra como texto, marcado, y el texto crudo queda aparte (para detectar una baja).
  const ok = planIncoming({ caption: "", media: [audio], read: { ok: true, kind: "transcripcion", text: "busco alquilar en Centro", model: "m" } });
  assert.equal(ok.kind, "text");
  if (ok.kind === "text") {
    assert.match(ok.text, /transcripción automática\] busco alquilar en Centro/);
    assert.equal(ok.transcript, "busco alquilar en Centro");
  }

  // Un audio que falló, sin texto: nunca se descarta. Queda para una persona.
  const failed = planIncoming({ caption: "", media: [audio], read: { ok: false, kind: "transcripcion", error: "HTTP 502", unreadable: false } });
  assert.deepEqual(failed, { kind: "unusable", media: "audio", failed: true, unreadable: false, error: "HTTP 502" });
  if (failed.kind === "unusable") {
    assert.match(unusableReason(failed), /Mandó un audio y el sistema no lo pudo leer \(HTTP 502\)/);
    assert.equal(unusableAck("audio"), "Recibimos tu audio. Una persona del equipo lo va a revisar.");
  }

  // Un audio sin voz no es una falla del sistema.
  const mudo = planIncoming({ caption: "", media: [audio], read: { ok: false, kind: "transcripcion", error: "No se entendió el audio", unreadable: true } });
  assert.equal(mudo.kind === "unusable" && mudo.unreadable, true);
  if (mudo.kind === "unusable") assert.match(unusableReason(mudo), /no se pudo interpretar/);

  // Un video no se lee: queda para una persona, sin intento de lectura.
  const video = planIncoming({ caption: "", media: [att("video")], read: null });
  assert.deepEqual(video, { kind: "unusable", media: "video", failed: false, unreadable: false, error: null });
  if (video.kind === "unusable") assert.match(unusableReason(video), /Mandó un video, que el sistema no lee solo/);

  // Un sticker se ignora sin acuse; un contenido compartido, también.
  assert.equal(unusableAck("sticker"), null);
  assert.equal(unusableAck("share"), null);
  assert.equal(unusableAck("file"), "Recibimos tu archivo. Una persona del equipo lo va a revisar.");
  // Ningún acuse promete un plazo.
  for (const k of ["audio", "image", "video", "file", "unknown"] as const) assert.doesNotMatch(unusableAck(k) ?? "", /\d+\s*(h|hs|horas|min)|hoy|mañana|enseguida/i);

  // Una foto con pie de foto + descripción: las dos cosas llegan al agente.
  const foto = planIncoming({ caption: "me interesa esta", media: [image], read: { ok: true, kind: "descripcion_imagen", text: "Aviso: depto 2 amb, USD 85.000", model: "m" } });
  assert.equal(foto.kind, "text");
  if (foto.kind === "text") {
    assert.match(foto.text, /^me interesa esta\n\[Imagen del cliente, descripción automática\] Aviso/);
    assert.equal(foto.transcript, null);
  }

  // Pie de foto + descripción que falló: se atiende el texto y se aclara que la imagen no se leyó.
  const sinLeer = planIncoming({ caption: "mirá esta", media: [image], read: { ok: false, kind: "descripcion_imagen", error: "x", unreadable: false } });
  assert.equal(sinLeer.kind, "text");
  if (sinLeer.kind === "text") assert.match(sinLeer.text, /mirá esta\n\[Adjunto que el sistema no pudo leer: imagen\]/);

  // Texto + un video: se contesta el texto y se aclara que el video no se vio.
  const conVideo = planIncoming({ caption: "te mando el video", media: [att("video")], read: null });
  assert.equal(conVideo.kind === "text" && /no pudo leer: video/.test(conVideo.text), true);

  // Un sticker junto a texto no ensucia el mensaje.
  const conSticker = planIncoming({ caption: "hola", media: [att("sticker")], read: null });
  assert.deepEqual(conSticker, { kind: "text", text: "hola", transcript: null });
}

// ─── Espera antes de responder ──────────────────────────────────────────────
{
  assert.equal(parseReplyDelay(""), null);
  assert.equal(parseReplyDelay(null), null);
  assert.equal(parseReplyDelay(undefined), null);
  assert.equal(parseReplyDelay("abc"), null);
  assert.equal(parseReplyDelay("0"), 0, "el 0 es un valor válido: contestar enseguida");
  assert.equal(parseReplyDelay(0), 0);
  assert.equal(parseReplyDelay("12"), 12);
  assert.equal(parseReplyDelay("7,6"), 8);
  assert.equal(parseReplyDelay(-5), 0);
  assert.equal(parseReplyDelay(9999), MAX_REPLY_DELAY_SECONDS);

  const row = (scope: string, replyDelaySeconds: number | null) =>
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
      firstReplies: null,
      replyDelaySeconds,
      updatedAt: new Date(),
    }) as Parameters<typeof mergeAgentConfig>[0];

  assert.equal(mergeAgentConfig(undefined, undefined).replyDelaySeconds, DEFAULT_REPLY_DELAY_SECONDS);
  assert.equal(mergeAgentConfig(row("whatsapp", null), row("global", 20)).replyDelaySeconds, 20, "hereda de General");
  assert.equal(mergeAgentConfig(row("whatsapp", 10), row("global", 20)).replyDelaySeconds, 10, "el canal manda");
  assert.equal(mergeAgentConfig(row("whatsapp", 0), row("global", 20)).replyDelaySeconds, 0, "un 0 del canal no se confunde con vacío");
  assert.equal(DEFAULT_REPLY_DELAY_SECONDS, 5, "mismo comportamiento que antes de que fuera configurable");
}

// fetchMedia rechaza esos destinos sin salir a la red.
(async () => {
  for (const url of ["http://zernio.com/x", "https://127.0.0.1/x", "https://localhost/x", null]) {
    const r = await fetchMedia(url, { maxBytes: 1000 });
    assert.equal(r.ok, false, `fetchMedia rechaza ${String(url)}`);
  }
  console.log("test-medios: OK");
})();
