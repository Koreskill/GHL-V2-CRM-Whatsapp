import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { accessRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { orgOf, roleOf } from "@/lib/roles";
import { getUser } from "@/lib/supabase/server";
import { signOut } from "../login/actions";

export const metadata = { title: "Acceso pendiente · Setter CRM" };

// Identidad válida pero sin inmobiliaria/rol: no muestra nada del CRM. Es pública en el proxy
// porque ahí todavía no hay rol; valida la sesión acá mismo.
export default async function AccesoPendientePage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (roleOf(user) && orgOf(user)) redirect("/");

  const [req] = await getDb()
    .select({ status: accessRequests.status })
    .from(accessRequests)
    .where(eq(accessRequests.userId, user.id));
  const rejected = req?.status === "rejected";

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-card p-6 text-center shadow-card">
        <h1 className="text-[20px] font-bold text-ink">{rejected ? "Acceso no habilitado" : "Acceso pendiente"}</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          {rejected
            ? "Tu solicitud no fue aprobada. Si crees que es un error, contacta a tu administrador."
            : `Ingresaste como ${user.email}. Una persona de tu inmobiliaria o de la agencia tiene que habilitarte antes de que puedas ver datos. Te avisamos cuando esté listo, o pide una invitación.`}
        </p>
        <form action={signOut} className="mt-5">
          <button type="submit" className="h-10 w-full rounded-lg border border-line bg-card text-[14px] font-medium text-ink hover:bg-field">
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
