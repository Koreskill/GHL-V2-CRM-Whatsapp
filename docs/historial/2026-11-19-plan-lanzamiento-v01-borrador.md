# Plan de lanzamiento — Cowin en producción, con WhatsApp oficial

Versión 01, borrador · 2026-11-19 · Base: auditoría de código del 19/11 y estado medido de producción ([ESTADO](../ESTADO.md)).

Este plan es el **dueño del procedimiento** para salir al público. No rediseña el producto: las etapas funcionales siguen en el [análisis del 16/11, §10](2026-11-16-analisis-chatbot-whatsapp.md), las reglas técnicas en [CLAUDE.md](../../CLAUDE.md) y la configuración de Google, Supabase y SMTP en [checklist-ope-005](../checklist-ope-005.md). Acá se ordena qué se hace, quién lo hace, en qué orden y cómo se comprueba.

Cada paso tiene un **responsable** (Koreskill = vos y el equipo técnico, Cowin, inmobiliaria o Meta) y un **criterio de cierre** comprobable. Un paso sin su criterio cumplido no habilita el siguiente.

---

## 0. Punto de partida (medido el 19/11)

- Producción (`cowin.estudiantehibrido.com`) corre `main` del 3/10. El PR #5 (cola, campañas, seguimientos, medios) **no está desplegado**.
- **WhatsApp se desconectó el 5/11** con el motivo `WhatsApp coexistence disconnected: PRIMARY_INACTIVITY (initiated by system)`. En modo coexistencia (el número sigue también en la app WhatsApp Business del teléfono), Meta corta el vínculo si la app del **teléfono principal** pasa unos 14 días sin abrirse. No es una falla del sistema ni un bloqueo del número.
- El bot no contestó nada en 30 días; todo entra por Instagram (94 conversaciones activas) y su agente está apagado.
- Red Cowin vacía, agenda de visitas sin configurar, 119 propiedades bien cargadas.

**Riesgo aceptado hoy:** no hay staging; `.env.local` de la máquina de desarrollo apunta a la base de producción con la clave de servicio. Cada paso de este plan evita escribir en producción salvo donde se indica. Pasar a staging queda como decisión abierta (§10).

---

## Fase 1 — Recuperar el canal y operar lo que ya está (sin código)

| # | Paso | Responsable | Criterio de cierre |
|---|---|---|---|
| 1.1 | **Reconectar WhatsApp de Cowin** desde Configuración → Cuentas (Embedded Signup de Meta por Zernio, modo coexistencia). Usar la cuenta de Meta que es **dueña del portfolio de Cowin**. | Cowin + Koreskill | La cuenta figura `connected` y un mensaje de prueba entra a la bandeja. |
| 1.2 | **Regla de inactividad:** la persona que tiene el teléfono principal abre la app WhatsApp Business al menos **una vez por semana** (margen sobre los 14 días). Anotarlo como tarea recurrente con responsable con nombre. | Cowin | Recordatorio semanal creado; responsable asignado. |
| 1.3 | Si se prefiere no depender de un teléfono: migrar el número a **Cloud API puro** (modo `api` del Embedded Signup). Contra: deja de usarse la app en el teléfono. Es una decisión (§10). | Cowin decide | Decisión registrada en el ESTADO. |
| 1.4 | **Decidir qué atiende el bot en Instagram** (hoy entra todo por ahí y el agente está apagado). Recomendación: prender en modo `borrador` una semana, después `auto`. | Cowin | Agente de Instagram configurado; borradores revisados a diario la primera semana. |
| 1.5 | Cargar `SOURCE_COMMIT` en Dokploy (variable de build/entorno con el commit desplegado). | Koreskill | `/api/health` muestra la versión real. |
| 1.6 | Aplicar `drizzle/manual_health_grant.sql` con el rol dueño. | Koreskill | `/api/health` responde `migrations.status` distinto de `desconocido`. |
| 1.7 | Scheduler de Dokploy: `GET /api/webhooks/zernio` (barrido de eventos, cada 30 min), `GET /api/cron/properties` (hoja, cada 1 h), y — después del despliegue de la Fase 3 — `GET /api/cron/jobs` (cada 2 min). Todos con `x-cron-secret`. | Koreskill | Cada tarea muestra ejecuciones 200 en el historial del Scheduler. |
| 1.8 | Configurar la **agenda de visitas** (Calendario → Disponibilidad: duración, traslado, anticipación, horizonte, asesores). Sin esto el bot no ofrece horarios. | Cowin | Un pedido de visita de prueba muestra horarios reales. |

---

## Fase 2 — Corregir antes de desplegar (código)

Hallazgos de la auditoría del 19/11 que bloquean salir al público. Cada uno es chico; se hacen en la rama del PR #5.

| # | Corrección | Por qué bloquea | Criterio de cierre |
|---|---|---|---|
| 2.1 | La sincronización de la hoja **no pausa nada** si no vio ningún identificador; abre un incidente. | Una hoja vaciada por error deja al bot sin catálogo y diciendo "no tengo". | Sincronizar una hoja con solo el encabezado: 0 pausadas, 1 incidente. |
| 2.2 | Con cuenta de servicio, leer la **pestaña configurada** y todas las columnas (no `A:Z`). | Al pasar a hojas privadas se pierden columnas o se lee la pestaña equivocada. | Misma hoja leída por CSV y por cuenta de servicio da las mismas filas. |
| 2.3 | `media_store` no sube si la inmobiliaria quedó `eliminada`. | La anonimización tiene que ser completa. | Revisado a mano en el código (sin tests nuevos, por regla del proyecto). |
| 2.4 | **El agente se niega a lo que no es inmobiliario.** Desde el 15/1/2026 Meta prohíbe los asistentes de uso general en la API; la atención de un negocio está permitida. | Un uso fuera de rubro pone en riesgo el número. | Escenario del Laboratorio ("escribime un poema", "¿quién gana el partido?") → respuesta corta que vuelve al tema inmobiliario. |

Verificación de la fase: `npm run typecheck`, `npm run lint`, `npm run build` limpios.

---

## Fase 3 — Despliegue del PR #5

Orden estricto. Las migraciones solo agregan columnas y tablas: volver a la imagen anterior es seguro.

1. **Anotar la imagen/tag que corre hoy en Dokploy** (para volver atrás).
2. Crear el bucket **privado** `mensajes-medios` en Supabase Storage.
3. Confirmar `SUPABASE_SECRET_KEY`, `INTEGRATIONS_ENCRYPTION_KEY`, `CRON_SECRET`, `ZERNIO_*`, `OPENROUTER_*` y `ALLOWED_HOSTS=cowin.estudiantehibrido.com` en Dokploy.
4. Aplicar `drizzle/manual_apply_0026.sql` con el rol dueño (0024 y 0025 ya están en la base).
5. Desplegar la rama (o mergear el PR #5 a `main` y desplegar `main`).
6. Verificar:
   - `/api/health` → 200 con `migrations.status = "ok"`.
   - `/api/cron/jobs` con la clave → 200 (sin clave → 401, no 404).
   - Un texto, un audio y una foto de prueba por WhatsApp: el audio aparece transcripto, la foto descripta, y los tres reproducibles desde el CRM.
   - Incidentes nuevos: ninguno inesperado en la primera hora.
7. **Reversión:** si falla cualquier punto del 6, volver a la imagen anotada en 1. No hace falta tocar la base.

**Criterio de cierre:** los cuatro puntos de verificación OK, registrado en el ESTADO con fecha y commit.

---

## Fase 4 — WhatsApp oficial y legal con Meta

| # | Paso | Responsable | Criterio de cierre |
|---|---|---|---|
| 4.1 | **Portfolio comercial de Meta a nombre de Cowin** (no de Koreskill), con al menos dos administradores con verificación en dos pasos. Koreskill entra como socio con permisos, no como dueño. | Cowin | Cowin es propietario del portfolio y del número. |
| 4.2 | **Verificación del negocio** en el portfolio (documentación fiscal de Cowin). Sin ella el límite es de **250** contactos únicos por día para mensajes que inicia el negocio; verificado sube a **2.000** y después escala solo con buena calidad. El límite es **por portfolio**, compartido entre sus números. | Cowin | Portfolio verificado; límite ≥ 2.000 visible en el WhatsApp Manager. |
| 4.3 | **Nombre visible** del número aprobado por Meta y **PIN de verificación en dos pasos** del número cargado y guardado en el gestor de contraseñas de Cowin. | Cowin | Nombre aprobado; PIN guardado. |
| 4.4 | **Política de privacidad y términos** publicados en el dominio de Cowin: qué datos se guardan (conversación, audios, fotos, búsqueda), para qué, cuánto tiempo, que una IA lee y redacta respuestas, y cómo pedir la baja o el borrado. | Cowin + abogado | URLs públicas cargadas en el perfil del negocio. |
| 4.5 | **Permiso (opt-in) para todo mensaje que inicie el negocio** (campañas, novedades de la red). Tiene que nombrar a Cowin y decir que la persona acepta recibir sus mensajes. Fuentes válidas: formulario web, casilla en la ficha `/p/`, o pedido explícito en la conversación. **Responder a quien escribe no requiere opt-in; escribirle en frío sí.** | Cowin define; Koreskill implementa el registro del origen del permiso (etapa 6) | Ninguna campaña se confirma a contactos sin permiso registrado. |
| 4.6 | **Plantillas**: de **utilidad** para avisos a corredores y confirmaciones de visita; de **marketing** para novedades de la red. Texto que cumpla la política (sin promesas engañosas, con opción de baja en las de marketing). | Cowin redacta, Koreskill carga | Plantillas aprobadas en el WhatsApp Manager. |
| 4.7 | **Calidad del número**: revisar cada semana la calificación en el WhatsApp Manager. Si baja a media, pausar campañas hasta entender por qué (bloqueos, reportes). | Cowin | Revisión semanal registrada. |
| 4.8 | **Costos (vigentes desde el 1/10/2026):** los mensajes de servicio (las respuestas del bot dentro de las 24 h) son gratis hasta **1.000 entregados por número y por mes**; desde el 1.001 se cobran. Las respuestas de utilidad dentro de la ventana también se cobran. Las plantillas de marketing y utilidad se cobran por mensaje fuera de una ventana gratuita. Con el volumen medido hoy (~220 salientes/mes) se está dentro del tramo gratuito. | Koreskill | Costo estimado por mes cargado en Reportes; revisión mensual contra la factura. |
| 4.9 | Anuncios Click-to-WhatsApp: abren una **ventana gratuita** más larga que la de 24 h. La duración figura distinta en dos páginas de Meta (72 h y hasta 7 días): **confirmar en la página vigente** antes de planificar campañas con eso. | Koreskill | Duración confirmada y anotada en el ESTADO. |

### Arquitectura de números (decisión abierta, §10)

Ya decidido: el **número comercial de Cowin** se usa para la red, la difusión y los avisos a corredores. Falta decidir cómo entran los leads de cada inmobiliaria:

- **A. Cada inmobiliaria con su propio número y su propio portfolio** (recomendado). El portal muestra el WhatsApp de la inmobiliaria; la calidad y el límite de uno no afectan al otro; la inmobiliaria es dueña de su relación con el cliente.
- **B. Todo por el número de Cowin.** Más simple de operar, pero el límite y la calidad son compartidos: un problema de una inmobiliaria baja a todas. Y el contacto le escribió a "Cowin", no a la inmobiliaria.

---

## Fase 5 — De dónde viene cada conversación (origen, UTM y etiquetas)

**Los UTM no viajan dentro de WhatsApp.** Un enlace `wa.me` pierde los parámetros de la URL en cuanto se abre la app. Lo que se puede saber depende de la puerta de entrada:

| Puerta | Qué llega solo | Qué hay que hacer |
|---|---|---|
| Anuncio Click-to-WhatsApp (Meta) | `referral` con `ctwa_clid`, id del anuncio y título. Ya se guarda en `conversations.metadata.attribution` y se ve en la bandeja. | Nada para detectarlo. A futuro, devolver la conversión a Meta con la API de Conversiones usando `ctwa_clid`. |
| Instagram / Messenger por anuncio o enlace `ig.me` / `m.me` | `ad_id` o el `ref` del enlace. Ya se detecta. | Usar un `ref` distinto por campaña. |
| **Web, ficha `/p/`, QR de carteles, enlaces en bio** | Nada. | **Extender el redireccionador que ya existe** (`/p/[slug]/contacto`, que hoy cuenta clics): recibe los UTM, los guarda del lado del servidor junto a un código corto, y arma `wa.me/<número>?text=Hola, consulto por … [C-ab12]`. La ingesta reconoce el código y fija `lead_source` con sus UTM. Un QR por cartel = un código por cartel. |
| Zonaprop / Argenprop | Nada estructurado: el portal precarga un texto con el título o el aviso. | Detectar el portal por ese texto y la propiedad por su **código de portal cargado en la hoja** (etapa 2). Si no se reconoce, queda "portal sin identificar" para que una persona lo etiquete. |
| KiteProp | Sin verificar. | **Confirmar con KiteProp** si ofrece webhook o API de leads antes de diseñar nada. No asumirlo. |
| Llamada al cartel o boca a boca | Nada. | Pregunta del bot ("¿por dónde nos conociste?") solo si el origen quedó vacío, una vez. |

Modelo (etapa 2): `lead_source` es un eje propio, **distinto del canal** (la persona escribe por WhatsApp, pero vino de Zonaprop), igual que la regla canal ≠ proveedor de CLAUDE.md. Las etiquetas automáticas por origen se aplican solo con evidencia (código, referral o texto del portal) y una persona puede sacarlas.

**Criterio de cierre:** el reporte de Reportes muestra conversaciones por origen; un QR de prueba y un anuncio de prueba llegan con su origen correcto.

---

## Fase 6 — Primeras inmobiliarias en cartera

### Antes de la primera

- **Acuerdo de tratamiento de datos** firmado con cada inmobiliaria: la inmobiliaria es **responsable** de los datos de sus clientes; Koreskill/Cowin es **encargado** (los procesa por cuenta de ella). Incluye que la IA lee las conversaciones, que los audios y fotos se guardan, y qué pasa al darse de baja (exportación + anonimización, ya implementadas).
- **Ley 25.326:** revisar con un abogado si corresponde inscribir la base en el Registro de la AAIP. Las fuentes no coinciden en si una base de clientes de una inmobiliaria está obligada: no se da por resuelto.
- Precio y alcance del servicio escritos (qué incluye, qué no: hoy la red no tiene pantalla, ver abajo).

### Alta de cada inmobiliaria (todo ya existe en el producto)

| # | Paso | Criterio |
|---|---|---|
| 6.1 | Agencia → Nueva inmobiliaria; invitación al admin (enlace de un solo uso). | El admin entra con su email verificado. |
| 6.2 | Propiedades → engranaje → conectar su hoja; **probar** antes de guardar. | Filas importables > 0, columnas obligatorias presentes. |
| 6.3 | Conectar su WhatsApp (arquitectura A) desde su Configuración; la agencia asigna la cuenta en Agencia → Accesos. | Mensaje de prueba entra a SU bandeja, no a otra. |
| 6.4 | Agente en modo **`borrador`** la primera semana; Laboratorio con los escenarios de siempre + el de fuera de rubro (2.4). | Los borradores de 5 días revisados; menos de 1 corrección de fondo cada 10. |
| 6.5 | Pasar a **`auto`**; seguimientos apagados hasta la segunda semana. | Una semana en `auto` sin incidentes de agente. |
| 6.6 | Agenda de visitas cargada. | El bot ofrece horarios reales. |

**La red Cowin todavía no tiene pantalla** (etapa 3). Hasta entonces, compartir propiedades entre inmobiliarias no se ofrece como función vendida.

---

## Fase 7 — Seguridad antes de abrir al público

**Bloquea el lanzamiento:**

1. **Rotar claves**: `SUPABASE_SECRET_KEY`, `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `CRON_SECRET`. La máquina de desarrollo tiene hoy las de producción en `.env.local`. Después de rotar, la máquina de desarrollo no vuelve a tener claves de producción.
2. `ALLOWED_HOSTS` definido (evita que un Host falso apunte los correos de recuperación a otro dominio).
3. **SMTP propio** en Supabase (con el de Supabase los correos de recuperación no salen en producción).
4. **Respaldos**: confirmar el plan de Supabase, la frecuencia de respaldo y si hay recuperación a un punto en el tiempo (PITR). **No evaluado.** Hacer una restauración de prueba de un respaldo a un proyecto aparte.
5. Cuentas con acceso a Dokploy, Supabase, Zernio, Meta y OpenRouter: verificación en dos pasos y solo las personas necesarias.
6. Correcciones de la Fase 2.

**No bloquea, con su motivo** (deuda en el [ESTADO](../ESTADO.md)):

- RLS por inmobiliaria: el aislamiento hoy es del código y fue revisado; es defensa adicional.
- Límites de uso en memoria: hay una sola réplica.
- Delegación sin consentimiento: hoy es solo de administradores; no se ofrece hasta la etapa 3.
- Conexión de canal atada a la inmobiliaria: la agencia asigna cada cuenta a mano, y con pocas inmobiliarias es manejable.

---

## Fase 8 — Autogestión y mejora constante (con lo que ya existe)

Sin sistemas nuevos: una rutina con responsable y lo que ya está construido.

**Diario (Cowin, 10 minutos):**
- Campanita: derivaciones, borradores y mensajes vencidos.
- Agencia → Errores y logs: incidentes nuevos. Con `INCIDENT_ALERT_WEBHOOK_URL` llegan solos por Telegram, Slack o Discord.

**Semanal (Koreskill + Cowin, 30 minutos):**
- Leer 10 conversaciones completas del bot. Que pasen los chequeos no alcanza (CLAUDE.md, Fase 14).
- Configuración → Mejora del agente: aprobar o descartar los reportes del equipo y convertir las correcciones buenas en ejemplos.
- Reportes: mensajes recibidos, respondidos solos, derivados, vencidos, costo medido y sin medir.
- WhatsApp Manager: calidad del número y límite de mensajes.
- Abrir la app WhatsApp Business del teléfono principal (1.2).

**Mensual:**
- Costo real de Meta y OpenRouter contra lo estimado.
- Con unos 100 mensajes reales por categoría: `npm run triage:calibrar` para ajustar los umbrales, que hoy no están calibrados.
- Revisar el ESTADO y reordenar las etapas pendientes.

**Cada cambio de comportamiento del agente:** se guarda con nota (queda versionado), se prueba en el Laboratorio y, si empeora, se restaura la versión anterior desde Mejora del agente.

---

## Fase 9 — Funciones de la visión Cowin

Siguen el orden del [análisis del 16/11, §10](2026-11-16-analisis-chatbot-whatsapp.md). La tabla de qué está hecho y qué falta está en el [ESTADO](../ESTADO.md). Recomendación de orden después del lanzamiento:

1. Etapa 2: origen y portales (Fase 5 de este plan).
2. Etapa 3: red, aviso al corredor y compatibilidad en el bot.
3. Etapa 6: difusión a la base con permiso.
4. Etapas 4 y 5: respuestas con adjuntos y audios grabados.

---

## 10. Decisiones que necesito

1. **Número de cada inmobiliaria:** A (propio, recomendado) o B (todo por Cowin).
2. **Coexistencia o Cloud API puro** para el número de Cowin (1.3).
3. **Instagram:** ¿el bot atiende Instagram? Hoy es el canal con tráfico.
4. **Staging:** ¿plan Pro de Supabase con rama de staging, o proyecto aparte? Sin staging, cada despliegue se prueba en producción.
5. **Quién del equipo de Cowin** es responsable de la rutina diaria y del teléfono principal.

---

## Fuentes

- [Precios de la plataforma de WhatsApp Business (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Cambios de precio de mensajes de servicio y utilidad (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)
- [Límites de mensajes (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [Cómo obtener el opt-in (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [Categorías de plantillas (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [Registro de cambios de WhatsApp (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog)
- [WhatsApp prohíbe los chatbots de uso general (TechCrunch, 18/10/2025)](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)
- [Coexistencia de WhatsApp (Zernio)](https://zernio.com/blog/whatsapp-coexistence)
- [Coexistencia y regla de los 14 días (TimelinesAI)](https://help.timelines.ai/en/articles/14337362-whatsapp-coexistence-using-your-whatsapp-business-app-number-with-timelinesai-waba)
- [Derechos y datos personales (AAIP)](https://www.argentina.gob.ar/aaip/datospersonales/derechos)
- OpenAPI de Zernio 1.62.0 en el repo (`openapi/zernio.slim.json`): Embedded Signup con modo `business_app` (coexistencia) o `api`, y `ctwa_clid` para la API de Conversiones.
