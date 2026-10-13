import { handleGoogleNotification } from "@/lib/calendar/google/outbox";

export const dynamic = "force-dynamic";

// Notificaciones push de Google Calendar. NO traen el evento: solo avisan que hubo cambios. Se valida el
// token del canal y se encola una conciliación; la respuesta es siempre 200 y rápida (Google reintenta y
// puede entregar duplicados).
export async function POST(req: Request) {
  await handleGoogleNotification(req.headers).catch(() => {});
  return new Response(null, { status: 200 });
}
