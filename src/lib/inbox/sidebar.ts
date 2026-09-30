import { listOpenDelegations } from "@/lib/delegations/flow";
import { listConversations } from "./queries";
import { countByStatus } from "./status";

type Filters = Parameters<typeof listConversations>[1];

// Lo que necesitan las dos rutas del inbox para dibujar la lista lateral y las pestañas.
export async function loadInboxSidebar(orgId: string, filters: Filters) {
  const tab = filters.tab ?? "activas";
  const [items, counts, delegations] = await Promise.all([
    // En "Delegadas" no se listan conversaciones propias.
    tab === "delegadas" ? Promise.resolve([]) : listConversations(orgId, filters),
    countByStatus(orgId),
    listOpenDelegations(orgId),
  ]);
  return {
    items,
    delegations,
    counts: {
      desactivas: counts.desactiva,
      activas: counts.activa,
      archivadas: counts.archivada,
      delegadas: delegations.filter((d) => !d.mine).length,
    },
  };
}
