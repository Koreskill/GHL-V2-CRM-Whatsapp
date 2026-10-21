# Registro de implementación — operación, campañas y seguimientos

Fecha: 2026-10-20 · Rama: `feat/operacion-campanas-seguimientos` · Base: auditoría del 2026-10-19 ([auditoria-integral-2026-10-19.md](auditoria-integral-2026-10-19.md)).

## 0. Antes de desplegar (obligatorio)

1. Aplicar **`drizzle/0024_operacion_campanas_seguimientos.sql`** con el rol dueño y registrarla en `drizzle.__drizzle_migrations` (como las anteriores). Sin ella no existe la tabla `jobs`: **no entra ningún triaje** y Contactos/Campañas fallan.
2. Opcional: `drizzle/manual_health_grant.sql` (habilita el chequeo de migraciones de `/api/health`).
3. Variables nuevas (ver `.env.example`): `AGENT_MAX_REPLIES_PER_HOUR_GLOBAL`, `JOBS_WORKER`, `INCIDENT_ALERT_WEBHOOK_URL`. `CAMPAIGNS_SEND_ENABLED` ya existía.
4. Scheduler de Dokploy: `GET /api/cron/jobs` cada 1–5 min con `x-cron-secret` (respaldo del worker interno).
5. Correr `npm run test:db` contra **staging** (incluye `test-operacion-db.ts`). No se corrió: la única base disponible es producción.

## 1. Estado recuperado

- El plan previo de "semanas 2 y 3" **no estaba en un archivo**: estaba en la respuesta del 2026-10-19 en la conversación. Contenido: staging + CI + chequeo de migraciones en `/api/health`; estados de inmobiliaria + exportación; cola persistente para triaje y campañas; alertas de incidentes; prueba de aislamiento con dos organizaciones.
- Las optimizaciones propuestas ese día y su estado:

| Propuesta | Estado | Nota |
|---|---|---|
| Bandeja: dejar de recargar la página entera cada 3 s | **Hecho** | `/api/inbox/version` + recarga solo si cambió |
| Límite por IP → por usuario en la API autenticada | **Hecho (parcial)** | Tope por IP subido a 600/min; los límites finos ya eran por usuario en `authorize()` |
| `getClaims()` en el proxy en vez de `getUser()` | **No hecho** | Requiere confirmar soporte de claves asimétricas en el proyecto de Supabase; cambia la validación de sesión. Pendiente con verificación |
| Paginación por cursor de la bandeja | **No hecho** | No es bloqueante con el volumen actual (tope 100) |
| Costo completo de IA por cliente | **Hecho** | `usage.include` en OpenRouter; lo no informado se muestra aparte |
| Tope global real de respuestas | **Hecho** | Antes era por inmobiliaria |
| Caché del prompt / modelo por ruta | **No hecho** | Se decide con los datos de costo que ahora sí se registran |
| Mobile | **Fuera de alcance** | Pedido explícito |

## 2. Lista de implementación (orden, dependencias, aceptación)

| # | Funcionalidad | Depende de | Criterio de aceptación | Estado |
|---|---|---|---|---|
| 1 | Migración 0024 (cola, etiquetas, grupos, seguimientos, versiones, revisiones, columnas de campaña y estado) | — | Genera con drizzle-kit, incluye RLS + GRANT + política `crm_app` | Hecho |
| 2 | Cola persistente `jobs` + worker en `instrumentation.ts` + `/api/cron/jobs` | 1 | Un trabajo con lease vencido se retoma; encolar dos veces es uno | Hecho, probado en `test-operacion-db` (no corrido) |
| 3 | Ingesta: triaje encolado EN la transacción del evento; estados y referidos acotados a la cuenta | 2 | Evento duplicado = un trabajo; un reinicio no pierde el triaje | Hecho |
| 4 | Triaje: retoma reclamos abandonados; vencidos quedan en la campanita; corta si la inmobiliaria no está activa | 2, 9 | Un mensaje nunca queda sin respuesta Y sin aviso | Hecho |
| 5 | `deliverMessage`: orígenes `campaign`/`followup`, clave de idempotencia estable, corte por estado de la inmobiliaria | — | Reintentar no duplica; suspendida no envía nada automático | Hecho |
| 6 | Contactos: etiquetas, grupos, segmentos con criterio visible, acciones en bloque, duplicados, baja | 1 | Grupos/etiquetas/segmentos seleccionan exacto; ids ajenos no hacen nada | Hecho |
| 7 | Campañas: cuenta emisora, audiencia por fuentes, vista previa real, programar, pausar/reanudar/cancelar, progreso por estado real | 2, 5, 6 | Pausada no toma destinatarios; aceptado ≠ entregado ≠ respondido | Hecho |
| 8 | Seguimientos: secuencias de texto fijo, ventana real recalculada al enviar, horarios/zona/tope/separación, cortes | 2, 5, 6 | Respuesta del contacto corta; ventana vencida impide; no se superpone con bot/campaña | Hecho |
| 9 | Ciclo de vida: suspender / reactivar / eliminar (anonimizar) / exportar; sesión cortada | 1 | Suspendida: no entra nadie, nada automático, lo entrante se guarda | Hecho |
| 10 | Propiedades: engranaje → probar, validar y cambiar la hoja; sincronización inmediata; abrir la hoja | — | Cambiar la hoja actualiza la fuente que consulta el bot | Hecho |
| 11 | Mejora del agente: versiones + restaurar, reportar respuestas, ejemplos aprobados por admin | 1 | Nada de un cliente entra al prompt sin aprobación de admin; aislado por inmobiliaria | Hecho |
| 12 | Métricas de operación en Reportes + estado de integraciones en agencia | 2, 7, 8 | Medido y estimado separados | Hecho |
| 13 | `/api/health` con migraciones, alertas de incidentes, CI | — | Migración pendiente = 503; incidente nuevo = aviso | Hecho (CI sin base) |
| 14 | Arreglos rápidos de la auditoría: publicar en internet y delegar = solo admin | — | Un agente no publica ni delega | Hecho |

## 3. Decisiones (y por qué)

- **Decisiones de negocio** (popup del 2026-10-20): seguimientos con **texto fijo del admin**; eliminar = **anonimizar**; suspendida = **guardar lo entrante sin responder**; límites por defecto **5 por día, 8 a 22 h, 1 h entre pasos**.
- **Worker dentro del proceso + cron de respaldo**, no un servicio aparte: Dokploy corre un contenedor; agregar Redis/BullMQ sería infraestructura nueva sin necesidad medida. El reclamo atómico (`FOR UPDATE SKIP LOCKED` en una sola sentencia) funciona con el pooler de transacciones y con varias réplicas.
- **Los seguimientos NO van por la tabla `jobs`**: las inscripciones ya son la cola (lease + avance condicional por `next_position`); duplicarlas en `jobs` sería dos fuentes de verdad.
- **Ventana**: se mantiene la regla vigente del código (24 h de atención; IG/FB con `HUMAN_AGENT` hasta 7 días, solo personas), contrastada con el OpenAPI de Zernio 1.62 (que documenta la ventana de 24 h y `HUMAN_AGENT`). **No se asume** la ventana de 72 h de anuncios Click-to-WhatsApp: el proveedor no la documenta en lo que tenemos. Los seguimientos solo salen con la ventana `open` y un margen configurable.
- **Clave de idempotencia estable** (`campaign:<destinatario>`, `followup:<inscripción>:<paso>`, `optout:<mensaje>`): Zernio la conserva 24 h y responde sin reenviar. Por eso recuperar destinatarios "enviando" después de un reinicio es seguro.
- **Campaña y conversación en curso**: si el contacto escribió en los últimos 10 min, su envío se posterga 15 min (una promoción no pisa una respuesta del bot). Los seguimientos se posponen si hay un triaje en cola, una campaña saliendo o una persona escribiendo.
- **Segmento = vista guardada** (`contact_views`), dinámico. **Grupo** = selección fija. La campaña **congela** la audiencia al confirmar; quien pide la baja después se omite al enviar.
- **Duplicados: se detectan, no se fusionan**: fusionar contactos mueve conversaciones y oportunidades; equivocarse ahí rompe historiales. Queda como pendiente con diseño propio.
- **Crear/editar grupos y etiquetas: cualquier persona del equipo; borrar: solo admin.** Campañas y seguimientos: solo admin (interfaz + servidor).
- **Ejemplos aprobados**: máximo 5, 400 caracteres, encuadrados en el prompt como guía de TONO; los datos siguen saliendo solo de "DATOS VERIFICADOS" y del validador.
- **Eliminar exige suspender antes + escribir el nombre + confirmar la exportación**. No toca redes ni registros compartidos con otras inmobiliarias (presentaciones).

## 4. Qué se probó

| Prueba | Tipo | Resultado |
|---|---|---|
| `npm run typecheck`, `npm run lint`, `npm run build` | Estático / build | Limpios |
| `npm test` (17 suites, incluye `test-operacion.ts` nuevo: horarios, ventana, tope diario, baja, filtros, audiencia, backoff, estados) | Sin base | OK |
| `scripts/test-operacion-db.ts` (duplicado, aislamiento, grupos/segmentos, pausa, reintento, respuesta corta seguimiento, suspendida, lease) | Con base, sandbox revertido | **Escrita, NO ejecutada** (solo hay base de producción) |
| Zernio real, OpenRouter real (`usage.cost`), Google Sheets real, navegador | Integración | **No probado** |

Criterios del encargo (§12) y dónde se verifican: 1 → db #1 · 2 → db #2 · 3 → db #3 · 4 → db #4 · 5 → db #5 · 6 → db #6 · 7 → unit `nextSendTime` + `computeWindow` · 8 → db #8 + unit · 9 → **manual** (requiere hoja real; la lógica de bloqueo está en `checkSheetSource`) · 10 → db #10 (lease) + diseño (todo el estado vive en la base).

## 5. Limitaciones conocidas

- `usage.cost` de OpenRouter: se pide con `usage: { include: true }`; **verificar con una llamada real** que llega. Si no, el costo de chat queda "sin dato" (visible como tal).
- Al cambiar la hoja, una propiedad **editada a mano** no se pausa aunque no esté en la hoja nueva (regla existente de precedencia manual). La pantalla lo avisa; el resumen de sincronización lo cuenta.
- La bandeja recarga por `conversations.updated_at` y `message_triage.updated_at`: un cambio de estado de entrega (✓✓) aparece en la próxima novedad, no al instante.
- Anonimizar limpia Auth solo si hay `SUPABASE_SECRET_KEY`; sin ella las membresías quedan revocadas en la base (y `getSession` ya las rechaza).
- El worker interno usa `setInterval` en el proceso de Next: con `JOBS_WORKER=off` en todas las réplicas, el trabajo depende del Scheduler.

## 6. Pendientes actualizados

**Antes de vender**
1. Staging de Supabase y `test:db` en CI (el workflow ya corre typecheck, lint, tests y build).
2. Ejecutar `test-operacion-db.ts` y una prueba manual de punta a punta en staging: mensaje entrante → bot → seguimiento → respuesta corta; campaña pequeña con 2–3 números de prueba (aceptado → entregado → leído).
3. Red de propiedades operable (H-01 a H-03): no se tocó en esta etapa.
4. Delegación con destinatario explícito y consentimiento del contacto (H-05): hoy solo se restringió a admin.

**Piloto**
5. Conexión de canales atada a la inmobiliaria por `state` del OAuth (H-08).
6. Fusión asistida de duplicados.
7. Límites de login/API en la base (H-11) antes de una segunda réplica.
8. Laboratorio contra una versión NO activa del agente (hoy prueba la configuración guardada).

**Después**
9. RLS por tenant con `SET LOCAL` (H-04).
10. `getClaims()` en el proxy, paginación por cursor, caché de prompt y modelo por ruta según los costos medidos.
