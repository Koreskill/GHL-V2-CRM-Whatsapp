import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor as Db } from "@/db";
import { channelAccounts, type Channel } from "@/db/schema";
import { reportIncident, resolveIncidents } from "@/lib/incidents/report";
import { zernioRequest, type Result } from "./client";
import type { ConnectPlatform, ConnectUrlResponse, ListAccountsResponse, ZernioAccount } from "./types";

const CRM_CHANNELS: readonly Channel[] = ["whatsapp", "instagram", "facebook"];
const PAGE_SIZE = 100;

export function isCrmChannel(platform: string): platform is Channel {
  return (CRM_CHANNELS as readonly string[]).includes(platform);
}

export async function listAccounts(): Promise<Result<ZernioAccount[]>> {
  const all: ZernioAccount[] = [];
  for (let page = 1; ; page++) {
    const res = await zernioRequest<ListAccountsResponse>("GET", "/v1/accounts", {
      query: { profileId: process.env.ZERNIO_PROFILE_ID, page, limit: PAGE_SIZE },
    });
    if (!res.success) return res;
    all.push(...res.data.accounts);
    if (res.data.accounts.length < PAGE_SIZE) return { success: true, data: all };
  }
}

export function getConnectUrl(platform: ConnectPlatform, redirectUrl: string, opts: { hostedSignup?: boolean } = {}) {
  const profileId = process.env.ZERNIO_PROFILE_ID;
  if (!profileId) {
    return Promise.resolve<Result<ConnectUrlResponse>>({
      success: false,
      error: { status: 0, message: "ZERNIO_PROFILE_ID no está configurada" },
    });
  }
  return zernioRequest<ConnectUrlResponse>("GET", `/v1/connect/${platform}`, {
    // WhatsApp: signup=hosted abre el Embedded Signup de Meta desde una página de Zernio.
    query: { profileId, redirect_url: redirectUrl, ...(opts.hostedSignup ? { signup: "hosted" } : {}) },
  });
}

export type AccountSnapshot = {
  externalId: string;
  channel: Channel;
  name: string | null;
  handle: string | null;
  status: "connected" | "disconnected";
  metadata?: Record<string, unknown>;
};

// Actualiza una cuenta que YA pertenece a una inmobiliaria. Una cuenta desconocida NO se inserta:
// ni el webhook ni el listado de Zernio dicen a qué inmobiliaria corresponde, y asumir una (antes
// DEFAULT_ORG_ID) dejaba la bandeja de un cliente en manos de otro. Queda un incidente de agencia
// "cuenta sin asignar" para que la agencia la asigne. Devuelve si la cuenta tenía dueño.
export async function applyAccountSnapshot(db: Db, a: AccountSnapshot): Promise<{ assigned: boolean }> {
  const updated = await db
    .update(channelAccounts)
    .set({
      status: a.status,
      ...(a.name ? { name: a.name } : {}),
      ...(a.handle ? { handle: a.handle } : {}),
      metadata: sql`${channelAccounts.metadata} || ${JSON.stringify(a.metadata ?? {})}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(channelAccounts.provider, "zernio"), eq(channelAccounts.externalId, a.externalId)))
    .returning({ id: channelAccounts.id });
  if (updated.length > 0) {
    await resolveIncidents(null, "mensajeria", `cuenta-sin-asignar:${a.externalId}`);
    return { assigned: true };
  }

  await reportIncident({
    organizationId: null,
    module: "mensajeria",
    severity: "advertencia",
    message: `Cuenta de ${a.channel} sin asignar${a.handle ? ` (@${a.handle})` : ""}: asignala a una inmobiliaria para que entren sus mensajes.`,
    key: `cuenta-sin-asignar:${a.externalId}`,
    context: { externalId: a.externalId, channel: a.channel, name: a.name, handle: a.handle },
  });
  return { assigned: false };
}

// Refleja en channel_accounts el estado de las cuentas de WhatsApp/Instagram/Facebook en Zernio.
// Solo toca las que ya tienen inmobiliaria; las demás quedan como incidente de agencia.
export async function syncChannelAccounts(db: Db): Promise<Result<{ synced: number; unassigned: number }>> {
  const res = await listAccounts();
  if (!res.success) return res;

  let synced = 0;
  let unassigned = 0;
  for (const a of res.data.filter((x) => isCrmChannel(x.platform))) {
    const out = await applyAccountSnapshot(db, {
      externalId: a._id,
      channel: a.platform as Channel,
      name: a.displayName ?? a.username ?? null,
      handle: a.username ?? null,
      status: a.isActive ? "connected" : "disconnected",
      metadata: { profilePicture: a.profilePicture ?? null },
    });
    if (out.assigned) synced++;
    else unassigned++;
  }
  return { success: true, data: { synced, unassigned } };
}
