import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifrado de secretos de integraciones (claves de API de terceros). AES-256-GCM: cifra y autentica,
// así un valor alterado en la base no descifra. La clave vive SOLO en el servidor
// (INTEGRATIONS_ENCRYPTION_KEY, 32 bytes en base64). Sin ella no se guarda ni se lee ningún secreto.

function key(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

export const encryptionConfigured = () => key() !== null;

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("INTEGRATIONS_ENCRYPTION_KEY no está configurada (32 bytes en base64)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

/** Devuelve null si no hay clave, el formato no es el esperado o el valor fue alterado. Nunca tira. */
export function decryptSecret(stored: string): string | null {
  const k = key();
  if (!k) return null;
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
