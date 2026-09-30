import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { ChannelBadge } from "@/components/channel-badge";
import { CHANNEL_META } from "@/components/channel-icons";
import { ContactTagsBar } from "@/components/tags/contact-tags-bar";
import type { getContactDetail } from "@/lib/crm/contact-detail";
import { formatListDate } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import { PanelShell } from "./panel-shell";

type Detail = NonNullable<Awaited<ReturnType<typeof getContactDetail>>>;

const money = (v: string | null, currency: string) => (v === null ? null : `${currency} ${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 0 })}`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-[13px] text-muted">{text}</p>;

export function ContactPanel({ detail, closeHref }: { detail: Detail; closeHref: string }) {
  const { contact, requirement } = detail;
  const name = contact.name ?? detail.conversations[0]?.participantName ?? detail.identities.find((i) => i.handle)?.handle ?? contact.phone ?? "Sin nombre";
  const budget =
    requirement && (requirement.priceMin || requirement.priceMax)
      ? [money(requirement.priceMin, requirement.currency), money(requirement.priceMax, requirement.currency)].filter(Boolean).join(" – ")
      : null;

  return (
    <PanelShell closeHref={closeHref} title={name}>
      <div className="flex flex-col gap-1 text-[13px] text-ink">
        {contact.phone && <span>{contact.phone}</span>}
        {contact.email && <span>{contact.email}</span>}
        <span className="text-muted">Alta: {formatListDate(contact.createdAt.toISOString())}</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.identities.map((i) => (
            <ChannelBadge key={`${i.channel}${i.handle}`} channel={i.channel} text={i.channel === "whatsapp" ? "WhatsApp" : i.handle ? `@${i.handle}` : undefined} />
          ))}
        </div>
      </div>

      <Section title="Etiquetas">
        <ContactTagsBar summary={detail.tags} />
      </Section>

      <Section title="Qué busca">
        {!requirement ? (
          <Empty text="Todavía no dijo qué busca." />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {requirement.operation && (<><dt className="text-muted">Operación</dt><dd className="text-ink">{requirement.operation}</dd></>)}
            {requirement.propertyTypes.length > 0 && (<><dt className="text-muted">Tipo</dt><dd className="text-ink">{requirement.propertyTypes.join(", ")}</dd></>)}
            {requirement.zones.length > 0 && (<><dt className="text-muted">Zonas</dt><dd className="text-ink">{requirement.zones.join(", ")}</dd></>)}
            {budget && (<><dt className="text-muted">Presupuesto</dt><dd className="text-ink">{budget}</dd></>)}
            {requirement.bedroomsMin && (<><dt className="text-muted">Dormitorios</dt><dd className="text-ink">{requirement.bedroomsMin}+</dd></>)}
          </dl>
        )}
      </Section>

      <Section title="Propiedades mostradas o de interés">
        {detail.properties.length === 0 ? (
          <Empty text="Sin propiedades asociadas." />
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {detail.properties.map((p) => (
              <li key={p.propertyId}>
                <Link href={`/propiedades/${p.propertyId}`} className="text-ink hover:underline">{p.title ?? "Sin título"}</Link>
                {p.interest && <span className="ml-2 text-[11.5px] text-muted">interés {p.interest}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Oportunidades">
        {detail.deals.length === 0 ? (
          <Empty text="Sin oportunidades." />
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {detail.deals.map((d) => (
              <li key={d.id}>
                <Link href={`/pipeline/${d.id}`} className="text-ink hover:underline">{d.title ?? "Oportunidad"}</Link>
                <span className="ml-2 text-[11.5px] text-muted">{STAGE_LABEL[d.stage]} · {d.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Visitas">
        {detail.visits.length === 0 ? (
          <Empty text="Sin visitas." />
        ) : (
          <ul className="flex flex-col gap-1 text-[13px]">
            {detail.visits.map((v) => (
              <li key={v.id} className="text-ink">
                {v.propertyTitle ?? "Propiedad"}
                <span className="ml-2 text-[11.5px] text-muted">{v.status}{v.scheduledAt ? ` · ${formatListDate(v.scheduledAt.toISOString())}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Conversaciones">
        {detail.conversations.length === 0 ? (
          <Empty text="Sin conversaciones." />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {detail.conversations.map((c) => {
              const { Icon, color, label } = CHANNEL_META[c.channel];
              return (
                <li key={c.id}>
                  <Link href={`/conversaciones/${c.id}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-ink hover:bg-field">
                    <Icon className={cn("size-4", color)} />
                    {label}
                    <MessageCircle className="size-3.5 text-muted" strokeWidth={1.7} />
                    <span className="text-[11.5px] text-muted">{c.lastMessageAt ? formatListDate(c.lastMessageAt.toISOString()) : "sin mensajes"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </PanelShell>
  );
}
