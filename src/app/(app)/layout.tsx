import { redirect } from "next/navigation";
import { ActingBanner } from "@/components/shell/acting-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getOrganization } from "@/lib/agency/queries";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const meta = session.user.user_metadata;
  const name = typeof meta?.full_name === "string" ? meta.full_name : null;

  // Cuando la agencia entró al espacio de un cliente, su nombre queda visible en toda la app.
  const client = session.actingAsClient ? await getOrganization(session.organizationId) : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{ email: session.email, name, role: session.role, isAgencyAdmin: session.isAgencyAdmin }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {client && <ActingBanner clientName={client.name} />}
        <main className="min-h-0 flex-1 overflow-y-auto px-9 py-8">{children}</main>
      </div>
    </div>
  );
}
