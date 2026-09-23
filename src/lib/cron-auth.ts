import { timingSafeEqual } from "node:crypto";

// Acepta Authorization: Bearer <CRON_SECRET> o x-cron-secret. Sin secreto configurado, rechaza.
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const given = bearer || req.headers.get("x-cron-secret") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
