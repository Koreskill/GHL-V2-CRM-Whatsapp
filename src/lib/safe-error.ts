// Resumen de un error apto para logs: sin los parámetros de la consulta (Drizzle los agrega como
// "params: ..." y ahí van nombres, teléfonos y textos de mensajes) ni el `detail` de Postgres.
export function safeError(err: unknown): string {
  if (!(err instanceof Error)) return "error desconocido";
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code || cause?.message) {
    return [cause.code, cause.message?.split("\n")[0]].filter(Boolean).join(" ").slice(0, 300);
  }
  const firstLine = err.message.split("\n")[0].replace(/params:.*$/i, "").trim();
  return `${err.name}: ${firstLine}`.slice(0, 300);
}
