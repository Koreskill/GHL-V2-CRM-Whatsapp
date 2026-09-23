import { getUser } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const jsonError = (status: number, error: string) => Response.json({ error }, { status });

export async function requireUser() {
  const user = await getUser();
  return user ?? null;
}
