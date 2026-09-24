import Link from "next/link";
import { requestReset } from "./actions";

export const metadata = { title: "Recuperar contraseña · Setter CRM" };

export default async function RecuperarPage({ searchParams }: PageProps<"/recuperar">) {
  const params = await searchParams;
  const enviado = params.enviado === "1";
  const error =
    params.error === "limite"
      ? "Demasiados pedidos. Espera unos minutos y vuelve a probar."
      : params.error === "vencido"
        ? "El enlace venció. Pide uno nuevo."
        : params.error === "1"
          ? "Escribe tu email."
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

        <div className="rounded-card border border-line bg-card p-6 shadow-card">
          <h1 className="text-[20px] font-bold text-ink">Recuperar contraseña</h1>

          {enviado ? (
            <>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                Si ese email tiene una cuenta, te mandamos un enlace para poner una contraseña nueva. Revisa
                también el correo no deseado. El enlace vence en una hora.
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                Si no te llega nada, el administrador de tu inmobiliaria puede ponerte una contraseña nueva a mano.
              </p>
            </>
          ) : (
            <form action={requestReset}>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                Escribe tu email y te mandamos un enlace para poner una contraseña nueva. La contraseña anterior
                no se puede ver: está guardada cifrada y nadie la puede leer.
              </p>

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

              {error && (
                <p className="mt-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>
              )}

              <button
                type="submit"
                className="mt-5 h-10 w-full rounded-lg bg-primary text-[14px] font-medium text-white hover:bg-primary-hover"
              >
                Enviar enlace
              </button>
            </form>
          )}

          <div className="mt-5 border-t border-line pt-4 text-center">
            <Link href="/login" className="text-[13px] font-medium text-primary hover:underline">
              Volver a ingresar
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
