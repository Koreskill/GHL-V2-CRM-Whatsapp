import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getSession } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const meta = session.user.user_metadata;
  const name = typeof meta?.full_name === "string" ? meta.full_name : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={{ email: session.email, name, role: session.role, isAgencyAdmin: session.isAgencyAdmin }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto px-9 py-8">{children}</main>
      </div>
    </div>
  );
}
