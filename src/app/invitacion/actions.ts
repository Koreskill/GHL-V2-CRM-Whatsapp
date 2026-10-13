"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvitation } from "@/lib/agency/invitations";
import { writeAudit } from "@/lib/agency/queries";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "").slice(0, 200);
  if (!rateLimit(`invite:ip:${clientIp(await headers())}`, 20, 15 * 60_000).ok) {
    redirect(`/invitacion/${encodeURIComponent(token)}?error=limite`);
  }
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(`/invitacion/${token}`)}`);

  const res = await acceptInvitation(token, data.user);
  if (!res.ok) redirect(`/invitacion/${encodeURIComponent(token)}?error=${res.reason}`);
  await writeAudit({ actorUserId: data.user.id, action: "invitation_accepted", target: `user:${data.user.id}` });
  // Refresca el JWT para que el rol nuevo viaje en la sesión.
  await supabase.auth.refreshSession();
  redirect("/");
}
