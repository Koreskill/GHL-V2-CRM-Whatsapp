import { createSign } from "node:crypto";

/**
 * Lectura de una hoja de Google, sin SDK (fetch nativo), con dos caminos:
 *
 *  1. Cuenta de servicio (GOOGLE_SERVICE_ACCOUNT_JSON): funciona con hojas PRIVADAS, compartidas
 *     solo con el email de la cuenta de servicio. Es el camino recomendado: la cartera suele tener
 *     observaciones internas que no deberían quedar accesibles con el link.
 *  2. Export CSV público: si no hay cuenta de servicio, se pide la hoja publicada. Requiere que
 *     esté compartida como "cualquiera con el enlace", así que TODO lo de la hoja queda expuesto
 *     a quien tenga la URL.
 *
 * Nunca tira excepción: devuelve { success } como el resto de los clientes del proyecto.
 */
export type SheetResult =
  | { success: true; rows: string[][]; mode: "service_account" | "csv_publico" }
  | { success: false; error: string };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // En las variables de entorno los saltos de línea suelen venir escapados.
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

export const hasServiceAccount = () => serviceAccount() !== null;

const b64url = (input: string | Buffer) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Token OAuth por JWT firmado (flujo de cuenta de servicio). Se cachea hasta poco antes de vencer.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );

  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    signature = b64url(signer.sign(sa.private_key));
  } catch {
    return null; // clave mal formada
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  }).catch(() => null);

  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!data?.access_token) return null;

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

// Un CSV puede traer comas y saltos de línea dentro de comillas: no alcanza con split(",").
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // comilla escapada
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function readSheet(spreadsheetId: string, gid?: string | null): Promise<SheetResult> {
  const sa = serviceAccount();

  if (sa) {
    const token = await accessToken(sa);
    if (!token) {
      return { success: false, error: "No se pudo autenticar la cuenta de servicio de Google" };
    }
    // Sin rango: la API devuelve la hoja entera de la primera pestaña.
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A:Z`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res) return { success: false, error: "No se pudo contactar a Google Sheets" };
    if (res.status === 403) {
      return {
        success: false,
        error: `La hoja no está compartida con ${sa.client_email}. Compartila con ese email como lector.`,
      };
    }
    if (res.status === 404) return { success: false, error: "No existe una hoja con ese identificador" };
    if (!res.ok) return { success: false, error: `Google Sheets respondió ${res.status}` };

    const data = (await res.json().catch(() => null)) as { values?: string[][] } | null;
    return { success: true, rows: data?.values ?? [], mode: "service_account" };
  }

  // Respaldo sin credenciales: export CSV de una hoja publicada.
  const params = new URLSearchParams({ format: "csv" });
  if (gid) params.set("gid", gid);
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?${params}`;
  const res = await fetch(url, { redirect: "follow" }).catch(() => null);
  if (!res) return { success: false, error: "No se pudo contactar a Google Sheets" };
  if (!res.ok) {
    return {
      success: false,
      error:
        res.status === 404
          ? "No existe una hoja con ese identificador"
          : "La hoja no es accesible. Compartila como «cualquiera con el enlace» o configura una cuenta de servicio.",
    };
  }

  const text = await res.text();
  // Google devuelve una página HTML de login cuando la hoja no es pública.
  if (text.trimStart().toLowerCase().startsWith("<!doctype html")) {
    return {
      success: false,
      error: "La hoja no es pública. Compartila como «cualquiera con el enlace» o configura una cuenta de servicio.",
    };
  }
  return { success: true, rows: parseCsv(text), mode: "csv_publico" };
}

// Acepta la URL completa de la hoja o el id pelado.
export function parseSpreadsheetRef(input: string): { spreadsheetId: string; gid: string | null } | null {
  const value = input.trim();
  if (!value) return null;
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = fromUrl?.[1] ?? (/^[a-zA-Z0-9-_]{20,}$/.test(value) ? value : null);
  if (!spreadsheetId) return null;
  const gid = value.match(/[#&?]gid=(\d+)/)?.[1] ?? null;
  return { spreadsheetId, gid };
}
