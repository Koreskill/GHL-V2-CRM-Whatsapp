import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { channelAccounts, type Channel } from "@/db/schema";
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

export function getConnectUrl(platform: ConnectPlatform, redirectUrl: string) {
  const profileId = process.env.ZERNIO_PROFILE_ID;
  if (!profileId) {
    return Promise.resolve<Result<ConnectUrlResponse>>({
      success: false,
      error: { status: 0, message: "ZERNIO_PROFILE_ID no está configurada" },
    });
  }
  return zernioRequest<ConnectUrlResponse>("GET", `/v1/connect/${platform}`, {
    query: { profileId, redirect_url: redirectUrl },
  });
}

// Refleja en channel_accounts las cuentas de WhatsApp/Instagram/Facebook conectadas en Zernio.
export async function syncChannelAccounts(db: Db): Promise<Result<{ synced: number }>> {
  const res = await listAccounts();
  if (!res.success) return res;

  const rows = res.data
    .filter((a) => isCrmChannel(a.platform))
    .map((a) => ({
      provider: "zernio" as const,
      channel: a.platform as Channel,
      externalId: a._id,
      name: a.displayName ?? a.username ?? null,
      handle: a.username ?? null,
      status: a.isActive ? "connected" : "disconnected",
      metadata: { profilePicture: a.profilePicture ?? null },
    }));

  if (rows.length > 0) {
    await db
      .insert(channelAccounts)
      .values(rows)
      .onConflictDoUpdate({
        target: channelAccounts.externalId,
        set: {
          name: sql`excluded.name`,
          handle: sql`excluded.handle`,
          status: sql`excluded.status`,
          metadata: sql`excluded.metadata`,
          updatedAt: sql`now()`,
        },
      });
  }
  return { success: true, data: { synced: rows.length } };
}
