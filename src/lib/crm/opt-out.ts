// Baja de mensajes comerciales. Lógica pura.
//
// Solo cuenta como baja un mensaje que ES el pedido (escribió "BAJA" o "no me escriban más"), no uno
// que lo menciona ("¿la baja de precio sigue?"). Un falso positivo saca a un interesado de todas las
// campañas, así que se prefiere no detectar a detectar de más: el equipo también la puede marcar a mano.

const EXACT = new Set([
  "baja",
  "stop",
  "parar",
  "detener",
  "unsubscribe",
  "desuscribir",
  "desuscribirme",
  "cancelar suscripcion",
  "dar de baja",
  "darme de baja",
  "quiero darme de baja",
  "no me escriban",
  "no me escriban mas",
  "no me manden mas mensajes",
  "no quiero recibir mas mensajes",
  "no quiero mas mensajes",
  "no me envien mas mensajes",
  "basta de mensajes",
]);

export function normalizeForOptOut(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOptOutRequest(text: string | null | undefined): boolean {
  if (!text) return false;
  const n = normalizeForOptOut(text);
  if (!n || n.length > 60) return false;
  if (EXACT.has(n)) return true;
  // "baja por favor", "por favor baja", "stop gracias".
  const words = n.split(" ").filter((w) => !["por", "favor", "gracias", "porfa", "x", "fa"].includes(w));
  return words.length > 0 && EXACT.has(words.join(" "));
}

export const OPT_OUT_ACK =
  "Listo, no te vamos a enviar más mensajes promocionales. Si en algún momento querés consultar por una propiedad, escribinos por acá.";
