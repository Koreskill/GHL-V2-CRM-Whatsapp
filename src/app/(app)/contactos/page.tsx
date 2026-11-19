import Link from "next/link";
import { Copy, GitBranch, Layers, Megaphone, MessageCircle, Search, Users, X } from "lucide-react";
import { ChannelBadge } from "@/components/channel-badge";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { ContactPanel } from "@/components/contacts/contact-panel";
import { ContactTagsBar } from "@/components/tags/contact-tags-bar";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { properties } from "@/db/schema";
import { contactFiltersToParams, hasContactFilters, parseContactFilters, type ContactFilters } from "@/lib/crm/contact-filters";
import { getContactDetail } from "@/lib/crm/contact-detail";
import { listContactViews } from "@/lib/crm/views";
import { describeFilters } from "@/lib/crm/describe-filters";
import { contactFiltersFromJson } from "@/lib/crm/contact-filters";
import { labelsForContacts, listGroups, listLabels } from "@/lib/crm/groups";
import { LABEL_TONE } from "@/components/contacts/label-tone";
import { bulkContactsAction, deleteContactView, saveContactView } from "./actions";
import { countContacts, listContacts } from "@/lib/crm/queries";
import { getContactTagSummaries } from "@/lib/crm/tags";
import { formatListDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

const PAGE_SIZE = 25;
const field = "h-8 rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink focus:border-primary focus:outline-none";

function href(f: ContactFilters, extra: Record<string, string | number | undefined> = {}) {
  const p = contactFiltersToParams(f);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  const qs = p.toString();
  return qs ? `/contactos?${qs}` : "/contactos";
}

export default async function ContactosPage({ searchParams }: PageProps<"/contactos">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const orgId = session.organizationId;
  const sp = await searchParams;
  const filters = parseContactFilters(sp);
  const page = Math.max(1, Number(typeof sp.pagina === "string" ? sp.pagina : 1) || 1);
  const contactId = typeof sp.contacto === "string" ? sp.contacto : null;

  const [contacts, total, matched, views, detail, groups, labels] = await Promise.all([
    listContacts(orgId, { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countContacts(orgId),
    countContacts(orgId, filters),
    listContactViews(orgId, session.user.id),
    contactId && /^[0-9a-f-]{36}$/i.test(contactId) ? getContactDetail(orgId, contactId) : Promise.resolve(null),
    listGroups(orgId),
    listLabels(orgId),
  ]);
  const labelsByContact = await labelsForContacts(orgId, contacts.map((c) => c.id));
  const names = { labels: new Map(labels.map((l) => [l.id, l.name])), groups: new Map(groups.map((g) => [g.id, g.name])) };
  const notice = typeof sp.aviso === "string" ? sp.aviso : null;
  const propertyOptions = await getDb()
    .select({ id: properties.id, title: properties.title })
    .from(properties)
    .where(eq(properties.organizationId, orgId))
    .orderBy(asc(properties.title))
    .limit(500);
  const tagsByContact = await getContactTagSummaries(contacts.map((c) => c.id), orgId);
  const filtered = hasContactFilters(filters);
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const filtersQs = contactFiltersToParams(filters).toString();
  const closeHref = href(filters, { pagina: page > 1 ? page : undefined });

  return (
    <>
      <PageHeader
        title="Contactos"
        subtitle={`${total} ${total === 1 ? "persona" : "personas"} que escribieron por algún canal`}
        actions={
          <div className="flex gap-2">
            <Link href="/contactos/organizar" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
              <Layers className="size-4" strokeWidth={1.7} /> Grupos y etiquetas
            </Link>
            <Link href="/contactos/duplicados" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
              <Copy className="size-4" strokeWidth={1.7} /> Posibles duplicados
            </Link>
          </div>
        }
      />
      {notice && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">{notice}</p>}

      {views.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase" title="Un segmento es un criterio guardado: se vuelve a calcular cada vez que se usa">Segmentos</span>
          {views.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-card pl-3 text-[12.5px] text-ink">
              <Link
                href={v.query ? `/contactos?${v.query}` : "/contactos"}
                title={`Criterio: ${describeFilters(contactFiltersFromJson(Object.fromEntries(new URLSearchParams(v.query))), names).join(", ") || "todos"}`}
                className="py-1 hover:underline"
              >
                {v.name}
                {v.shared && <span className="ml-1 text-muted">· compartida</span>}
              </Link>
              {v.mine ? (
                <form action={deleteContactView}>
                  <input type="hidden" name="id" value={v.id} />
                  <button type="submit" title="Borrar vista" className="grid size-6 place-items-center rounded-full text-muted hover:text-accent-red">
                    <X className="size-3" strokeWidth={2} />
                    <span className="sr-only">Borrar vista {v.name}</span>
                  </button>
                </form>
              ) : (
                <span className="w-2" />
              )}
            </span>
          ))}
        </div>
      )}

      <form action="/contactos" className="mb-5 rounded-card border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-field px-3 text-muted">
            <Search className="size-4" strokeWidth={1.8} />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Buscar por nombre, usuario, teléfono o email"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
          <div className="flex gap-1.5">
            <Chip href={href({ ...filters, channel: undefined })} active={!filters.channel}>
              Todos
            </Chip>
            {CHANNELS.map((c) => {
              const { Icon, color, label } = CHANNEL_META[c];
              const active = filters.channel === c;
              return (
                <Chip key={c} href={href({ ...filters, channel: c })} active={active}>
                  <Icon className={cn("size-3.5", active ? "text-white" : color)} /> {label}
                </Chip>
              );
            })}
          </div>
        </div>

        {filters.channel && <input type="hidden" name="channel" value={filters.channel} />}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Propiedad
            <select name="propiedad" defaultValue={filters.propertyId ?? ""} className={field}>
              <option value="">Cualquiera</option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title ?? "Sin título"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-[12.5px] text-ink">
            <input type="checkbox" name="interes" value="1" defaultChecked={filters.onlyInterested} className="size-4 accent-[var(--color-primary)]" />
            Solo con interés registrado
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Fecha de
            <select name="campo" defaultValue={filters.dateField ?? "alta"} className={field}>
              <option value="alta">Alta del contacto</option>
              <option value="interaccion">Última interacción</option>
              <option value="visita">Visita</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11.5px] text-muted">
              Desde
              <input type="date" name="desde" defaultValue={filters.from ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] text-muted">
              Hasta
              <input type="date" name="hasta" defaultValue={filters.to ?? ""} className={field} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Presupuesto del prospecto, mínimo
            <input name="presupuestoMin" inputMode="numeric" defaultValue={filters.budgetMin ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Presupuesto del prospecto, máximo
            <input name="presupuestoMax" inputMode="numeric" defaultValue={filters.budgetMax ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Moneda
            <select name="moneda" defaultValue={filters.currency ?? ""} className={field}>
              <option value="">Cualquiera</option>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Operación
            <select name="operacion" defaultValue={filters.operation ?? ""} className={field}>
              <option value="">Cualquiera</option>
              <option value="venta">Venta</option>
              <option value="alquiler">Alquiler</option>
              <option value="temporario">Temporario</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Etiqueta
            <select name="etiqueta" defaultValue={filters.labelId ?? ""} className={field}>
              <option value="">Cualquiera</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Grupo
            <select name="grupo" defaultValue={filters.groupId ?? ""} className={field}>
              <option value="">Cualquiera</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Mensajes comerciales
            <select name="baja" defaultValue={filters.optOut ?? ""} className={field}>
              <option value="">Todos</option>
              <option value="no">Sin baja</option>
              <option value="si">Pidieron la baja</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Temperatura
            <select name="temperatura" defaultValue={filters.temperature ?? ""} className={field}>
              <option value="">Cualquiera</option>
              <option value="frio">Frío</option>
              <option value="tibio">Tibio</option>
              <option value="caliente">Caliente</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="submit" className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[12.5px] font-medium text-white hover:bg-primary-hover">
            Aplicar filtros
          </button>
          {filtered && (
            <Link href="/contactos" className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[12.5px] text-ink hover:bg-field">
              Limpiar
            </Link>
          )}
          <span className="text-[12.5px] text-muted">
            {filtered ? `${matched} de ${total} contactos` : `${total} contactos`}
          </span>
          {session.role === "admin" && (
            <Link
              href={`/contactos/campanas/nueva${filtersQs ? `?${filtersQs}` : ""}`}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink hover:bg-field"
            >
              <Megaphone className="size-3.5" strokeWidth={1.8} />
              Estimar campaña
            </Link>
          )}
        </div>
      </form>

      {filtered && (
        <form action={saveContactView} className="mb-5 flex flex-wrap items-center gap-2">
          <input type="hidden" name="f" value={filtersQs} />
          <input name="name" required maxLength={60} placeholder="Guardar estos filtros como segmento…" className={`${field} w-64`} />
          {session.role === "admin" && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <input type="checkbox" name="shared" className="size-4 accent-[var(--color-primary)]" /> Compartir con el equipo
            </label>
          )}
          <button type="submit" className="inline-flex h-8 items-center rounded-lg border border-line px-3 text-[12.5px] text-ink hover:bg-field">
            Guardar segmento
          </button>
          <span className="text-[12px] text-muted">Criterio: {describeFilters(filters, names).join(", ")}. Es dinámico: se recalcula cada vez que se usa.</span>
        </form>
      )}

      <Card className="overflow-hidden">
        {contacts.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="Sin resultados" description="Ningún contacto coincide con el filtro." className="py-20" />
          ) : (
            <EmptyState
              icon={Users}
              title="Todavía no hay contactos"
              description="Cada persona que escriba por WhatsApp, Instagram o Messenger se agrega acá automáticamente."
              className="py-20"
            />
          )
        ) : (
          <form action={bulkContactsAction}>
          <input type="hidden" name="f" value={filtersQs} />
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-field/40 px-6 py-2.5 text-[12.5px]">
            <span className="text-muted">Con los tildados:</span>
            <select name="op" defaultValue="" className={field} aria-label="Acción en bloque">
              <option value="" disabled>
                Elegí una acción…
              </option>
              {groups.length > 0 && (
                <optgroup label="Agregar al grupo">
                  {groups.map((g) => (
                    <option key={`ga${g.id}`} value={`group:add:${g.id}`}>{g.name}</option>
                  ))}
                </optgroup>
              )}
              {groups.length > 0 && (
                <optgroup label="Quitar del grupo">
                  {groups.map((g) => (
                    <option key={`gr${g.id}`} value={`group:remove:${g.id}`}>{g.name}</option>
                  ))}
                </optgroup>
              )}
              {labels.length > 0 && (
                <optgroup label="Poner etiqueta">
                  {labels.map((l) => (
                    <option key={`la${l.id}`} value={`label:add:${l.id}`}>{l.name}</option>
                  ))}
                </optgroup>
              )}
              {labels.length > 0 && (
                <optgroup label="Quitar etiqueta">
                  {labels.map((l) => (
                    <option key={`lr${l.id}`} value={`label:remove:${l.id}`}>{l.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Mensajes comerciales">
                <option value="optout:on">Marcar baja</option>
                <option value="optout:off">Quitar baja</option>
              </optgroup>
            </select>
            <label className="flex items-center gap-1.5 text-muted">
              <input type="checkbox" name="scope" value="all" className="size-4 accent-[var(--color-primary)]" />
              Aplicar a los {Math.min(matched, 1000)} que cumplen el filtro
            </label>
            <button type="submit" className="inline-flex h-8 items-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink hover:bg-field">
              Aplicar
            </button>
            {groups.length === 0 && labels.length === 0 && (
              <Link href="/contactos/organizar" className="text-primary hover:underline">Crear grupos o etiquetas</Link>
            )}
          </div>
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                <th className="w-8 py-3 pl-6"><span className="sr-only">Seleccionar</span></th>
                <th className="px-3 py-3 font-semibold">Contacto</th>
                <th className="px-4 py-3 font-semibold">Canales</th>
                <th className="px-4 py-3 font-semibold">Teléfono</th>
                <th className="px-4 py-3 font-semibold">Etiquetas</th>
                <th className="px-4 py-3 font-semibold">Último mensaje</th>
                <th className="px-6 py-3 text-right font-semibold">Conversaciones</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-field/50">
                  <td className="py-3.5 pl-6">
                    <input type="checkbox" name="ids" value={c.id} aria-label={`Seleccionar a ${c.name}`} className="size-4 accent-[var(--color-primary)]" />
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-field text-[11.5px] font-semibold text-muted">
                        {initials(c.name)}
                      </span>
                      <span className="min-w-0">
                        <Link href={href(filters, { pagina: page > 1 ? page : undefined, contacto: c.id })} scroll={false} className="block truncate font-medium text-ink hover:underline">
                          {c.name}
                        </Link>
                        {c.email && <span className="block truncate text-[12px] text-muted">{c.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex flex-wrap gap-1.5">
                      {c.handles.map((h) => (
                        <ChannelBadge
                          key={h.channel}
                          channel={h.channel}
                          text={h.channel === "whatsapp" ? "WhatsApp" : h.handle ? `@${h.handle}` : undefined}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-ink">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3.5">
                    <ContactTagsBar summary={tagsByContact.get(c.id) ?? null} compact />
                    {(labelsByContact.get(c.id) ?? []).length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {labelsByContact.get(c.id)!.map((l) => (
                          <span key={l.id} className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", LABEL_TONE[l.color])}>{l.name}</span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-muted">{c.lastMessageAt ? formatListDate(c.lastMessageAt) : "—"}</td>
                  <td className="px-6 py-3.5">
                    <span className="flex justify-end gap-1.5">
                      <Link
                        href={`/pipeline/nueva?contacto=${c.id}`}
                        title="Crear una oportunidad para este contacto"
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] text-ink hover:bg-field"
                      >
                        <GitBranch className="size-3.5 text-muted" strokeWidth={1.7} />
                      </Link>
                      {c.conversations.map((cv) => {
                        const { Icon, color, label } = CHANNEL_META[cv.channel];
                        return (
                          <Link
                            key={cv.id}
                            href={`/conversaciones/${cv.id}`}
                            title={`Abrir conversación de ${label}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] text-ink hover:bg-field"
                          >
                            <Icon className={cn("size-3.5", color)} />
                            <MessageCircle className="size-3.5 text-muted" strokeWidth={1.7} />
                          </Link>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </form>
        )}
      </Card>

      {pages > 1 && (
        <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-[13px] text-muted">
          <span>Página {page} de {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Chip href={href(filters, { pagina: page - 1 })}>Anterior</Chip>}
            {page < pages && <Chip href={href(filters, { pagina: page + 1 })}>Siguiente</Chip>}
          </span>
        </nav>
      )}

      {detail && <ContactPanel detail={detail} closeHref={closeHref} />}
    </>
  );
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
