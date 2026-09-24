@AGENTS.md

# Setter CRM — CRM multicanal

Bandeja única donde entran y se responden WhatsApp, Instagram DM y Facebook Messenger, con un agente de IA configurable por canal que contesta solo.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui
- Supabase (Postgres + Auth) con Drizzle ORM (driver `postgres`)
- **Zernio** como proveedor único de los tres canales — docs.zernio.com
- **OpenRouter** como capa de acceso multi-modelo para el agente (API compatible con OpenAI: se usa el SDK `openai` apuntando su `baseURL`). Toda llamada a IA pasa por `src/lib/ai/openrouter.ts`, que resuelve el modelo por `(organización, función)` en `ai_model_configs` y registra el uso en `ai_usage_logs`. `OPENROUTER_API_KEY` server-side. (Decisión 2026-09-24: reemplaza a OpenAI directo.)
- Deploy en **Dokploy** (self-hosted, Docker, `output: "standalone"`). NO Vercel.

## Modelo conceptual (si se rompe acá, no se arregla después)

1. **CANAL y PROVEEDOR son dos ejes distintos.**
   - `channel` = la red que ve la persona (`whatsapp | instagram | facebook`)
   - `provider` = por dónde viaja el mensaje (`zernio | meta | ...`)
   - Columnas separadas siempre. Van a convivir combinaciones distintas.
2. **La unidad es la CONVERSACIÓN, no el contacto.** Una persona puede tener un hilo de WhatsApp y otro de Instagram y no se mezclan. Rutas e historial del agente van por `conversationId`, nunca por `contactId`.
3. **La identidad NO es el teléfono.** Instagram y Messenger no tienen número. Tabla `contact_identities` con `(channel, external_id)` único; el contacto se resuelve por ahí. En WhatsApp el teléfono puede venir nulo: anclar en el id del proveedor.

Romper cualquiera de estas no produce un error: produce mensajes que se pierden en silencio.

## Reglas de implementación

- **OpenAPI primero.** Antes de escribir el cliente HTTP, descargar el OpenAPI real de Zernio y tipar contra ese archivo. No adivinar nombres de campos. El payload de webhook y la respuesta REST son tipos distintos.
- **Cliente sin SDK**, fetch nativo, resultado `{ success: true, data } | { success: false, error }`. Nunca tira excepción.
- **Webhook: 5 segundos para devolver 2xx.** Persistir inline (INSERT) y el trabajo pesado después de responder con `after()`. El grafo del agente se importa **dinámicamente dentro del `after()`**, nunca arriba del archivo.
- **At-least-once.** Reclamar cada evento por id en `webhook_events` con `INSERT ... ON CONFLICT DO NOTHING RETURNING` antes de procesar. Si no insertó → reintento → 200 y cortar.
- **Idempotencia de mensajes:** índice único PARCIAL sobre `messages.external_id` SOLO (`WHERE external_id IS NOT NULL`), no sobre `(provider, external_id)`.
- **Firma HMAC-SHA256 sobre el body CRUDO**, comparación de tiempo constante con chequeo de longitud previo. Sin secreto configurado → rechazar todo (fail-closed).
- **Eventos desconocidos:** loguear y 200, nunca 500 (a los 10 fallos seguidos el proveedor apaga la suscripción).
- **UN SOLO camino de salida:** `deliverMessage(conversationId, ...)` envía Y persiste. Nadie más inserta mensajes salientes. El agente tampoco.
- **Agente por canal** en `agent_configs` (prompt, herramientas, modelo, enabled). Cascada: canal → global → default del código. Canales nuevos arrancan **APAGADOS**.
- **Doble interruptor:** `conversations.ai_enabled` AND `agent_configs.enabled`. Ambos true para contestar.
- **Descartar trabajos viejos:** si un job del agente se procesa mucho después del mensaje, no contestar.
- **Ventana de 24h la decide el SERVIDOR** desde `conversations.last_inbound_at`. Fuera de ventana: WhatsApp solo plantilla aprobada; Instagram/Messenger texto libre con etiqueta `HUMAN_AGENT` hasta 7 días. La UI nunca deja enviar algo que va a rebotar.
- **Atribución de anuncios** (campaña/ad del lead) se guarda en `conversations.metadata` si el proveedor la manda.
- **Importación de historial** tras conectar una cuenta: el agente NO se dispara.
- **No fijar APP_BASE_URL**: el host se saca del request (headers `x-forwarded-host` / `host` detrás del proxy de Dokploy/Traefik).
- **Webhook se registra por API**: buscar por nombre y actualizar si existe, nunca duplicar.
- **OAuth en popup:** abrir la ventana de forma SÍNCRONA en el click, antes del await.
- **Barridos de recuperación** (`GET /api/webhooks/zernio` y backfill) aceptan `Authorization: Bearer <CRON_SECRET>` o header `x-cron-secret`. En Dokploy se programan con su Scheduler (cada 30 min alcanza: es red de seguridad).
- Iconos de marca (WhatsApp/Instagram/Messenger) como **SVG inline**.

## Base de datos

- La app se conecta como rol `crm_app` (pooler de transacciones `aws-0-sa-east-1`, puerto 6543, usuario `crm_app.pryrsnqxhmpnolxlupna`). Solo tiene DML sobre las 7 tablas del CRM, vía políticas RLS `crm_app_all`. No puede hacer DDL.
- Las migraciones (`drizzle/`) las aplica el rol dueño (MCP de Supabase o `postgres`), y cada una se registra en `drizzle.__drizzle_migrations` con su hash sha256 y `when` del journal. Toda tabla nueva necesita GRANT + política para `crm_app`.
- La ingesta de cada evento corre en UNA transacción: si falla, no queda un mensaje insertado sin sus contadores. Las fechas dentro de `sql\`\`` van como `${d.toISOString()}::timestamptz`, nunca un `Date` crudo.
- `legacy_conversations` / `legacy_messages` son de un bot anterior; se pueden borrar.

## Auth, bandeja y agente

- Supabase Auth (email + contraseña) con `@supabase/ssr`. `src/proxy.ts` protege todo salvo `/login`, `/api/webhooks/*` y `/webhooks/*`; las API routes además llaman `requireUser()`. Los usuarios se crean en el panel de Supabase (no hay registro público).
- Supabase se usa solo del lado del servidor: `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` SIN prefijo `NEXT_PUBLIC_`, así se leen en runtime. Con `NEXT_PUBLIC_` Next las incrusta al compilar la imagen y en Dokploy quedan vacías. No agregar variables `NEXT_PUBLIC_*` salvo que un componente de cliente las necesite, y en ese caso van como Build Args.
- Ventana: `src/lib/inbox/window.ts` (`open | human_agent | template_only | closed`). El agente IA solo responde con `open`; `human_agent` es solo para personas.
- `deliverMessage` inserta una fila `pending`, usa su id como `Idempotency-Key`, y si el webhook `message.sent` ganó la carrera (violación de único) borra la pendiente y conserva la del webhook.
- Agente: `runAgentForConversation(conversationId, { triggerMessageId })`. Corta si hay un mensaje posterior al disparador (antes y después de llamar a OpenAI), así dos mensajes seguidos del cliente reciben una sola respuesta.
- Contactos, Actividades y Reportes salen de `src/lib/crm/queries.ts` (datos reales, sin tablas nuevas). Calendario: reservas próximas vía API v2 de Cal.com (`CALCOM_API_KEY`, header `cal-api-version: 2024-08-13`) + página de agenda embebida desde `CALCOM_URL` (runtime, solo https). El agente recibe `CALCOM_URL` en su prompt para compartirlo cuando alguien quiere agendar.
- Pruebas: `npm test` (firma, ventana, cascada) y `npm run test:e2e` con `npm run dev` levantado (webhook, bandeja, agente, deliverMessage contra la base real; limpia sus datos).

## Pipeline de oportunidades (Fase 7)

Jerarquía: **Contacto → Oportunidad → (varias propiedades) + (varias visitas, cada una a UNA propiedad)**.
Si alguien pregunta por tres departamentos es UNA oportunidad con tres propiedades, no tres oportunidades. El mismo contacto puede tener otra oportunidad si más adelante busca algo distinto.

- **ETAPA y ESTADO son dos ejes distintos**, igual que canal/proveedor. `stage` (las 5 del tablero) es dónde está; `status` (`abierta | ganada | perdida`) es si sigue viva. Perder NO mueve la etapa: la oportunidad conserva dónde se cayó, que es el dato que sirve para saber en qué punto se traban las ventas. Ganar sí la lleva a `cerrado_ganado`. El tablero muestra solo `abierta`.
- **Qué busca el contacto NO se duplica en `deals`**: vive en `prospect_requirements` (operación, zonas, presupuesto, ambientes), que ya lo extrae el agente de la conversación. `deals.prospect_requirement_id` lo referencia.
- `deal_properties` es la relación N a N con `properties` (único por `(deal_id, property_id)`). `deal_events` es el historial append-only: nunca se edita ni se borra.
- `value` es **opcional**: el precio de una propiedad no es el valor comercial de la oportunidad para la inmobiliaria.
- `assigned_user_id` apunta a `auth.users` **sin FK** (otro esquema, `crm_app` no lo toca). Los nombres se resuelven con la clave de servicio vía `listTeam()`; sin ella el responsable queda "Sin asignar" y el pipeline sigue andando.
- Mover de etapa es por **selector**, no drag-and-drop: se agrega recién cuando esté comprobado que los cambios se guardan bien. La organización sale SIEMPRE de la sesión (`authorizeAction()`), nunca de un campo del formulario.
- Prueba: `scripts/test-deals.ts` corre dentro de una transacción que se revierte (no deja filas) y valida aislamiento entre inmobiliarias, que la perdida conserva etapa y que no se duplican propiedades.

## Visitas (Fase 8)

Jerarquía completa: **Contacto -> Oportunidad -> (varias propiedades) + (varias visitas, cada una a UNA propiedad)**.

- **Pedir una visita NO es tenerla agendada.** `solicitada` (sin fecha) y `agendada` (con `scheduled_at`) son estados distintos. Cierran en `realizada` | `no_asistio` | `cancelada`, con nota de seguimiento o motivo.
- **Reprogramar no es un estado**: mueve `scheduled_at` y deja la fecha anterior en `visit_events`. Cancelar tampoco borra: conserva el historial.
- Cada visita va contra una oportunidad, un contacto y UNA propiedad. `property_presentation_id` es *nullable*: solo se completa si nació de una presentación de la red, porque un asesor también carga visitas a mano.
- El contacto sale SIEMPRE de la oportunidad en el servidor, nunca de un campo del formulario.

## Propiedades y Google Sheets (Fase 9)

- **La hoja es la fuente; el CRM la refleja.** No hay edición de propiedades desde el CRM: si se editara en los dos lados, los precios quedarían distintos.
- `properties.external_id` = `property_id` de la hoja. Índice único **parcial** por `(organization_id, external_id) WHERE external_id is not null`: dos inmobiliarias pueden usar el mismo id en su hoja, y las cargadas a mano lo dejan en null sin chocar. El `ON CONFLICT` necesita el mismo `targetWhere`.
- **Lo que desaparece de la hoja se PAUSA, no se borra**: oportunidades y visitas siguen apuntando a esa propiedad.
- **Nunca se completa un dato por las nuestras.** Lo que falta o viene mal va a `sync_issues` y la ficha lo señala. Solo se aceptan URLs http(s): una imagen pegada dentro de una celda no sirve.
- Dos caminos de lectura (`src/lib/sheets/client.ts`): cuenta de servicio (`GOOGLE_SERVICE_ACCOUNT_JSON`, hojas privadas, JWT RS256 firmado con node:crypto, sin SDK) o export CSV si no hay credenciales, que **exige la hoja pública**. El CSV se parsea a mano: comas y saltos de línea entre comillas son normales en una descripción.
- Barrido: `GET /api/cron/properties` con `CRON_SECRET`, además del botón manual en Agencia.

## Errores y logs (Fase 10)

- `incidents` es una bandeja para RESOLVER, no un log más: mensaje claro, detalle técnico aparte, estado `nuevo -> en_revision -> resuelto` y reintento solo donde es seguro.
- Se agrupa por `fingerprint` (sha256 de organización + módulo + clave): el mismo problema sube `occurrences` en vez de llenar la pantalla. Si vuelve a pasar algo resuelto, **se reabre**.
- `organization_id` nullable = incidente del plano de agencia. `detail` pasa siempre por `safeError()`: nunca credenciales ni textos de mensajes.
- Registrar un incidente NUNCA puede tumbar la operación que lo originó: todas las escrituras van con `.catch(() => {})`.

## Contexto de agencia: entrar al espacio de un cliente

- `getSession()` devuelve `organizationId` = la inmobiliaria **activa**, y `homeOrganizationId` = la propia del usuario. Así todas las páginas y APIs ya escritas quedan en el contexto correcto sin tocar cada una.
- La cookie `crm_acting_org` es httpOnly y **solo se respeta si `is_agency_admin`**, revalidado contra `app_metadata` en cada request y contra la existencia de la organización. Tener la cookie no alcanza para entrar a ningún lado.
- `ActingBanner` deja visible en TODAS las pantallas sobre qué cliente se está trabajando. Entrar y salir queda en `audit_logs`.
- **`src/lib/roles.ts` tiene las funciones puras de rol y lo importa el proxy.** `auth.ts` toca la base, así que el proxy (runtime de edge) no puede importarlo: si lo hace, el build falla con `Can't resolve 'fs'/'net'/'tls'`. Por lo mismo, la etiqueta del equipo vive en `src/lib/team/labels.ts` y no en `deals/team.ts`, que sí va a la base.

## Plantillas e indicador "escribiendo…"

- Lo que se puede mandar sale del **OpenAPI de Zernio 1.62.0**, no de suposiciones: componentes `header | body | footer | buttons | carousel | limited_time_offer`; header `text | image | video | gif | document | location`; botones `quick_reply | url | phone_number | otp | copy_code | flow | mpm | catalog`. Implementados: header (texto o media), footer y los tres botones que usa una inmobiliaria. **Carrusel y oferta por tiempo limitado quedan afuera** hasta tener el indicativo de formatos.
- El header usa su propio `{{1}}`: no comparte numeración con el cuerpo, y admite una sola variable.
- **Una variable vacía no se envía**: se valida en la interfaz y otra vez en `/api/messages/send`, para no mandar un mensaje con un hueco o un `{{2}}` crudo.
- **Zernio NO expone typing/presence** (verificado contra el OpenAPI): el indicador "escribiendo…" se ve SOLO dentro del CRM; la persona en WhatsApp no ve nada. Son dos capacidades distintas.
- Es estado efímero en `conversations` (`agent_typing_since`, `human_typing_since`, `human_typing_user_id`), **nunca un mensaje**: no entra al historial. Las marcas vencidas se ignoran al leer, así una corrida caída no deja el indicador pegado. El agente lo limpia en un `finally`.

## Plano de agencia (visión del dueño del CRM)

- `auth.users.raw_app_meta_data.is_agency_admin = true` habilita `/agencia`. Es un eje aparte del rol: un admin de inmobiliaria NO lo tiene. Se asigna por SQL (`drizzle/manual_agency_admin.sql`).
- `/agencia` lista los clientes con métricas cruzadas; `/agencia/[orgId]` muestra la ficha (conversaciones, estado del agente por canal, últimas llamadas a la IA, usuarios); `/agencia/[orgId]/conversaciones/[id]` es la transcripción **solo lectura**. Desde el plano de agencia NUNCA se envía un mensaje: el único camino de salida sigue siendo `deliverMessage`.
- Cada página valida `requireAgencyAdmin()` en el servidor. Mirar la ficha de un cliente o una conversación escribe en `audit_logs`.
- Alta de clientes: `/agencia/nuevo` crea la organización y su primer usuario admin en un paso. El usuario se crea con la clave de servicio (`SUPABASE_SECRET_KEY`, sin prefijo `NEXT_PUBLIC_`) y queda espejado en `organization_members`. Sin esa variable la app funciona, pero el panel avisa que no puede crear usuarios.
- La contraseña la elige o genera el dueño en el formulario y se la pasa al cliente: nunca vuelve por la URL ni se loguea.

## Contraseñas y recuperación

- **Una contraseña guardada no se puede mostrar.** Supabase guarda un hash: ni el cliente ni el admin ni la agencia la pueden leer. El ojo de `PasswordField` muestra lo que se está escribiendo en ese campo, nada más.
- `/recuperar` manda el enlace por correo (`resetPasswordForEmail`, 5 pedidos por IP y 3 por email cada 15 min) y responde siempre lo mismo exista o no la cuenta. **Requiere SMTP configurado en Supabase**; sin eso el correo no sale.
- `/auth/confirm` canjea el `token_hash` y deja la sesión de recuperación; `/recuperar/nueva` fija la contraseña y cierra la sesión. Las tres rutas son públicas en el proxy.
- Camino alternativo cuando el correo no llega: la agencia le fija una contraseña nueva desde la ficha del cliente.
- El usuario ES el email: no hay nombre de usuario separado que se pueda olvidar.

## Seguridad (auditoría 2026-09-23)

- Roles en `auth.users.raw_app_meta_data.crm_role` (`admin` | `agent`), asignados por SQL. Sin rol no se entra (proxy, layout, login y `authorize()`). Lo de admin (Configuración, cuentas, crear plantillas, importar) se valida en el servidor con `authorize("admin")` / `requireRole("admin")`.
- `anon` y `authenticated` NO tienen permisos sobre ninguna tabla (migración 0003). Toda tabla nueva: RLS + GRANT/política solo para `crm_app`, nunca para esos roles.
- Cookies de sesión `httpOnly` + `secure` (`supabaseCookieOptions`). No hay cliente de Supabase en el navegador: no agregar uno sin revisar esto.
- Proxy: límite 240 req/min por IP en la API de personas, bloqueo CSRF por `Origin` en métodos que modifican (salvo webhooks/cron). Login: 10 intentos por IP y 5 por email cada 15 min. `authorize(role, limit)` para límites por usuario. El limitador es en memoria: con más de una réplica hay que moverlo a Redis/DB.
- Agente: tope de 20 respuestas por conversación/hora y `AGENT_MAX_REPLIES_PER_HOUR` (300) global.
- Logs: nunca loguear el error de Drizzle entero (trae los parámetros con datos personales); usar `safeError()`. No loguear textos de mensajes ni lo que escribe el modelo.
- Headers de seguridad y CSP en `next.config.ts`. Si se embebe otro servicio, agregarlo a `frame-src`.
- URLs que vienen de terceros y terminan en el navegador (authUrl, fotos, meetingUrl) se validan (`https://`, dominio esperado) antes de usarlas.

## Zernio: mapeo de ids (verificado contra el OpenAPI 1.62.0)

- Tipos generados en `src/lib/zernio/openapi.d.ts` desde `openapi/zernio.slim.json` (`npm run zernio:openapi`). Nunca editarlos a mano.
- `conversations.external_id` = `conversation.platformConversationId` del webhook = `id` de `GET /v1/inbox/conversations`. El `conversation.id` del webhook es el id interno de Zernio: NO usarlo como clave (se guarda en `metadata.zernioConversationId`).
- `messages.external_id` = `message.platformMessageId` del webhook = `id` de `GET .../messages` = `data.messageId` de `POST .../messages` (el wamid/mid). El `message.id` del webhook es interno: NO usarlo como clave.
- `channel_accounts.external_id` = `account.id` / `account.accountId` del webhook = `_id` de `GET /v1/accounts`.
- Toda ruta `/v1/inbox/conversations/{id}/...` exige `accountId` (query o body).
- Identidad WhatsApp: `sender.businessScopedUserId ?? sender.id`. `sender.id` es el teléfono si está disponible y si no el BSUID; `phoneNumber` puede venir null.
- Webhook: headers `X-Zernio-Signature` (hex HMAC-SHA256 del body crudo), `X-Zernio-Event`, `X-Zernio-Event-Id` (= `payload.id`, clave de dedupe). 5s para 2xx, hasta 7 intentos.
- Envío: header `Idempotency-Key` hace seguros los reintentos. Fuera de ventana en IG/FB: `messagingType: "MESSAGE_TAG"` + `messageTag: "HUMAN_AGENT"`. WhatsApp fuera de ventana: campo `template`.
- Atribución de anuncios: `metadata.referral` en `message.received` (solo el primer mensaje tras el click) y `metadata` del listado REST (`ctwa_*`, `meta_ad_id`).

## Fases (no avanzar si la anterior no compila)

Al terminar cada fase: `npm run typecheck`, `npm run lint` y `npm run build` limpios.

1. Modelo de datos y migración
2. Cliente de la API Zernio, tipado contra el OpenAPI
3. Webhook entrante y persistencia
4. Bandeja: listar, abrir y responder
5. Agente por canal (OpenRouter)
6. Deploy en Dokploy, conexión de cuentas y barridos
7. Pipeline de oportunidades
8. Visitas
9. Catálogo de propiedades sincronizado con Google Sheets
10. Errores y logs + contexto de agencia
11. Plantillas con encabezado, pie y botones, e indicador "escribiendo…"

## Sistema visual — Setter CRM

No rediseñar, no modernizar, no inventar pantallas que no estén definidas. Tokens en `src/app/globals.css`.

- **Shell de 3 partes:** sidebar oscura fija (~15% ancho) + topbar blanca con buscador (`Buscar contactos, conversaciones...`, badge `⌘ K`, campana) + canvas principal.
- **Colores:** sidebar `#0D1517`, item activo `#18302F`, texto principal `#111D27`, canvas `#EDF3F6`, cards `#FFFFFF`, texto muted `#69737D`, bordes `#DEE5E8`, primario teal `#1D4943`. Acentos (cyan, púrpura, verde, ámbar, naranja, rojo) solo para estados, métricas, etapas y canales.
- **Tipografía:** Inter/system sans. Título de página 28–34px bold; card title 16–20px; body 13–15px; labels de sección 10–12px uppercase tracking amplio.
- **Forma:** cards blancas radio 14–18px, borde 1px sutil, sombra mínima. Botones radio medio (no pill salvo chips). Sin gradientes, sin glassmorphism, sin sombras pesadas.
- **Iconos:** outline finos (lucide), monocromo.
- **Navegación:** Dashboard · OPERACIONES (Pipeline, Contactos, Conversaciones, Plantillas, Visitas) · PRODUCTIVIDAD (Actividades, Calendario) · INTELIGENCIA (Reportes) · Configuración abajo · bloque de usuario con avatar de iniciales.
- **Botones:** primario teal oscuro con texto blanco (`+ Nueva plantilla`); secundario blanco con borde (`Sincronizar`, `Filtros`).
- **Chips:** activo teal con texto blanco; inactivo gris pálido.
- **Empty states:** ícono chico en círculo pálido + título semibold + 1–3 líneas muted + mucho aire. Sin ilustraciones.
- **Copy:** español, directo, operativo. Ej.: "Selecciona una conversación", "Sin deals en esta etapa".
- **Pipeline:** Prospecto (gris-azul), Contactado (azul), Propuesta (púrpura), Negociación (naranja), Cerrado Ganado (verde).
