import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, UserCheck } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { InviteForm } from "@/components/agency/invite-form";
import { listAccessRequests, listUnassignedAccounts } from "@/lib/agency/access";
import { listPendingInvitations } from "@/lib/agency/invitations";
import { listOrganizations } from "@/lib/agency/queries";
import { requireAgencyAdmin } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { approveAccessAction, assignAccountAction, rejectAccessAction, revokeInvitationAction } from "../actions";

export const metadata = { title: "Accesos · Setter CRM" };

const select = "h-9 rounded-lg border border-line bg-field px-2 text-[13px] text-ink";

export default async function AccesosPage({ searchParams }: PageProps<"/agencia/accesos">) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const params = await searchParams;
  const [requests, accounts, orgs, invitations] = await Promise.all([listAccessRequests(), listUnassignedAccounts(), listOrganizations(), listPendingInvitations()]);
  const error = typeof params.error === "string" ? params.error : null;
  const ok = typeof params.ok === "string" ? params.ok : null;

  const orgOptions = (
    <>
      <option value="" disabled>
        Inmobiliaria…
      </option>
      {orgs.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      <PageHeader
        title="Accesos"
        subtitle="Solicitudes de ingreso con Google y cuentas de mensajería sin inmobiliaria"
        actions={
          <Link href="/agencia">
            <Button variant="secondary">Volver</Button>
          </Link>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Listo: {ok}.</p>}

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Invitar a una persona</h2>
      <Card className="mb-6 p-4">
        <InviteForm orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
        {invitations.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                <span className="text-ink">
                  {i.email} · {i.role === "admin" ? "Administrador" : "Agente"} · {orgs.find((o) => o.id === i.organizationId)?.name ?? "—"}
                  <span className="text-muted">{i.expired ? " · vencida" : ` · vence ${formatListDate(i.expiresAt)}`}</span>
                </span>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button type="submit" variant="secondary">
                    Revocar
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Solicitudes de acceso</h2>
      {requests.length === 0 ? (
        <Card>
          <EmptyState icon={UserCheck} title="Sin solicitudes pendientes" description="Cuando alguien entre con Google sin invitación, aparece acá." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((r) => (
            <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[14px] font-semibold text-ink">{r.fullName ?? r.email}</p>
                <p className="text-[12.5px] text-muted">
                  {r.email} · {formatListDate(r.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={approveAccessAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="requestId" value={r.id} />
                  <select name="organizationId" required defaultValue="" className={select}>
                    {orgOptions}
                  </select>
                  <select name="role" defaultValue="agent" className={select}>
                    <option value="agent">Agente</option>
                    <option value="admin">Administrador</option>
                  </select>
                  <Button type="submit">Aprobar</Button>
                </form>
                <form action={rejectAccessAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <Button type="submit" variant="secondary">
                    Rechazar
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Cuentas sin asignar</h2>
      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title="Sin cuentas pendientes" description="Las cuentas nuevas de Zernio sin inmobiliaria aparecen acá." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((a) => (
            <Card key={a.externalId} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[14px] font-semibold text-ink">{a.name ?? a.handle ?? a.externalId}</p>
                <p className="text-[12.5px] text-muted">
                  {a.channel}
                  {a.handle ? ` · @${a.handle}` : ""}
                </p>
              </div>
              <form action={assignAccountAction} className="flex items-center gap-2">
                <input type="hidden" name="externalId" value={a.externalId} />
                <select name="organizationId" required defaultValue="" className={select}>
                  {orgOptions}
                </select>
                <Button type="submit">Asignar</Button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
