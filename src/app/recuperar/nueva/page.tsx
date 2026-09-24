import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordField } from "@/components/ui/password-field";
import { getUser } from "@/lib/supabase/server";
import { setNewPassword } from "../actions";

export const metadata = { title: "Nueva contraseña · Setter CRM" };

export default async function NuevaClavePage({ searchParams }: PageProps<"/recuperar/nueva">) {
  // Se llega acá con la sesión que abrió el enlace del correo. Sin esa sesión, no hay a quién cambiarle nada.
  const user = await getUser();
  if (!user) redirect("/recuperar?error=vencido");

  const params = await searchParams;
  const error =
    params.error === "corta"
      ? "La contraseña tiene que tener al menos 10 caracteres."
      : params.error === "1"
        ? "No se pudo guardar la contraseña. Pide un enlace nuevo."
        : null;

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-accent-orange/15">
            <span className="size-3.5 rounded-full bg-accent-orange" />
          </span>
          <span className="text-[18px] font-semibold text-ink">Setter CRM</span>
        </div>

        <form action={setNewPassword} className="rounded-card border border-line bg-card p-6 shadow-card">
          <h1 className="text-[20px] font-bold text-ink">Nueva contraseña</h1>
          <p className="mt-1 text-[13.5px] text-muted">Para {user.email}</p>

          <PasswordField
            className="mt-5"
            label="Contraseña nueva"
            autoComplete="new-password"
            withGenerator
            minLength={10}
            hint="Mínimo 10 caracteres. Usa el ojo para confirmar que la escribiste bien."
          />

          {error && <p className="mt-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

          <button
            type="submit"
            className="mt-5 h-10 w-full rounded-lg bg-primary text-[14px] font-medium text-white hover:bg-primary-hover"
          >
            Guardar y entrar
          </button>

          <div className="mt-5 border-t border-line pt-4 text-center">
            <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
