import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, FileSpreadsheet } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { checkSheetSource, getSheetSource, sheetOpenUrl } from "@/lib/sheets/source";
import { hasServiceAccount } from "@/lib/sheets/client";
import { saveSheetSourceAction } from "./actions";

export const metadata = { title: "Fuente de propiedades · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export default async function FuentePage({ searchParams }: PageProps<"/propiedades/fuente">) {
  const session = await requireRole("admin");
  if (!session) redirect("/propiedades");
  const sp = await searchParams;
  const probe = typeof sp.probar === "string" ? sp.probar.slice(0, 500) : "";
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  const [current, check] = await Promise.all([getSheetSource(session.organizationId), probe ? checkSheetSource(probe) : Promise.resolve(null)]);
  const serviceAccount = hasServiceAccount();

  return (
    <>
      <PageHeader
        title="Fuente de propiedades"
        subtitle="La hoja de Google es la fuente: el CRM y el bot reflejan lo que dice. Lo que no esté en la hoja nueva se pausa y el bot deja de ofrecerlo."
        actions={
          <Link href="/propiedades" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Propiedades
          </Link>
        }
      />
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">{ok}</p>}
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <FileSpreadsheet className="size-4 text-muted" strokeWidth={1.7} /> Hoja actual
          </h2>
          {current ? (
            <dl className="mt-3 grid gap-2 text-[13.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Identificador</dt>
                <dd className="truncate font-mono text-[12.5px] text-ink">{current.spreadsheetId}{current.gid ? ` · pestaña ${current.gid}` : ""}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Última sincronización</dt>
                <dd className="text-ink">
                  {current.lastRunAt ? current.lastRunAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "Nunca"}
                  {current.lastStatus === "error" ? " · con error" : current.lastStatus === "ok" ? ` · ${current.lastRowsUpserted ?? 0} de ${current.lastRowsSeen ?? 0} filas` : ""}
                </dd>
              </div>
              {current.lastError && <p className="rounded-lg bg-accent-red/10 px-3 py-2 text-[12.5px] text-accent-red">{current.lastError}</p>}
              <a
                href={current.openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
              >
                <ExternalLink className="size-4" strokeWidth={1.7} /> Abrir la hoja en Google
              </a>
              <p className="text-[12px] text-muted">Google pide iniciar sesión y aplica los permisos de la hoja: abrirla desde acá no la hace pública.</p>
            </dl>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">Todavía no hay una hoja conectada.</p>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-[15px] font-semibold text-ink">{current ? "Cambiar la hoja" : "Conectar una hoja"}</h2>
          <p className="mt-1 text-[12.5px] text-muted">
            {serviceAccount
              ? "Se lee con la cuenta de servicio: compartí la hoja con ella (solo lectura) y puede quedar privada."
              : "No hay cuenta de servicio configurada: la hoja tiene que estar publicada para que se pueda leer."}
          </p>
          <form method="get" className="mt-3 flex gap-2">
            <input name="probar" defaultValue={probe} required placeholder="https://docs.google.com/spreadsheets/d/…" className={`${field} flex-1`} />
            <Button type="submit" variant="secondary">Probar</Button>
          </form>

          {check && !check.ok && <p className="mt-3 rounded-lg bg-accent-red/10 px-3 py-2 text-[12.5px] text-accent-red">{check.error}</p>}
          {check && check.ok && (
            <div className="mt-4 grid gap-3 text-[13px]">
              <p className="text-ink">
                {check.analysis.rows} filas · <strong>{check.analysis.counts.importable}</strong> se pueden importar · leída por {check.mode}
              </p>
              {check.analysis.missing.length > 0 && (
                <ul className="grid gap-1 text-[12.5px]">
                  {check.analysis.missing.map((m) => (
                    <li key={m.field} className={m.level === "obligatoria" ? "text-accent-red" : "text-muted"}>
                      Falta «{m.label}» ({m.level}): {m.hint}
                    </li>
                  ))}
                </ul>
              )}
              {check.analysis.mapped.length > 0 && (
                <p className="text-[12px] text-muted">Columnas reconocidas: {check.analysis.mapped.map((m) => `${m.header} → ${m.label}`).join(" · ")}</p>
              )}
              {check.analysis.unused.length > 0 && <p className="text-[12px] text-muted">No se usan: {check.analysis.unused.join(", ")}</p>}
              {check.blockers.length > 0 ? (
                <p className="rounded-lg bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink">No se puede guardar todavía: {check.blockers.join(" ")}</p>
              ) : (
                <form action={saveSheetSourceAction} className="grid gap-2">
                  <input type="hidden" name="url" value={probe} />
                  {current && (current.spreadsheetId !== check.spreadsheetId || (current.gid ?? null) !== (check.gid ?? null)) && (
                    <p className="rounded-lg bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink">
                      Es otra hoja: las propiedades de la anterior que no estén en esta quedan pausadas (no se borran; las editadas a mano no se tocan).
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <Button type="submit">Guardar y sincronizar</Button>
                    <a href={sheetOpenUrl(check.spreadsheetId, check.gid)} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-primary hover:underline">
                      Abrir esta hoja
                    </a>
                  </div>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
