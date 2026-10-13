"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isUuid } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { cancelLabRun, createLabRun } from "@/lib/lab/run";
import { rateLimit } from "@/lib/rate-limit";

async function adminSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");
  return session;
}

export async function startLabRunAction(formData: FormData) {
  const session = await adminSession();
  if (!rateLimit(`lab-start:${session.user.id}`, 6, 3600_000).ok) redirect("/laboratorio?error=limite");
  const keys = formData.getAll("scenario").filter((k): k is string => typeof k === "string");
  const res = await createLabRun({ organizationId: session.organizationId, userId: session.user.id, scenarioKeys: keys });
  if (!res.ok) redirect(`/laboratorio?error=${encodeURIComponent(res.error)}`);
  after(async () => {
    const { executeLabRun } = await import("@/lib/lab/run");
    await executeLabRun(res.runId);
  });
  revalidatePath("/laboratorio");
  redirect(`/laboratorio/${res.runId}`);
}

export async function cancelLabRunAction(formData: FormData) {
  const session = await adminSession();
  const runId = String(formData.get("runId") ?? "");
  if (!isUuid(runId)) redirect("/laboratorio");
  await cancelLabRun(session.organizationId, runId);
  revalidatePath(`/laboratorio/${runId}`);
  redirect(`/laboratorio/${runId}`);
}
