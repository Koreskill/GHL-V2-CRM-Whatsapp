import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Layers, Tag, Trash2 } from "lucide-react";
import { LABEL_COLOR_NAME, LABEL_TONE } from "@/components/contacts/label-tone";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { LABEL_COLORS, listGroups, listLabels } from "@/lib/crm/groups";
import { cn } from "@/lib/utils";
import { deleteGroupAction, deleteLabelAction, saveGroupAction, saveLabelAction } from "../actions";

export const metadata = { title: "Grupos y etiquetas · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export default async function OrganizarPage({ searchParams }: PageProps<"/contactos/organizar">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const orgId = session.organizationId;
  const sp = await searchParams;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  const [groups, labels] = await Promise.all([listGroups(orgId), listLabels(orgId)]);
  const isAdmin = session.role === "admin";

  return (
    <>
      <PageHeader
        title="Grupos y etiquetas"
        subtitle="Una etiqueta es un atributo del contacto. Un grupo es una lista armada a mano. Un segmento (en Contactos) es un criterio que se recalcula solo."
        actions={
          <Link href="/contactos" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Contactos
          </Link>
        }
      />
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">{ok}</p>}
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <Layers className="size-4 text-muted" strokeWidth={1.7} /> Grupos
          </h2>
          <form action={saveGroupAction} className="mt-4 grid gap-2">
            <input name="name" required maxLength={60} placeholder="Nombre del grupo (ej.: Inversores 2026)" className={field} />
            <input name="description" maxLength={300} placeholder="Para qué es (opcional)" className={field} />
            <div>
              <Button type="submit">Crear grupo</Button>
            </div>
          </form>
          {groups.length === 0 ? (
            <EmptyState icon={Layers} title="Sin grupos" description="Creá uno y sumá contactos desde el listado: tildalos y elegí «Agregar al grupo»." className="py-10" />
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {groups.map((g) => (
                <li key={g.id} className="py-3">
                  <form action={saveGroupAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={g.id} />
                    <input name="name" defaultValue={g.name} required maxLength={60} className={cn(field, "w-48")} aria-label="Nombre del grupo" />
                    <input name="description" defaultValue={g.description ?? ""} maxLength={300} placeholder="Descripción" className={cn(field, "min-w-40 flex-1")} aria-label="Descripción" />
                    <Button type="submit" variant="secondary">Guardar</Button>
                  </form>
                  <div className="mt-1.5 flex items-center gap-3 text-[12.5px] text-muted">
                    <Link href={`/contactos?grupo=${g.id}`} className="text-primary hover:underline">
                      {g.n} {g.n === 1 ? "contacto" : "contactos"}
                    </Link>
                    {isAdmin && (
                      <form action={deleteGroupAction}>
                        <input type="hidden" name="id" value={g.id} />
                        <button type="submit" className="inline-flex items-center gap-1 text-muted hover:text-accent-red" title="Borra el grupo, no los contactos">
                          <Trash2 className="size-3.5" strokeWidth={1.7} /> Borrar grupo
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
            <Tag className="size-4 text-muted" strokeWidth={1.7} /> Etiquetas
          </h2>
          <form action={saveLabelAction} className="mt-4 flex flex-wrap gap-2">
            <input name="name" required maxLength={40} placeholder="Nombre (ej.: Referido)" className={cn(field, "flex-1")} />
            <ColorSelect />
            <Button type="submit">Crear etiqueta</Button>
          </form>
          {labels.length === 0 ? (
            <EmptyState icon={Tag} title="Sin etiquetas" description="Las etiquetas se usan para filtrar, segmentar y armar campañas." className="py-10" />
          ) : (
            <ul className="mt-5 divide-y divide-line">
              {labels.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", LABEL_TONE[l.color])}>{l.name}</span>
                  <form action={saveLabelAction} className="flex flex-1 flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={l.id} />
                    <input name="name" defaultValue={l.name} required maxLength={40} className={cn(field, "w-40")} aria-label="Nombre de la etiqueta" />
                    <ColorSelect value={l.color} />
                    <Button type="submit" variant="secondary">Guardar</Button>
                  </form>
                  <Link href={`/contactos?etiqueta=${l.id}`} className="text-[12.5px] text-primary hover:underline">
                    {l.n}
                  </Link>
                  {isAdmin && (
                    <form action={deleteLabelAction}>
                      <input type="hidden" name="id" value={l.id} />
                      <button type="submit" className="grid size-8 place-items-center rounded-lg text-muted hover:text-accent-red" title="Borra la etiqueta, no los contactos">
                        <Trash2 className="size-3.5" strokeWidth={1.7} />
                        <span className="sr-only">Borrar etiqueta {l.name}</span>
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ColorSelect({ value = "slate" }: { value?: string }) {
  return (
    <select name="color" defaultValue={value} className={field} aria-label="Color">
      {LABEL_COLORS.map((c) => (
        <option key={c} value={c}>
          {LABEL_COLOR_NAME[c]}
        </option>
      ))}
    </select>
  );
}
