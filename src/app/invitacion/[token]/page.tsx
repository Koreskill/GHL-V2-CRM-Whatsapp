import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { acceptInvitationAction } from "../actions";

export const metadata = { title: "Invitación · Setter CRM" };

const MSG: Record<string, string> = {
  invalida: "Esta invitación no es válida o ya se usó.",
  vencida: "Esta invitación venció. Pide una nueva.",
  otro_email: "Esta invitación es para otro email. Entra con la cuenta a la que fue enviada.",
  otra_inmobiliaria: "Tu cuenta ya pertenece a otra inmobiliaria. Pide a la agencia que la dé de baja allí primero.",
  email_no_verificado: "Tu email todavía no está verificado.",
  error: "No pudimos habilitar tu acceso. Prueba de nuevo.",
  limite: "Demasiados intentos. Espera unos minutos.",
};

export default async function InvitacionPage({ params, searchParams }: PageProps<"/invitacion/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const user = await getUser();
  const error = typeof sp.error === "string" ? (MSG[sp.error] ?? MSG.error) : null;
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-6 text-center shadow-card">
        <h1 className="text-[20px] font-bold text-ink">Invitación a Setter CRM</h1>
        {error && <p className="mt-3 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
        {user ? (
          <form action={acceptInvitationAction} className="mt-4">
            <input type="hidden" name="token" value={token} />
            <p className="mb-4 text-[13.5px] text-muted">Vas a aceptar la invitación con {user.email}.</p>
            <button type="submit" className="h-10 w-full rounded-lg bg-primary text-[14px] font-medium text-white hover:bg-primary-hover">
              Aceptar invitación
            </button>
          </form>
        ) : (
          <div className="mt-4">
            <p className="mb-4 text-[13.5px] text-muted">Ingresa con el email al que llegó la invitación para aceptarla.</p>
            <Link
              href={`/login?next=${encodeURIComponent(`/invitacion/${token}`)}`}
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary text-[14px] font-medium text-white hover:bg-primary-hover"
            >
              Ingresar
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
