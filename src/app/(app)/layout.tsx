import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getUser();
  if (!user?.email) redirect("/login");
  const name = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={{ email: user.email, name }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto px-9 py-8">{children}</main>
      </div>
    </div>
  );
}
