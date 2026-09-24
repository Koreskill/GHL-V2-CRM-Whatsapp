// Parte PURA del equipo: tipo y etiqueta. Sin acceso a la base, así la pueden importar los
// componentes de cliente sin arrastrar el driver de Postgres al bundle del navegador.
export type TeamMember = { id: string; email: string };

export function memberLabel(team: TeamMember[], userId: string | null) {
  if (!userId) return "Sin asignar";
  return team.find((m) => m.id === userId)?.email ?? "Usuario";
}
