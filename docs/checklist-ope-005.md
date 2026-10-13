# Checklist OPE-005: lo que tenés que hacer vos

Todo el código de las fases 0 a 7 está en la rama `feat/ope-005-identidad` (checkpoint commiteado el 2026-10-13, sin push). Typecheck, lint y build pasan; los tests sin base de datos pasan. **Nada se probó contra Google, Supabase, Zernio ni la base real.**

## 1. Antes de desplegar (obligatorio)

- [ ] Revisar el diff y commitear en la rama (hay cambios tuyos previos de Sheets/propiedades mezclados en el working tree).
- [ ] Aplicar con el rol dueño, en orden: `drizzle/0018_accesos_y_cuentas.sql`, `0019_invitaciones_y_estados.sql`, `0020_revision_de_borradores.sql`, `0021_laboratorio.sql`, `0022_agenda_interna_y_google.sql`. Registrar cada una en `drizzle.__drizzle_migrations` (como hacés con las anteriores). Antes comprobar si 0013 a 0017 ya están aplicadas: sin ellas todo rompe.
- [ ] 0022 usa `CREATE EXTENSION btree_gist` y una restricción de exclusión sobre `visits`. Probarla primero en staging.
- [ ] Correr `npm test` completo contra una base de staging (incluye `test-lab-sandbox`, que verifica que el Laboratorio no deja filas ni contamina otras requests). No lo corrí.

## 2. Variables de entorno (Dokploy)

- [ ] `ALLOWED_HOSTS` = tu dominio público (ej. `crm.tudominio.com`). Evita que un Host falsificado apunte los correos de recuperación/invitación a otro dominio. Sin ella funciona, pero con el riesgo.
- [ ] `SUPABASE_SECRET_KEY` (aprobar accesos, invitar, suspender, dar de baja).
- [ ] `INTEGRATIONS_ENCRYPTION_KEY` (32 bytes en base64): cifra los tokens de Google.
- [ ] `GOOGLE_CALENDAR_CLIENT_ID` y `GOOGLE_CALENDAR_CLIENT_SECRET` (cliente OAuth de Calendar, distinto del de login).
- [ ] `CRON_SECRET` (ya existente) y `OPENROUTER_API_KEY` (Laboratorio).
- [ ] Opcional: `SOURCE_COMMIT` para que `/api/health` muestre la versión.

## 3. Google Cloud (login)

- [ ] Proyecto, pantalla de consentimiento (nombre, dominio, correo de soporte reales), cliente OAuth tipo web.
- [ ] Callback autorizado = la URL que muestra el proveedor Google dentro de Supabase.
- [ ] Solo scopes de identidad (`openid email profile`).

## 4. Supabase

- [ ] Auth, Providers: activar Google con Client ID y Secret.
- [ ] Auth, URL Configuration: Site URL de producción y Redirect URLs exactas (`https://<host>/auth/callback`, `https://<host>/auth/confirm`; agregar staging y localhost para desarrollo).
- [ ] **SMTP propio** (el de Supabase no es para producción): elegir proveedor, verificar el dominio del remitente (SPF/DKIM), cargar plantillas de recuperación e invitación.
- [ ] Probar el vínculo de identidades: un usuario existente con email/contraseña entra con Google del mismo email verificado y conserva su id, membresía y oportunidades.
- [ ] Verificar que un usuario suspendido (`ban_duration`) pierde acceso de inmediato con una sesión abierta. Si no, hay que revocar sus sesiones.
- [ ] Confirmar en el panel qué hace `updateUserById` con `app_metadata: { crm_role: null }` en tu versión (la baja depende de que borre las claves).

## 5. Google Cloud (Calendar)

- [ ] Habilitar Google Calendar API.
- [ ] Cliente OAuth web nuevo, con callback `https://<host>/api/calendar/google/callback`.
- [ ] Scopes: `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.app.created`. **Validar con una cuenta real que alcanzan** para listar, consultar ocupación, crear el calendario secundario y escribir eventos en él. Si no, evaluar `calendar.events.owned`.
- [ ] La app en modo "Testing" emite refresh tokens que **vencen a los 7 días**: publicar y, si Google lo exige para estos scopes, pasar la verificación antes de producción.
- [ ] Programar en Dokploy Scheduler `GET /api/cron/calendar-google` cada 5 minutos con `x-cron-secret`. Debe llamarse por la URL pública https (de ahí sale la dirección de las notificaciones push).

## 6. Decisiones de negocio pendientes (no las tomé yo)

- [ ] Duración de visita, traslado, anticipación mínima, horizonte y asesores elegibles: se cargan en Calendario, Disponibilidad. Mientras no estén, no se ofrece ningún horario.
- [ ] ¿Alta autónoma de inmobiliarias nuevas con Google, o solo por invitación/aprobación (como está ahora)?
- [ ] ¿Un usuario puede pertenecer a varias inmobiliarias? Hoy `app_metadata` guarda una sola.
- [ ] Texto del acuse de derivación que apruebe cada inmobiliaria.
- [ ] Política de retención y anonimización de los ejemplos del Laboratorio; quién puede revisar conversaciones.
- [ ] Modelos de agente/simulador/juez y presupuesto por corrida. (El modelo `gemini-3.8-flash-tts` es solo de voz: no usarlo acá.)
- [ ] Quién aprueba versiones del agente, alertas y recuperación.

## 7. Pruebas manuales en staging (no automatizables sin cuentas reales)

- [ ] Google nuevo sin invitación: queda en `/acceso-pendiente`; la agencia lo aprueba en `/agencia/accesos` y entra solo a esa inmobiliaria.
- [ ] Invitación: generar enlace, abrirlo con otra cuenta (debe rechazar "otro email"), con la correcta (entra), reusarlo (debe fallar), dejarlo vencer.
- [ ] Cancelar el consentimiento de Google, usar un código viejo y un `next` externo: no abren sesión ni redirigen fuera.
- [ ] Recuperación: correo real, enlace vencido, reutilizado y abierto en otro navegador.
- [ ] Suspender y reactivar un agente; intentar suspender al único administrador (debe negarse).
- [ ] Cuenta de Zernio nueva: aparece en Accesos como "sin asignar" y no entra a ninguna inmobiliaria hasta asignarla.
- [ ] Baja confianza: un "hola, info" deja un borrador, no sale solo. Mandarlo editado y comprobar `review_action = editado`.
- [ ] Laboratorio: una corrida completa; verificar que no llegó ningún WhatsApp, que no quedaron contactos `Laboratorio ...` y mirar los hallazgos. Repetir un caso dudoso (los modelos no son deterministas).
- [ ] Calendario interno: dos visitas del mismo asesor que se pisan parcialmente (la segunda debe rechazarse); reprogramar y cancelar (el evento de Google se mueve/borra); conexión de Google revocada desde la cuenta de Google (debe quedar "reconexión requerida" y dejar de ofrecer sus horarios); cambio de zona horaria.
- [ ] Editar o borrar en Google un evento publicado por GHL: debe quedar "divergente" y mostrarse, sin cambiar la visita.

## 8. Lo que NO quedó hecho (pendiente de desarrollo)

- [ ] **El agente todavía no ofrece ni reserva horarios solo.** Existen `GET /api/calendar/availability` y `POST /api/calendar/book` (ofertas vigentes de 15 min, revalidación y reserva atómica), pero falta conectarlos a `composeReply`/guard y definir qué asesor atiende cada visita.
- [ ] Laboratorio: falta el evaluador LLM separado ("juez"), el simulador de cliente con modelo, la comparación entre versiones y `agent_config_versions` con publicación/rollback. Hoy los hallazgos son deterministas (validador + reglas por turno). Repetición de casos no deterministas: manual.
- [ ] Laboratorio: la transacción de cada escenario queda abierta durante las llamadas a modelos y el consumo de IA se revierte con ella (no hay costo registrado por corrida). Pasar a almacenamiento aislado con jobs durables si el uso crece.
- [ ] Bandeja de revisión dedicada (lista con responsable, antigüedad y filtros) y modo sombra para medir la política nueva antes de activarla. Hoy se usa la campanita y el panel de la conversación.
- [ ] Importación bidireccional desde Google (segunda etapa), sincronización incremental con `nextSyncToken` y manejo de `410 Gone`: hoy solo se detectan divergencias de los eventos que publica GHL.
- [ ] Migración de Cal.com: falta inventariar `visit_bookings` activas por inmobiliaria, agregar el campo de proveedor a los enlaces históricos y un script de comparación. El cambio de gestor es por inmobiliaria (`calendar_settings.provider`); el rollback exige conciliar lo creado antes.
- [ ] Envío real de la invitación por correo (hoy se copia el enlace) y reemplazo de la entrega de contraseñas por invitación en el alta de clientes.
- [ ] Optimización (fase 7) sin hacer: chat con SSE incremental, rate limit compartido (hoy en memoria: con más de una réplica se multiplica), RLS por organización con `SET LOCAL`, adjuntos, campañas con consentimiento/exclusiones, vinculación de identidades de contactos, matching versionado, metas de Reportes.
- [ ] No pude verificar si `manual_harden_tenant_isolation.sql` ya se ejecutó en producción: confirmarlo antes de asumir los índices por organización.
- [ ] Reconciliar README y este `CLAUDE.md` con el esquema real una vez aplicadas las migraciones.

## 9. Auditoría del checkpoint (2026-10-13)

Corregido en este checkpoint:
- [x] `getSession` rechaza membresías suspendidas o dadas de baja aunque el JWT siga vigente.
- [x] Aprobar un acceso / aceptar una invitación ya no mueve en silencio a una cuenta con otra inmobiliaria; aprobar deja la membresía `active` (antes podía quedar `revoked`) y deshace Auth si falla la base.
- [x] `applyManualSchedule` no registra evento ni encola Google si la visita ya estaba cerrada.
- [x] `requestOrigin` respeta `ALLOWED_HOSTS` (OAuth y push de Google).
- [x] Pool de base con tope y timeouts; tope global de corridas del Laboratorio.
- [x] CSRF: sin `Origin` se rechaza `Sec-Fetch-Site: cross-site`. `/api/calendar/availability` valida que el asesor sea miembro activo.
- [x] `npm test` separado: `test` (sin base), `test:db` (con base), `test:all`.

Sigue pendiente (no se tocó):
- [ ] **`.env.local` apunta a producción.** Crear staging (proyecto o rama de Supabase) ANTES de correr `test:db`/`test:e2e`/`eval`.
- [ ] `test:db` nunca corrió completo: el primer intento falló porque la base no tiene la migración 0022 (esperable hasta aplicarla).
- [ ] Rate limit en memoria; rotación de `INTEGRATIONS_ENCRYPTION_KEY` (formato `v1` sin identificador de clave); regla del último administrador no atómica; `HEALTHCHECK` en el Dockerfile.
