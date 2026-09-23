@AGENTS.md

# Setter CRM — CRM multicanal

Bandeja única donde entran y se responden WhatsApp, Instagram DM y Facebook Messenger, con un agente de IA configurable por canal que contesta solo.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui
- Supabase (Postgres + Auth) con Drizzle ORM (driver `postgres`)
- **Zernio** como proveedor único de los tres canales — docs.zernio.com
- **OpenAI API** (SDK oficial `openai`) para el agente. NO OpenRouter.
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

## Fases (no avanzar si la anterior no compila)

Al terminar cada fase: `npm run typecheck`, `npm run lint` y `npm run build` limpios.

1. Modelo de datos y migración
2. Cliente de la API Zernio, tipado contra el OpenAPI
3. Webhook entrante y persistencia
4. Bandeja: listar, abrir y responder
5. Agente por canal (OpenAI)
6. Deploy en Dokploy, conexión de cuentas y barridos

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
