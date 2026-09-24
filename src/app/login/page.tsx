import Link from "next/link";
import { PasswordField } from "@/components/ui/password-field";
import { signIn } from "./actions";

export const metadata = { title: "Ingresar · Setter CRM" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" && params.next.startsWith("/") && !params.next.startsWith("//") ? params.next : "/";
  const error =
    params.error === "1"
      ? "Email o contraseña incorrectos."
      : params.error === "sin_acceso"
        ? "Tu usuario no tiene acceso a Setter CRM. Pedile a un administrador que te habilite."
        : params.error === "limite"
          ? "Demasiados intentos. Espera unos minutos y vuelve a probar."
          : null;
  const aviso = params.aviso === "clave_lista" ? "Contraseña actualizada. Entra con la nueva." : null;

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-accent-orange/15">
            <span className="size-3.5 rounded-full bg-accent-orange" />
          </span>
          <span className="text-[18px] font-semibold text-ink">Setter CRM</span>
        </div>

        <form action={signIn} className="rounded-card border border-line bg-card p-6 shadow-card">
          <h1 className="text-[20px] font-bold text-ink">Ingresar</h1>
          <p className="mt-1 text-[13.5px] text-muted">Usa el email y la contraseña de tu cuenta.</p>

          <input type="hidden" name="next" value={next} />

          <label className="mt-5 block text-[13px] font-medium text-ink" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none"
          />

          <PasswordField id="password" className="mt-4" />

          {aviso && (
            <p className="mt-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">{aviso}</p>
          )}
          {error && <p className="mt-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

          <button
            type="submit"
            className="mt-5 h-10 w-full rounded-lg bg-primary text-[14px] font-medium text-white hover:bg-primary-hover"
          >
            Ingresar
          </button>

          <div className="mt-5 border-t border-line pt-4 text-center">
            <Link href="/recuperar" className="text-[13px] font-medium text-primary hover:underline">
              Olvidé mi contraseña
            </Link>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Tu usuario es tu email. Si no lo recuerdas, pedíselo al administrador de tu inmobiliaria.
            </p>
          </div>
        </form>
      </div>
    </main>
  );
}
