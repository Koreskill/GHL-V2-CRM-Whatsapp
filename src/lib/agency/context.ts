import { cookies } from "next/headers";

// Cookie del cambio de contexto: en qué inmobiliaria está parado el admin de la agencia.
// httpOnly para que ningún script de la página la pueda leer ni escribir. Su valor SOLO se
// respeta si el usuario es agency admin: getSession() lo revalida contra app_metadata en cada
// request, así que tener la cookie no alcanza para entrar a ningún lado.
export const ACTING_ORG_COOKIE = "crm_acting_org";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readActingOrgCookie(): Promise<string | null> {
  const value = (await cookies()).get(ACTING_ORG_COOKIE)?.value;
  return value && UUID.test(value) ? value : null;
}

export async function writeActingOrgCookie(orgId: string | null) {
  const store = await cookies();
  if (!orgId) {
    store.delete(ACTING_ORG_COOKIE);
    return;
  }
  store.set(ACTING_ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 3600, // una jornada de trabajo; después vuelve a su propia inmobiliaria
  });
}
