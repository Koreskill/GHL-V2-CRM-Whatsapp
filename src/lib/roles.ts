import type { User } from "@supabase/supabase-js";

// Funciones PURAS de rol y tenencia, sin dependencias: las usa el proxy, que corre en el runtime
// de edge y no puede arrastrar el cliente de Postgres ni next/headers.
// Todo lo que necesite la base vive en auth.ts, que nunca se importa desde el proxy.

export type Role = "admin" | "agent";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El rol vive en app_metadata: solo se puede escribir con la clave de servicio o por SQL,
// nunca desde el cliente. Un usuario sin rol (por ejemplo, alguien que se registró solo) no entra.
export function roleOf(user: Pick<User, "app_metadata"> | null | undefined): Role | null {
  const role = user?.app_metadata?.crm_role;
  return role === "admin" || role === "agent" ? role : null;
}

// El tenant vive en app_metadata: resolución rápida (también en el proxy) sin ir a la base.
export function orgOf(user: Pick<User, "app_metadata"> | null | undefined): string | null {
  const org = user?.app_metadata?.organization_id;
  return typeof org === "string" && UUID.test(org) ? org : null;
}

// El admin de la agencia opera en un plano separado: puede actuar sobre cualquier inmobiliaria
// (con cambio de contexto explícito y auditado). Solo se setea por SQL/clave de servicio.
export function isAgencyAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.is_agency_admin === true;
}
