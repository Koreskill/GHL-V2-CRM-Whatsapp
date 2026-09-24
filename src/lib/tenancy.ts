// Inmobiliaria por defecto: los datos que existían antes del multi-tenant viven acá (migración 0004).
// Se usa SOLO donde todavía no se puede resolver la organización real desde el contexto:
// la conexión de una cuenta por webhook (account.connected) no trae a qué inmobiliaria pertenece.
// TODO(multi-tenant): mapear la cuenta a la organización que inició el OAuth en vez de este default.
export const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
