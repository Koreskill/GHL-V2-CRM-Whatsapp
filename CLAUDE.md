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
- Agente: `triageIncomingMessage(conversationId, { triggerMessageId })` (ver Fase 12). Corta si hay un mensaje posterior al disparador, antes y después de llamar al modelo, así dos mensajes seguidos del cliente reciben una sola respuesta.
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

## Triaje de mensajes: Jev clasifica, GPT redacta (Fase 12)

Un mensaje entrante pasa por cuatro pasos, y cada uno tiene UNA responsabilidad:

1. **Jev clasifica** (Decisions API) y devuelve decisiones tipadas con probabilidades. **No redacta.**
2. **El código elige la ruta** con una tabla determinista (`triage/routes.ts`). El modelo nunca elige la ruta: si pudiera, un reclamo podría recibir un pitch comercial.
3. **GPT redacta** siguiendo esa ruta. **No vuelve a decidir la categoría.**
4. La app valida, aplica las reglas de envío y registra todo.

### Decisions API

- Es un endpoint **aparte** del de chat: `POST https://openrouter.ai/api/alpha/decisions`, no `/v1/chat/completions`. Por eso NO se usa el SDK de OpenAI, va con fetch nativo como el cliente de Zernio.
- Tipado contra `openapi/openrouter-decisions.yaml`, descargado de la documentación oficial. Si un campo no está ahí, no existe: no inventarlo.
- Tres primitivas: `noul` (¿se cumple?), `choice` (¿cuál?), `score` (¿dónde cae en una escala ordenada?).
- **`noul` NO trae `confidence`**: solo `choice` y `score`. **`score` viene ponderado por probabilidad** (1.99 con tres niveles), no como entero: hay que redondear.
- `usage` cuenta `input_tokens`/`output_tokens`, no `prompt_tokens`/`completion_tokens`.
- Se registra en `ai_usage_logs` con función `calificacion`, igual que cualquier otra llamada a IA.

### Orden de la política de rutas (no es arbitrario)

Spam → pedido de persona → reclamo → `requires_human` alto → confianza baja → visita detectada → intención principal.
Una opción fuera del catálogo o una respuesta ilegible **no se enrutan a ciegas**: van a revisión. Sin `confidence` se asume 0, que fuerza revisión en vez de dar la decisión por buena.

### Reglas de envío

- `requires_human`, confianza por debajo del umbral, o GPT sin datos verificados → **borrador + derivación**, nunca envío.
- **Derivar pausa la IA en el hilo** (`conversations.ai_enabled = false`), como hacía la herramienta `handoff_to_human`, que quedó reemplazada por `requires_human`.
- El envío sigue saliendo por `deliverMessage`: **un solo camino de salida**. El borrador se carga en el campo de escritura para que una persona lo lea y lo mande; no se envía desde el panel.
- `message_triage.message_id` es **único**: es la garantía de que el mismo mensaje no se clasifica ni se contesta dos veces, aunque el webhook reintente. Se reclama la fila ANTES de gastar un token.

### Configuración

- Modo de envío (`auto | borrador | off`), umbrales y modelo de clasificación viven en `agent_configs`, con la misma cascada canal → global → default. No repartidos por el código.
- `OPENROUTER_DECISION_MODEL` (default `typesafe/jev-1.13`) y `OPENROUTER_API_KEY`, siempre server-side.
- **Los umbrales por defecto (0.60 y 0.50) NO están calibrados**: son un punto de partida. `npm run triage:calibrar -- mensajes.json` los ajusta con mensajes reales y mide cuántos reclamos se escapan. Con menos de ~100 mensajes por categoría el número es orientativo.
- `response_format: json_schema` se pide, pero **OpenRouter aclara que depende del modelo y del proveedor**: el resultado se valida campo por campo igual, y se acepta JSON envuelto en ```json.

### Aislamiento

El contexto se arma en `triage/context.ts` y TODO se filtra por `organizationId`. Las **notas internas y los documentos de una propiedad no entran al prompt**: son privados del equipo y no tienen por qué pasar por un modelo que después le escribe al cliente. Cada ficha lleva `datosFaltantes`: es exactamente lo que el modelo NO puede afirmar.

## Etiquetado del contacto y handover (Fase 13)

### Dónde vive cada cosa (y por qué no hay una tabla contact_tags)

- **Qué busca** (operación, tipos, zonas, presupuesto, ambientes, urgencia, forma de pago, tipo de crédito) → `prospect_requirements`, que ya existía y es lo que leen el Pipeline y el contexto del triaje. **No se duplica en otra tabla:** dos lugares con la zona y el presupuesto del mismo contacto terminan diciendo cosas distintas.
- **Temperatura** (`frio | tibio | caliente`) → `contacts.temperature`. Es de la PERSONA: la misma persona escribiendo por WhatsApp y por Instagram tiene una sola temperatura.
- **Bot pausado** → `conversations.ai_enabled`, que ya existía. NO por contacto: rompería la regla base de que la unidad es la conversación.
- **Interés por propiedad** → `deal_properties.interest` + `last_interest_at`. Que exista la fila = se la mostramos; que tenga temperatura = mostró interés.

### Qué modelo hace qué

**Jev no puede devolver un JSON incremental arbitrario**: la Decisions API responde preguntas tipadas. Por eso el etiquetado se parte:

- **Jev** (`TAG_QUESTIONS`, en la misma llamada que la clasificación de ruta, para no pagar el contexto dos veces): operación, tipo de propiedad, urgencia, forma de pago, temperatura, interés en una propiedad mostrada. Todo conjunto cerrado.
- **GPT** (`triage/extract.ts`, función `extraccion`): zonas, presupuesto min/max, moneda, ambientes, dormitorios, tipo de crédito. Valores libres que ninguna pregunta de opciones puede devolver. Se saltea cuando la ruta es de derivación o aclaración: no se paga un token por un reclamo.

### El etiquetado es INCREMENTAL

Lo que no vino no se toca. Un "sí, dale" no puede borrar la zona y el presupuesto que el contacto dio hace cinco mensajes. Las zonas y los tipos se **acumulan**. `desconocida`/`desconocido` en una respuesta de Jev significa "no lo dijo", y se guarda como `null` para no pisar lo anterior. La temperatura solo se escribe si Jev la pudo determinar: no se degrada a frío por un mensaje corto.

### Handover

Cuando se deriva: se manda un **acuse** ("lo recibimos, lo sigue una persona"), se pausa la IA del hilo y aparece en la campanita de la topbar. El acuse no promete una solución ni explica causas — lo impide el prompt de las rutas de derivación. En modo `borrador` no sale ni el acuse. Reactivar el bot es el mismo interruptor de IA que ya estaba en la bandeja.

La campanita cuenta solo lo **no visto** (`message_triage.seen_at`); abrir la conversación lo marca. Muestra motivo, qué busca y última propiedad vista, para decidir a cuál entrar sin abrirla.

### Precedencia de la edición manual

`properties.manually_edited_at` con fecha = la sincronización **no pisa** esa propiedad ni la pausa por ausencia. Se limpia con «Volver a sincronizar desde la hoja» en su ficha. El resumen de la sincronización dice cuántas se saltearon por esto, para que no parezca que fallaron. Una propiedad cargada a mano tiene `external_id` null y la hoja no la toca nunca.

## Motor conversacional: el bot ve el catálogo y no puede inventar (Fase 14)

Qué estaba roto (2026-09-24, en producción): el bot **nunca miraba el catálogo** — solo veía propiedades ya vinculadas a una oportunidad, así que a un cliente nuevo le decía "no tengo" aunque la propiedad existiera. Y con la lista vacía y el cliente insistiendo, **inventó dos departamentos** con precio, metros y amenities. La regla "no inventes" del prompt no alcanzó. Todo lo de abajo existe por eso.

### Flujo (`triage/compose.ts` compone, `triage/run.ts` envía)

`composeReply` hace todo menos mandar: clasifica (Jev), enruta, actualiza el perfil, **busca en el catálogo**, redacta, valida y arma las fichas. `run.ts` pone los interruptores, reclama el mensaje, envía y registra. Separados para que la evaluación corra conversaciones reales **sin mandar WhatsApp**.

### Búsqueda (`catalog-search.ts`, `retrieval.ts`)

- Cuatro modos: **referencia** (nombró una propiedad: pegó la tarjeta, el título, el precio, el link), **conversación** (pregunta por lo ya mostrado: "¿tenés fotos?"), **búsqueda** (describe lo que busca), **ninguna** (hay que preguntar).
- Una referencia exige que la propiedad **se destaque**: "algo en Centro" coincide con 16 y es una búsqueda, no una referencia.
- **Solo se ofrece `disponible` o `reservada`.** Una vendida o alquilada nunca es una opción.
- **El presupuesto se compara en la misma moneda.** Sin moneda explícita se infiere del catálogo de ESA inmobiliaria para esa operación (acá: ventas en USD, alquileres en ARS). `prospect_requirements.currency` tiene default USD, así que la moneda del cliente se marca aparte en `raw_extraction.moneda_explicita`.
- Con coincidencias exactas se muestran SOLO esas; las alternativas (otra zona, hasta 15% arriba) aparecen solo si no hay nada exacto. Venta y alquiler no se mezclan nunca, ni como alternativa.
- En modo conversación se filtra por la operación actual: si le mostraste una venta y después dijo "alquilar", esa venta ya no es "de lo que se venía hablando".
- El perfil (qué busca) se carga **por contacto**, no solo por la oportunidad: antes un cliente nuevo perdía entre turnos todo lo que había dicho y el bot le volvía a preguntar.

### Las fichas las arma el CÓDIGO (`listing-cards.ts`)

El modelo recibe las propiedades con una clave corta (P1, P2…) y devuelve en `mostrar` cuáles adjuntar. **El texto de la ficha (precio, dormitorios, metros, enlace) sale de la base.** El modelo no escribe fichas, así que no tiene dónde poner un precio inventado. Si el cliente nombró una propiedad puntual, su ficha va siempre. Negrita `*así*` solo en WhatsApp (en Instagram se verían los asteriscos).

### Validador (`guard.ts`): lo que el prompt pide, verificado en código

Revisa el texto del modelo contra los datos. Si falla, **un reintento** con la corrección concreta; si vuelve a fallar, sale una respuesta **armada por código** (verdadera por construcción). Bloquea: montos y superficies que no existen, formato de aviso sin propiedades reales, "no tengo" cuando la búsqueda encontró, **fotos/video/tour que esa propiedad no tiene** (por tipo de medio y oración por oración), ofrecer "zonas cercanas" sin alternativas, plazos que la inmobiliaria no definió ("en 24 horas"), compromisos (confirmar visita, aceptar precio), ofrecer mandar la ficha que ya va adjunta, repetir textual el mensaje anterior, y dialecto (renta, colonia, recámara, tuteo).

Trampas que ya mordieron — **no volver a pisarlas**:
- **`\b` después de "m²" no matchea nunca**: "²" no es carácter de palabra. Se usa `(?![\p{L}\d])` con flag `u`. El control de superficies no funcionó hasta que se vio esto.
- **"m" suelta no es millón**: en inmobiliaria es metros. "65 m²" se leía como 65 millones.
- **"millon" va antes que "mil"** en la alternancia, o "1,5 millones" da 1.500.
- **El tuteo se busca CON tildes**: "buscás" (voseo) y "buscas" (tuteo) difieren solo en la tilde. Con el texto normalizado el validador frenaba respuestas correctas.
- **Los dígitos de una URL no son montos**: se sacan las URLs antes de extraer.
- **No editar regex a través de scripts de Node con template literals**: `\b` se convierte en un carácter de retroceso real (0x08) y `\s` pierde la barra, sin error. Usar Edit directo o `String.raw`. Verificar con `grep -P '[\x00-\x08]'`.

### Cuándo avisa al equipo y cuándo pausa el bot

- **Derivar** (reclamo, pide una persona, legal): acuse + **pausa** la IA del hilo.
- **Avisar** (el bot contesta y **sigue activo**, aparece en la campanita): pedido de visita, oferta de precio, tasación, propietario que quiere vender, o cuando el texto **promete** algo de una persona ("lo consulto con el equipo", "paso tu oferta al asesor"). Esa promesa se detecta en el texto y dispara el aviso sí o sí: antes el bot decía "ya consulté" y nadie se enteraba.
- **La oferta la detecta Jev** (`hace_oferta`, pregunta tipada). El bot da el precio publicado y pasa la oferta; nunca la acepta ni la rechaza, eso lo decide el propietario.
- **Pedido de visita con UNA propiedad clara → se crea la visita** en Visitas como `solicitada`, sin fecha (el bot no confirma horarios), con lo que pidió el cliente en la nota. No duplica.
- En tasación y captación **no se muestran propiedades del catálogo**: la persona habla de SU propiedad, y mostrarle una con precio es una tasación implícita.

### Enlaces en la descripción (`properties/media.ts`)

En la cartera real **las 40 propiedades** tenían el enlace a la publicación y el video escritos dentro de la descripción, con `source_url`/`video_url` vacíos: el bot no podía mandar la ficha de 39 de 40. `mediaFromDescription` los extrae (publicación, YouTube/Vimeo, tour, fotos), descarta enlaces de relleno (`/p/xxxxxxx`), respeta paréntesis que son parte del enlace y sube `http` a `https`. **Solo completa campos vacíos**: lo cargado siempre manda. Lo aplican la sincronización y la carga del catálogo; `npm run backfill:media` (con `--aplicar`) completa lo que ya estaba en la base.

### Cómo se prueba

- `npm test` → `test-conversational.ts`: búsqueda, fichas, validador y enlaces, sin base ni modelos. **Los casos de "lo que no puede pasar" son mensajes reales que mandó el bot.**
- `npm run eval` → conversaciones completas contra los modelos y el catálogo **reales**, en una transacción que se revierte. No manda WhatsApp. Cuesta centavos; no está en `npm test`. Cada turno se audita contra el catálogo. `npm run eval -- <escenario>` corre uno solo.
- Que el eval pase **no alcanza**: leer las transcripciones. Cada ronda de lectura encontró algo que ningún chequeo veía todavía.

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
12. Triaje de mensajes: Jev clasifica, el código enruta y GPT redacta
13. Etiquetado del contacto, interesados por propiedad, handover y carga manual de propiedades
14. Motor conversacional: búsqueda en el catálogo, fichas armadas por código y validador anti-invención

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
