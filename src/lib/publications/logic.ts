import { randomBytes } from "node:crypto";

// Lógica pura de la ficha pública (sin base de datos): elegibilidad, qué se muestra y la marca.

export const COWIN_BRAND = { name: "Cowin", color: "#1d4943" } as const;

// Colores aprobados para la marca de una inmobiliaria: no se acepta un color libre.
export const BRAND_COLORS = [
  { id: "teal", label: "Verde petróleo", hex: "#1d4943" },
  { id: "blue", label: "Azul", hex: "#1d4ed8" },
  { id: "purple", label: "Violeta", hex: "#6d28d9" },
  { id: "green", label: "Verde", hex: "#15803d" },
  { id: "orange", label: "Naranja", hex: "#c2410c" },
  { id: "red", label: "Rojo", hex: "#b91c1c" },
  { id: "slate", label: "Pizarra", hex: "#334155" },
] as const;

export type Branding = {
  name: string | null;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  legal: string | null;
  colorId: string | null;
};

const httpsUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Lee organizations.metadata.branding validando cada campo: lo guardado nunca se confía a ciegas. */
export function resolveBranding(metadata: Record<string, unknown> | null | undefined): Branding {
  const raw = (metadata?.branding ?? {}) as Record<string, unknown>;
  const colorId = typeof raw.colorId === "string" && BRAND_COLORS.some((c) => c.id === raw.colorId) ? raw.colorId : null;
  return {
    name: str(raw.name, 80),
    logoUrl: httpsUrl(raw.logoUrl),
    phone: normalizePhone(raw.phone),
    email: typeof raw.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim()) ? raw.email.trim().slice(0, 120) : null,
    legal: str(raw.legal, 600),
    colorId,
  };
}

export const brandHex = (colorId: string | null) => BRAND_COLORS.find((c) => c.id === colorId)?.hex ?? COWIN_BRAND.color;

/** Solo dígitos, entre 8 y 15 (formato internacional sin "+"): lo que necesita wa.me. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Token del link público: aleatorio, corto y sin relación con el id interno. */
export const newSlug = () => randomBytes(9).toString("base64url");
export const isSlug = (value: string) => /^[A-Za-z0-9_-]{8,32}$/.test(value);

type PublishableProperty = {
  title: string | null;
  price: number | null;
  status: string;
  coverUrl: string | null;
  galleryUrls: string[];
  photos: string[];
};

/** Fotos aptas para mostrar: solo https, sin repetir, portada primero. */
export function publicImages(p: Pick<PublishableProperty, "coverUrl" | "galleryUrls" | "photos">): string[] {
  const seen = new Set<string>();
  for (const candidate of [p.coverUrl, ...p.galleryUrls, ...p.photos]) {
    const url = httpsUrl(candidate);
    if (url) seen.add(url);
  }
  return [...seen];
}

/** Qué falta para poder publicar. Vacío = se puede. Nunca se completa un dato por las nuestras. */
export function publishBlockers(p: PublishableProperty, branding: Branding): string[] {
  const out: string[] = [];
  if (!p.title?.trim()) out.push("Falta el título.");
  if (p.price === null || p.price <= 0) out.push("Falta el precio.");
  if (publicImages(p).length === 0) out.push("Falta al menos una foto (enlace https).");
  if (p.status !== "disponible" && p.status !== "reservada") out.push("La propiedad tiene que estar disponible o reservada.");
  if (!branding.phone) out.push("Falta un teléfono de contacto en Configuración → Marca.");
  return out;
}

/** Ubicación aproximada: zona y ciudad. La dirección solo si se autorizó Y existe la publicable. */
export function publicLocation(p: { zone: string | null; city: string | null; addressPublic: string | null }, showAddress: boolean): string | null {
  const area = [p.zone, p.city].filter(Boolean).join(", ");
  if (showAddress && p.addressPublic) return [p.addressPublic, area].filter(Boolean).join(" · ");
  return area || null;
}
