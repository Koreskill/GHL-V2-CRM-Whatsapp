# Auditoría integral — Setter CRM como portal inmobiliario en red

Fecha: 2026-10-19 · Rama auditada: `fix/conexion-instagram` (commit `4d51ffe`) · Método: lectura de código, migraciones y documentación, más pruebas que no tocan la base (`npm test`: 14 suites OK; `npm run typecheck`: limpio). **No se corrió nada contra la base**: `.env.local` apunta a producción.

Convenciones: **Verificado** = respaldado por código o prueba citada. **Potencial** = hace falta comprobarlo. **No evaluable** = falta acceso. **Mejora** = capacidad que conviene sumar.

---

## 1. Diagnóstico ejecutivo

**Lo que está sólido.** El núcleo de mensajería y el bot están bien construidos para un solo cliente o pocos clientes administrados por la agencia: webhook firmado con HMAC, fail-closed y deduplicado; un solo camino de salida (`deliverMessage`) con chequeo de inmobiliaria; todas las API routes y server actions pasan por un control de sesión y toman la organización de la sesión; el bot no tiene herramientas para publicar, borrar ni compartir, y sus datos se validan en código (fichas armadas desde la base, validador anti-invención). Los secretos de integraciones se guardan cifrados con AES-256-GCM.

**Lo que impide venderlo como "portal en red".**

1. **La red de propiedades no se puede operar desde el producto.** La función para publicar en la red (`publishToNetwork`) solo la llama un script de prueba. No hay pantalla para crear redes, sumar miembros, publicar, actualizar ni retirar. Lo publicado es una copia que no se actualiza: si cambia el precio o se vende la propiedad, la red sigue mostrando lo viejo. Las recomendaciones de la red no dicen qué inmobiliaria es la responsable.
2. **El aislamiento entre inmobiliarias depende solo del código.** Las políticas RLS de la base son `USING (true)`: si una consulta se olvida de filtrar por organización, el resultado mezcla clientes y la base no lo frena. Hoy no se encontró ninguna consulta expuesta sin filtro, pero la garantía es la disciplina, no el sistema.
3. **La delegación de conversaciones comparte datos personales con toda la red.** Cualquier agente puede delegar una conversación; la solicitud queda abierta a todas las inmobiliarias de la red; la primera que la toma se lleva el nombre del contacto y, si se autorizó, el historial y el teléfono. No hay destinatario elegido, aprobación de un administrador ni consentimiento del contacto.
4. **No hay ciclo de vida del cliente.** No se puede suspender ni dar de baja una inmobiliaria (`organizations.status` no se consulta en ningún lado: el webhook sigue entrando y el bot sigue contestando), y no hay exportación de datos.
5. **No hay un entorno de pruebas aparte ni red de seguridad para desplegar.** Solo existe la base de producción, las migraciones se aplican a mano, no hay CI ni rollback, y no hay alertas de errores.

**Veredicto:** listo para un **piloto administrado por la agencia** con inmobiliarias que **no** compartan entre sí (CRM + bot por cliente), una vez resueltos los puntos 4 y 5. **No está listo** para vender la red: el punto 1 es una función faltante, no un ajuste, y los puntos 2 y 3 tienen que estar resueltos antes de que dos inmobiliarias compartan algo.

---

## 2. Mapa de procesos y datos

### Actores y permisos (verificado en `src/lib/auth.ts`, `src/lib/roles.ts`, `src/lib/api.ts`)

| Actor | Cómo se identifica | Qué puede |
|---|---|---|
| Administrador de agencia | `app_metadata.is_agency_admin = true` (por SQL) | Ve todos los clientes, crea inmobiliarias y usuarios, asigna cuentas de mensajería, configura la hoja de propiedades, entra al espacio de un cliente (cookie `crm_acting_org`, auditada al entrar y salir) |
| Admin de inmobiliaria | `crm_role = admin` + `organization_id` | Configuración, conexión de cuentas, plantillas, campañas, Laboratorio, marca |
| Agente de inmobiliaria | `crm_role = agent` | Bandeja, pipeline, visitas, contactos, **publicar fichas públicas**, **delegar conversaciones** |
| Contacto final | `contact_identities (channel, external_id)` | Escribe por WhatsApp / Instagram / Messenger; ve fichas públicas `/p/[slug]` |
| Bot (triaje) | Corre como el sistema, con el `organization_id` de la conversación | Lee historial de ESA conversación, perfil del contacto y cartera propia; redacta; puede pausar la IA, crear una visita `solicitada`, actualizar etiquetas |
| Otra inmobiliaria de la red | `network_members.status = activa` | Ve `network_property_listings` publicados; ve y toma delegaciones abiertas |

### Integraciones

| Servicio | Uso | Credencial |
|---|---|---|
| Zernio | WhatsApp, Instagram y Messenger, para **todos** los clientes con **un solo** `ZERNIO_PROFILE_ID` | `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET` (env) |
| OpenRouter | Clasificación (Decisions API) y redacción | `OPENROUTER_API_KEY` (env, compartida) |
| Supabase | Postgres (rol `crm_app`) y Auth | env |
| Google Sheets | Catálogo por inmobiliaria | cuenta de servicio o CSV público |
| Cal.com / Google Calendar | Agenda | por inmobiliaria / por usuario, cifradas |

### Límites entre clientes

```
              ┌────────── Inmobiliaria A ──────────┐        ┌──── Inmobiliaria B ────┐
 Contacto ──► │ conversación → mensajes → triaje   │        │                        │
  (Zernio)    │ contacto, perfil, oportunidades    │        │                        │
              │ propiedades (privadas)             │        │                        │
              │      │ publishToNetwork (sin UI)   │        │                        │
              │      ▼                             │        │                        │
              │  network_property_listings ────────┼──red──►│ recomendaciones "Red"  │
              │  (copia, no se actualiza)          │        │ (sin nombre del dueño) │
              │  conversation_delegations ─────────┼──red──►│ cualquiera la toma:    │
              │  (nombre + historial/teléfono)     │        │ copia del contacto     │
              └────────────────────────────────────┘        └────────────────────────┘
   Base: RLS crm_app USING(true) → el único límite es el WHERE organization_id del código.
```

### Recorridos reconstruidos

- **Entrada de un mensaje:** Zernio → `POST /api/webhooks/zernio` (firma, reclamo en `webhook_events`, ingesta en una transacción) → `after()` espera 5 s → `triageIncomingMessage` (interruptores, ventana, topes, reclamo en `message_triage`) → `composeReply` → `deliverMessage`.
- **Alta de cliente:** la agencia crea la organización y el primer admin en `/agencia/nuevo` → el admin conecta un canal (OAuth en popup) → la cuenta queda **sin asignar** → la agencia la asigna en `/agencia/accesos` → la agencia configura la hoja en la ficha del cliente → el cliente configura el agente y lo prende.
- **Propiedades:** hoja → `GET /api/cron/properties` o botón → `properties` (lo que desaparece se pausa) → ficha pública opcional (`property_publications`). **Red: no hay recorrido en el producto.**

---

## 3. Hallazgos priorizados

Orden: primero lo que bloquea vender, después operación, después mejoras. "Seg" = vulnerabilidad de seguridad, "Op" = fallo operativo, "Prod" = función faltante o mejora.

### H-01 · La red de propiedades no existe como función del producto — Prod

- **Evidencia:** `publishToNetwork` ([src/lib/properties/queries.ts:94](../src/lib/properties/queries.ts#L94)) solo se llama desde `scripts/test-network-flow.ts`. No hay ningún `insert` sobre `networks` ni `network_members` en `src/`. El candado "En la red / Fuera de la red" de [propiedades/page.tsx:239](../src/app/(app)/propiedades/page.tsx#L239) solo muestra un estado que nadie puede cambiar.
- **Estado:** Verificado. **Severidad:** Crítica (para el modelo de negocio).
- **Impacto:** la propuesta de valor central (exposición en la red) no se puede entregar. Hoy una red solo se arma a mano por SQL.
- **Escenario:** una inmobiliaria quiere compartir una propiedad: no tiene botón; la agencia tendría que insertar filas a mano.
- **Recomendación:** construir el ciclo completo (ver flujo F-02): administración de redes y membresías en el plano de agencia; en la ficha de la propiedad, "Compartir en la red" con vista previa de exactamente qué campos salen, condiciones de colaboración y retiro; listado "Catálogo de la red" con la inmobiliaria responsable visible.
- **Esfuerzo:** Alto (supone 2-3 pantallas nuevas sobre funciones de datos que ya existen y están probadas).
- **Validación:** prueba de punta a punta: A publica → B la ve con el nombre de A → A cambia el precio en la hoja → B ve el precio nuevo en la siguiente sincronización → A la retira → B deja de verla y sus recomendaciones la descartan.

### H-02 · Lo publicado en la red no se actualiza ni respeta la disponibilidad — Prod/Op

- **Evidencia:** la proyección se copia una sola vez al publicar (`shareableFrom`, [queries.ts:11](../src/lib/properties/queries.ts#L11)); la sincronización de la hoja (`src/lib/sheets/properties-sync.ts`) no toca `network_property_listings`. El puntaje de la red no mira `availability` ([src/lib/scoring/candidates.ts](../src/lib/scoring/candidates.ts)). `listNetworkCatalog` ([queries.ts:165](../src/lib/properties/queries.ts#L165)) no comprueba que el **dueño** siga siendo miembro activo.
- **Estado:** Verificado. **Severidad:** Alta.
- **Impacto:** una inmobiliaria ofrece a su cliente una propiedad de otra que ya se vendió o cambió de precio. Pierde credibilidad la red entera.
- **Escenario:** A publica a USD 120.000, la vende y la marca en la hoja; la red sigue mostrándola como publicada a 120.000.
- **Recomendación:** al sincronizar o editar una propiedad, actualizar su fila de red en la misma transacción; si deja de estar `disponible|reservada`, pasarla a `retirada` automáticamente; filtrar el catálogo por dueño con membresía activa; guardar `source_updated_at` para mostrar "actualizada hace X".
- **Esfuerzo:** Medio.
- **Validación:** prueba en `test:db` que cambie precio y estado de una propiedad publicada y verifique la fila de red; prueba de que una inmobiliaria que sale de la red deja de aparecer.

### H-03 · Las recomendaciones de la red no identifican a la inmobiliaria responsable — Prod

- **Evidencia:** [src/lib/scoring/store.ts:285](../src/lib/scoring/store.ts#L285) arma la tarjeta de la red sin el nombre del dueño; `recommendations-panel.tsx` tampoco lo muestra. `property_presentations.ownerNotifiedAt` se marca al pedir visita ([presentations/queries.ts:98](../src/lib/presentations/queries.ts#L98)) pero no se envía ningún aviso, y ninguna pantalla crea presentaciones.
- **Estado:** Verificado. **Severidad:** Alta.
- **Impacto:** el asesor no sabe con quién coordinar; la inmobiliaria dueña no se entera de que hay un interesado. Sin atribución no hay reparto de comisión trazable.
- **Recomendación:** mostrar el dueño y las condiciones de colaboración en cada tarjeta; botón "Presentar a este contacto" que cree la `property_presentation`; aviso real a la dueña (campanita + correo) cuando se pide visita, sin exponer el contacto hasta que la dueña acepte.
- **Esfuerzo:** Medio.
- **Validación:** B presenta una propiedad de A → A ve la presentación en su bandeja con estado, sin nombre ni teléfono del contacto de B.

### H-04 · El aislamiento entre inmobiliarias depende solo del código — Seg

- **Evidencia:** todas las políticas para `crm_app` son `USING (true) WITH CHECK (true)` ([drizzle/0002_crm_app_role.sql:11](../drizzle/0002_crm_app_role.sql#L11), [0004_multi_tenant.sql:114](../drizzle/0004_multi_tenant.sql#L114)); [manual_harden_tenant_isolation.sql](../drizzle/manual_harden_tenant_isolation.sql) dice que el RLS por tenant "es un paso aparte, posterior". Revisé las 31 API routes y las 17 familias de server actions: todas autorizan y toman la organización de la sesión, y no encontré consultas expuestas sin filtro. Las consultas por `id` sin organización que aparecen son continuaciones internas sobre filas ya validadas.
- **Estado:** Verificado (el diseño); no se encontró una fuga explotable hoy.
- **Severidad:** Alta (la probabilidad crece con cada función nueva: hay más de 50 tablas y el código lo escribe en parte un asistente).
- **Impacto:** una sola consulta nueva sin `organization_id` expone contactos o conversaciones de otro cliente, sin error visible.
- **Recomendación:** (1) RLS por tenant: envolver cada request en una transacción con `SET LOCAL app.current_org = <org>` y políticas `organization_id = current_setting('app.current_org')::uuid`; un rol aparte (`crm_system`) para webhooks y barridos. (2) Mientras tanto, una prueba automática que recorra cada función exportada de `src/lib/**/queries.ts` con dos organizaciones y verifique que B nunca ve filas de A. (3) Regla de lint: prohibir `getDb()` en componentes de página.
- **Esfuerzo:** Alto para (1) (toca el acceso a la base de todo el código); Medio para (2).
- **Validación:** con RLS activo, `select count(*) from contacts` sin `SET LOCAL` devuelve 0 para `crm_app`; la prueba de dos organizaciones corre en CI.

### H-05 · La delegación expone datos personales a toda la red sin control — Seg/Privacidad

- **Evidencia:** [src/lib/delegations/flow.ts](../src/lib/delegations/flow.ts): `targetOrganizationId` nunca se completa al crear, así que toda solicitud queda abierta a la red; se usa siempre `nets[0]` (línea 81); `takeDelegation` (línea 178) la toma el primero; el nombre del contacto viaja siempre y el historial/teléfono según `scope`. Crear y tomar solo exige `authorizeAction()` (cualquier agente, no admin) en [conversaciones/actions.ts](../src/app/(app)/conversaciones/actions.ts). La `note` es texto libre visible para todas las inmobiliarias de la red antes de tomarla.
- **Estado:** Verificado. **Severidad:** Alta.
- **Impacto:** datos personales de un contacto pasan a otra empresa sin consentimiento del contacto ni aprobación de un responsable. En Argentina la cesión de datos personales a terceros requiere consentimiento (Ley 25.326). Riesgo legal y comercial (una inmobiliaria pierde un cliente a manos de otra por un clic de un agente).
- **Escenario:** un agente delega con una nota "Juan Pérez, 11-xxxx, busca 3 amb en Palermo"; cualquier agente de cualquier inmobiliaria de la red ve la nota y toma el contacto.
- **Recomendación:** elegir destinatario explícito; aprobación de un admin de la inmobiliaria de origen; la nota pasa por un filtro de datos personales o se muestra recién al tomarla; registrar consentimiento del contacto (mensaje con confirmación) antes de copiar teléfono o historial; red elegida explícitamente si hay más de una.
- **Esfuerzo:** Medio.
- **Validación:** un agente sin rol admin no puede delegar; una delegación sin destinatario no se puede crear; una inmobiliaria que no es destinataria no ve la solicitud.

### H-06 · No se puede suspender ni dar de baja una inmobiliaria, ni exportar sus datos — Op/Comercial

- **Evidencia:** `organizations.status` existe pero no se lee en ninguna parte del código (solo se lista en [agency/queries.ts:45](../src/lib/agency/queries.ts#L45)). El webhook enruta por cuenta sin mirar el estado de la organización ([ingest.ts](../src/lib/inbox/ingest.ts)); el triaje tampoco ([run.ts](../src/lib/agent/triage/run.ts)). No hay exportación de contactos, conversaciones ni propiedades.
- **Estado:** Verificado. **Severidad:** Alta.
- **Impacto:** un cliente que no paga sigue recibiendo mensajes y el bot sigue gastando tokens a cuenta de la agencia. Un cliente que se va no puede llevarse sus datos y la agencia no tiene procedimiento para borrarlos.
- **Recomendación:** estados `activa | suspendida | baja` que corten el acceso de usuarios, el bot, los barridos y la presencia en la red; "Exportar datos" (CSV/JSON de contactos, conversaciones, oportunidades, visitas, propiedades); procedimiento de baja: exportación → período de gracia → borrado o anonimización, registrado en `audit_logs`.
- **Esfuerzo:** Medio.
- **Validación:** con la inmobiliaria suspendida, un mensaje entrante se guarda pero el bot no responde, sus usuarios no entran y sus propiedades salen de la red.

### H-07 · Un único entorno: pruebas y migraciones contra producción, sin CI ni reversión — Op

- **Evidencia:** CLAUDE.md, "Entornos": `.env.local` apunta a la base de producción; `test:db`, `test:e2e` y `eval` se conectan a ella. Las migraciones se aplican a mano con el rol dueño y se registran a mano en `drizzle.__drizzle_migrations`. No hay `.github/` ni otro pipeline. Existen `scripts/staging-migrate.ts` y `.env.staging.example`, pero no hay staging creado.
- **Estado:** Verificado. **Severidad:** Alta.
- **Impacto:** un despliegue con una migración sin aplicar rompe toda la bandeja (lo dice el propio CLAUDE.md sobre `conversations.status`); un error en un script de prueba puede tocar datos reales; no hay vuelta atrás probada.
- **Recomendación:** rama de Supabase o proyecto de staging; pipeline (GitHub Actions o el build de Dokploy) que corra `typecheck`, `lint`, `npm test` y `test:db` contra staging; chequeo al arrancar que compare la última migración del journal con `__drizzle_migrations` y falle `/api/health` si no coinciden; cada migración con su script de reversión.
- **Esfuerzo:** Medio.
- **Validación:** un PR con un test roto no se puede desplegar; `/api/health` devuelve 503 con una migración pendiente.

### H-08 · Conectar un canal depende de que la agencia lo asigne, y "Sincronizar" de un cliente actúa sobre todos — Op/Seg

- **Evidencia:** todas las cuentas viven en un solo `ZERNIO_PROFILE_ID` ([zernio/accounts.ts](../src/lib/zernio/accounts.ts)); una cuenta nueva queda con `organizationId: null` (línea 72) hasta que la agencia la asigna. `POST /api/accounts/sync`, accesible a cualquier admin de inmobiliaria, sincroniza todas las cuentas e importa el historial de **todas** las cuentas pendientes de **todas** las inmobiliarias ([sync/route.ts:17](../src/app/api/accounts/sync/route.ts#L17)), y devuelve el conteo global de cuentas sin asignar.
- **Estado:** Verificado. **Severidad:** Media.
- **Impacto:** fricción en el alta (el cliente conecta y "no pasa nada" hasta que alguien de la agencia actúa); un cliente puede disparar trabajo pesado para otros y conocer un dato global.
- **Recomendación:** un perfil de Zernio por inmobiliaria (si el plan lo permite) o un `state` firmado en el `redirect_url` del OAuth que ate la cuenta conectada a la organización que inició el flujo; acotar el sync y la importación a la organización de la sesión; dejar el sync global solo para la agencia.
- **Esfuerzo:** Medio (depende de lo que permita Zernio: **no evaluable** sin su documentación de perfiles).
- **Validación:** un admin conecta WhatsApp y la cuenta aparece asignada a su inmobiliaria sin intervención; el sync de un cliente no importa cuentas de otro.

### H-09 · El trabajo en segundo plano vive en el proceso: un reinicio pierde respuestas — Op

- **Evidencia:** el triaje corre en `after()` con una espera de 5 s ([webhooks/zernio/route.ts:42](../src/app/api/webhooks/zernio/route.ts#L42)). El barrido `GET /api/webhooks/zernio` solo reprocesa eventos sin `processed_at`; un mensaje ya ingerido cuyo triaje se perdió no tiene barrido. Las campañas también corren en `after()` ([campanas/actions.ts:99](../src/app/(app)/contactos/campanas/actions.ts#L99)).
- **Estado:** Verificado (diseño); frecuencia **no evaluable** sin logs de producción.
- **Impacto:** cada redespliegue o caída deja sin respuesta a quien escribió en esos segundos, sin aviso a nadie. Con más clientes, más mensajes caen en esa ventana.
- **Recomendación:** cola persistente en Postgres (tabla de trabajos con lease, como ya existe para Google Calendar en `calendar_sync_jobs`); barrido que tome mensajes entrantes sin `message_triage` dentro de la ventana de vigencia; parada ordenada del contenedor (esperar los `after()` en curso).
- **Esfuerzo:** Medio.
- **Validación:** matar el contenedor justo después de un mensaje entrante → al volver, el barrido lo contesta o lo marca como vencido de forma visible.

### H-10 · El costo por cliente está incompleto y no hay tope de gasto por inmobiliaria — Op/Comercial

- **Evidencia:** solo la Decisions API guarda `costUsd` ([ai/decisions.ts:115](../src/lib/ai/decisions.ts#L115)); las llamadas de chat (redacción y extracción, las más caras) guardan tokens pero no costo ([ai/openrouter.ts:77](../src/lib/ai/openrouter.ts#L77)). El tope "global" `AGENT_MAX_REPLIES_PER_HOUR` en realidad se cuenta por inmobiliaria ([run.ts:305](../src/lib/agent/triage/run.ts#L305)), así que con N clientes el máximo real es N × 300 por hora. No hay presupuesto mensual por cliente.
- **Estado:** Verificado. **Severidad:** Media.
- **Impacto:** no se puede cobrar por uso ni detectar un cliente que consume de más; un ataque de mensajes a varios clientes no tiene techo total.
- **Recomendación:** guardar el costo de cada llamada (OpenRouter lo devuelve en `usage`, o calcularlo con una tabla de precios); presupuesto mensual por inmobiliaria con aviso al 80% y corte del bot al 100%; renombrar el tope por organización y agregar un tope global real.
- **Esfuerzo:** Bajo-Medio.
- **Validación:** el reporte de agencia muestra el costo del mes por cliente y coincide (±5%) con la factura de OpenRouter.

### H-11 · Límites de uso e intentos de login en memoria — Seg/Op

- **Evidencia:** [rate-limit.ts:3](../src/lib/rate-limit.ts#L3) usa un `Map` en memoria.
- **Estado:** Verificado. **Severidad:** Media.
- **Impacto:** cada reinicio reinicia los contadores de fuerza bruta; con dos réplicas los límites se duplican. Hoy hay una réplica, así que el riesgo es acotado.
- **Recomendación:** mover los límites de login, recuperación y API a Postgres (tabla con ventana) o Redis antes de escalar a más de un contenedor. Sumar la protección de Supabase Auth (CAPTCHA) en login y recuperación.
- **Esfuerzo:** Bajo.
- **Validación:** 6 intentos fallidos para el mismo email, reinicio del contenedor, 7.º intento sigue bloqueado.

### H-12 · Campañas sin baja voluntaria ni registro de consentimiento — Op/Legal

- **Evidencia:** no hay columna ni lógica de opt-out/consentimiento en `contacts` ni en `src/lib/campaigns/`.
- **Estado:** Verificado. **Severidad:** Media (hoy el envío real está detrás de `CAMPAIGNS_SEND_ENABLED`).
- **Impacto:** mandar plantillas de marketing a quien pidió no recibir más baja la calidad del número en Meta y puede terminar en bloqueo de la cuenta de WhatsApp del cliente.
- **Recomendación:** `contacts.marketing_opt_out_at`; detectar "BAJA/STOP" en el entrante; excluir esos contactos en `contact-filters.ts` para campañas.
- **Esfuerzo:** Bajo.
- **Validación:** un contacto que escribió "baja" no entra en la audiencia congelada de un lote.

### H-13 · Cualquier agente puede publicar una propiedad en internet — Seg/Proceso

- **Evidencia:** `publishProperty` usa `authorizeAction()` (cualquier rol) en [publicacion-actions.ts:20](../src/app/(app)/propiedades/publicacion-actions.ts#L20); solo la marca exige admin.
- **Estado:** Verificado. **Severidad:** Media.
- **Impacto:** una ficha pública con precio o fotos que la inmobiliaria no autorizó queda indexable en buscadores.
- **Recomendación:** publicar solo admin, o agente con aprobación de un admin; registrar quién publicó en `audit_logs`.
- **Esfuerzo:** Bajo.
- **Validación:** un agente recibe "Solo un administrador puede publicar" y queda un pedido de aprobación.

### H-14 · Sin alertas: los errores se descubren mirando — Op

- **Evidencia:** no hay servicio de errores ni notificaciones en `src/`; `incidents` es una bandeja que hay que abrir; `/api/health` existe.
- **Estado:** Verificado. **Severidad:** Media.
- **Impacto:** una cuenta de WhatsApp desconectada, una hoja que falla o una clave vencida se notan cuando el cliente se queja.
- **Recomendación:** monitor externo sobre `/api/health`; aviso (correo o Telegram) cuando se abre un incidente nuevo o se reabre uno; métrica diaria por cliente: mensajes entrantes, respondidos por el bot, derivados, sin respuesta.
- **Esfuerzo:** Bajo.
- **Validación:** desconectar una cuenta en staging dispara un aviso en menos de 5 minutos.

### H-15 · Usuarios sin fila de membresía entran igual — Seg

- **Evidencia:** [auth.ts:64](../src/lib/auth.ts#L64): "Sin fila de membresía se deja pasar".
- **Estado:** Potencial (depende de si quedan cuentas antiguas sin fila).
- **Severidad:** Baja-Media.
- **Impacto:** a esas cuentas no se las puede suspender por `organization_members`.
- **Recomendación:** consulta de control: usuarios de Auth con `crm_role` sin fila en `organization_members`; crearlas y después exigir la fila.
- **Esfuerzo:** Bajo. **Validación:** la consulta devuelve 0 y el código niega sin fila.

### H-16 · Suspender en una inmobiliaria bloquea la cuenta en todas — Op

- **Evidencia:** [agency/users.ts:169](../src/lib/agency/users.ts#L169) usa `ban_duration` en Auth, que es global.
- **Estado:** Verificado. **Severidad:** Baja (hoy un usuario pertenece a una sola inmobiliaria).
- **Recomendación:** si se habilitan usuarios en varias inmobiliarias, suspender solo por membresía.
- **Esfuerzo:** Bajo.

### Menores (Baja)

- **Contador de vistas de fichas públicas** sin filtrar robots ni repeticiones: métricas infladas para el cliente. *Verificado.*
- **CSP con `'unsafe-inline'` en scripts** ([next.config.ts](../next.config.ts)): aceptado y documentado; reemplazar por nonces cuando haya contenido de terceros en las páginas. *Verificado.*
- **Envío que expira por la red** (`deliverMessage`): si Zernio llegó a enviar pero la respuesta no volvió, la fila queda `failed` y reintentar crea otra con otra `Idempotency-Key` → posible duplicado. *Potencial.*
- **Tablas `legacy_*`** del bot anterior siguen en la base. *Verificado en migraciones.*

### Lo que está bien (verificado, para no tocarlo)

- Las 31 API routes y todas las server actions validan la sesión y toman la organización de la sesión, nunca del formulario.
- `deliverMessage` vuelve a comprobar la organización de la conversación y bloquea expedientes delegados.
- Webhook de Zernio: HMAC sobre el body crudo, comparación en tiempo constante, rechazo sin secreto, tope de 1 MB, reclamo por id, 200 ante lo desconocido. Webhook de Cal.com firmado con el secreto de cada inmobiliaria.
- El bot no tiene herramientas de publicar, borrar ni compartir; el catálogo de la red **no entra** a su prompt; notas internas y documentos tampoco; las fichas salen de la base, no del modelo.
- La proyección de red y la ficha pública excluyen `address_full`, notas internas, documentos y propietario.
- Tokens de terceros cifrados con AES-256-GCM; cookies `httpOnly` y `secure`; CSRF por `Origin`; headers de seguridad; redirecciones validadas con `safeNext`.
- `npm test` (14 suites) y `typecheck` pasan.

---

## 4. Flujos propuestos

### F-01 · Alta de una inmobiliaria (hoy: 5 pasos con 3 esperas de la agencia)

| Paso | Hoy | Propuesto |
|---|---|---|
| 1 | Agencia crea org + admin y pasa la contraseña a mano | Agencia crea org y envía **invitación** (el flujo ya existe) — el admin elige su contraseña |
| 2 | Admin conecta canal → cuenta "sin asignar" | La conexión queda atada a la org por el `state` del OAuth (H-08) |
| 3 | Agencia asigna la cuenta | — (eliminado) |
| 4 | Agencia configura la hoja | Admin pega el link de su hoja en un asistente que valida columnas con `analyze.ts` y muestra los problemas antes de importar |
| 5 | Admin configura el agente | Asistente: prompt base, modo `borrador` por defecto los primeros 7 días, Laboratorio sugerido antes de pasar a `auto` |

Beneficio: el cliente llega solo a "bot respondiendo en borrador" sin abrir un ticket. Una lista de verificación visible ("Canal conectado ✓ · Catálogo importado ✓ · Agente probado ✗") marca qué falta y quién lo tiene que hacer.

### F-02 · Ciclo de una propiedad en la red

**Alta** (hoja o manual) → **validación** (`publishBlockers` ya existe para la ficha pública: reutilizarlo; exigir precio, moneda, operación, zona y al menos una foto) → **compartir** (admin elige red y condiciones de colaboración; vista previa de los campos que salen) → **distribución** (aparece en el "Catálogo de la red" de los miembros, con la inmobiliaria responsable) → **consulta** (otro asesor "presenta" la propiedad a su contacto; la dueña ve la presentación sin datos del contacto) → **actualización** (cada sincronización actualiza la fila de red; "actualizada hace X") → **retiro** (manual o automático al venderse / pausarse / suspender la inmobiliaria).

**Duplicados:** la misma propiedad captada por dos inmobiliarias es común. Proponer detección por dirección normalizada + operación + superficie, mostrada como "posible duplicado" sin fusionar automáticamente.

### F-03 · Delegación de un contacto

Agente propone → **admin de origen aprueba** → elige **destinataria** → se le pide al contacto que acepte que lo atienda otra inmobiliaria (plantilla) → recién con el "sí" viajan nombre, teléfono e historial → queda en `audit_logs` de ambas.

### F-04 · Baja de un cliente

Agencia marca `suspendida` (corte inmediato de bot, usuarios y red; los mensajes entrantes se siguen guardando) → genera la exportación → período de gracia (ej. 30 días) → `baja`: anonimiza contactos y mensajes, borra credenciales de integraciones, desasigna cuentas de Zernio. Todo con fecha y autor en `audit_logs`.

---

## 5. Plan de implementación

### Antes de vender (imprescindible) — estimado 3 a 5 semanas de una persona

1. Entorno de staging + CI + chequeo de migraciones en `/api/health` (H-07).
2. Estados de inmobiliaria, corte de bot/acceso y exportación de datos (H-06).
3. Delegación con destinatario, aprobación y consentimiento — o apagarla hasta tenerlo (H-05). **Apagarla es la opción rápida.**
4. Publicación pública solo por admin (H-13) y baja de campañas (H-12).
5. Costo completo por cliente y tope mensual (H-10).
6. Alertas mínimas: monitor de `/api/health` y aviso de incidentes (H-14).
7. Prueba automática de aislamiento con dos organizaciones sobre todas las consultas (H-04, parte 2).

### Piloto (con 2-3 inmobiliarias, primero sin red)

8. Conexión de canales atada a la organización (H-08) y asistente de alta (F-01).
9. Cola persistente para el triaje y las campañas (H-09).
10. Límites en base de datos (H-11), control de membresías (H-15).
11. **Red, versión 1** (H-01 a H-03): administración de redes, compartir/retirar, propagación, catálogo con dueño, presentaciones. Pilotear con dos inmobiliarias de confianza.

### Evolución posterior

12. RLS por tenant con `SET LOCAL` (H-04, parte 1).
13. Detección de duplicados en la red, reportes de la red (qué se compartió, cuántas consultas generó, quién cerró).
14. Posicionamiento público (sitemap, datos estructurados de las fichas `/p/`) si se confirma ese alcance.
15. Facturación por uso con los datos de H-10.

---

## 6. Criterios de aceptación

| Pendiente | Se considera resuelto cuando… |
|---|---|
| H-01 Red operable | Un admin comparte y retira una propiedad desde la interfaz, sin SQL, y otra inmobiliaria de la red la ve y deja de verla |
| H-02 Propagación | Cambiar precio o estado en la hoja se refleja en la red en la siguiente sincronización; vendida/alquilada/pausada sale sola; prueba en `test:db` |
| H-03 Atribución | Cada tarjeta de red muestra la inmobiliaria dueña; una presentación aparece en la bandeja de la dueña sin datos del contacto |
| H-04 Aislamiento | Prueba de dos organizaciones en CI sobre todas las consultas exportadas; (fase 2) con RLS, `crm_app` sin `app.current_org` no lee filas |
| H-05 Delegación | Sin destinatario o sin aprobación de admin no se crea; ninguna otra inmobiliaria ve la solicitud; teléfono/historial solo con consentimiento registrado |
| H-06 Ciclo de vida | Con la inmobiliaria suspendida: el bot no responde, sus usuarios no entran, sus propiedades salen de la red; la exportación descarga todos sus datos |
| H-07 Entornos | Staging separado; CI bloquea un despliegue con tests rotos; `/api/health` = 503 con una migración pendiente |
| H-08 Conexión | Conectar un canal lo asigna a la inmobiliaria que lo inició; el sync de un cliente no toca cuentas de otro |
| H-09 Cola | Matar el proceso tras un mensaje entrante no deja el mensaje sin respuesta ni sin registro |
| H-10 Costos | Costo mensual por cliente visible en agencia y dentro de ±5% de la factura; el bot se corta al 100% del presupuesto |
| H-11 Límites | Bloqueo de login sobrevive a un reinicio |
| H-12 Baja de campañas | "BAJA" excluye al contacto de toda campaña futura |
| H-13 Publicación | Un agente no puede publicar sin aprobación de un admin |
| H-14 Alertas | Incidente nuevo → aviso en menos de 5 minutos |

---

## 7. Límites de la auditoría

- **No se tocó la base** (solo existe producción). No se verificó el estado real de las migraciones aplicadas, la cantidad de clientes, redes o membresías existentes, ni si hay cuentas sin fila de membresía (H-15).
- **No evaluable:** respaldos y recuperación de Supabase (PITR, retención), capacidades de perfiles de Zernio por cliente (H-08), límites de mensajería de Meta por número, verificación de la app de Google, comportamiento con carga real (no se midió rendimiento; todo lo dicho sobre escala es inferencia del diseño, no medición).
- **No se probaron** los flujos en el navegador ni contra Zernio, OpenRouter, Google o Cal.com.
- **"Posicionamiento" no está definido en el proyecto.** Hay fichas públicas con metadatos Open Graph, pero sin sitemap ni datos estructurados. Esta auditoría trata la exposición **dentro de la red** como el alcance principal; el posicionamiento en buscadores queda como evolución (punto 14) hasta que se confirme.
- **Preguntas que cambiarían prioridades:**
  1. ¿La red la opera la agencia (curada) o se suman inmobiliarias solas?
  2. ¿Hay acuerdo comercial de comisión compartida que el sistema deba registrar?
  3. ¿El cliente paga un fijo o por uso? (define cuánto urge H-10)
  4. ¿Cuántas inmobiliarias se esperan en los primeros 6 meses? (define cuándo pasar a RLS por tenant y a más de una réplica)
