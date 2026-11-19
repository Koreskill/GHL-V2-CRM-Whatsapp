# Auditoría y plan: chatbot de WhatsApp, captación y automatizaciones

Fecha: 16 de noviembre de 2026. Proyecto: **Setter CRM** (`GHL`), rama `feat/operacion-campanas-seguimientos`, commit `14c5fa1`.
Insumos: código actual, [informe Xenda del 22/10](2026-10-22-analisis-xenda/INFORME.md), [registro del 20/10](2026-10-20-registro-implementacion.md) y los dos documentos de conocimiento de WhatsApp (`02-Servicio-kore/conocimiento/WhatsApp/README.md` y `N8N-FUNCIONALIDADES-Y-LIMITES-IA.md`).

**Alcance de este documento: análisis y pasos a desarrollar.** El análisis original no modificó código ni ejecutó pruebas con base, envíos reales ni llamadas a modelos.

**Actualización del 16/11/2026:** se desarrolló la **Fase 1** (ver [2026-11-16-checklist-etapa-1.md](2026-11-16-checklist-etapa-1.md)). Decisiones tomadas: (1) se arranca **sin staging de Supabase**; (2) las propiedades que **no están en la base se buscan en la web** (respaldo de la Fase 2); (3) las campañas en frío usarán un **número comercial de Cowin** y por ahora solo se implementa la lógica (Fase 6). El hallazgo 1 (audios e imágenes sin respuesta) y la espera configurable antes de responder quedaron resueltos por la Fase 1 (esta última sin tope de espera total). El indicador "escribiendo…" visible para el cliente NO se hizo: sigue en la Fase 4. El resto del documento sigue vigente.

---

## 1. Resumen

El núcleo del bot está bien resuelto: clasifica con un modelo, enruta con código, busca en el catálogo, redacta con datos verificados, valida contra invenciones, deriva a una persona y lleva un perfil incremental del contacto con evidencia. Eso cubre la mayor parte de lo que describe el documento de n8n, y en varios puntos lo supera (idempotencia, validador, cola persistente, aislamiento por inmobiliaria).

Para que quede **funcional de punta a punta para el objetivo del negocio** faltan cuatro bloques grandes:

1. **El bot es solo de texto.** No entiende audios ni fotos que manda el cliente (hoy los ignora sin avisar a nadie), no manda imágenes, audios, botones ni listas, aunque Zernio ya los soporta.
2. **El bot solo ve la cartera propia.** Las propiedades de la red se puntúan para el panel del asesor, pero el bot nunca las ofrece ni avisa al corredor dueño.
3. **No existe "el corredor encargado de la propiedad".** Las propiedades no tienen responsable, y no hay un aviso real (WhatsApp o email) a nadie: solo la campanita interna.
4. **No hay entrada específica para portales ni para el contenido por propiedad** (audios, textos fijos), ni campañas con imagen.

Y antes de todo eso hay un bloque operativo pendiente: **la versión de producción es anterior a esta rama, el PR #5 sigue abierto y las pruebas con base nunca se corrieron** porque no hay staging.

---

## 2. Estado del proyecto hoy

| Tema | Estado | Detalle |
|---|---|---|
| Rama y PR | Abierto | PR #5 sin mergear. Último commit `14c5fa1` (script de migraciones). `docs/2026-10-22-analisis-xenda/` sin commitear. |
| Producción | Desactualizada | El recorrido del 21/10 confirmó 404 en `/seguimientos`, `/contactos/duplicados`, `/contactos/organizar`, `/configuracion/agente` y `/propiedades/fuente`. |
| Migraciones | Aplicadas | 0024 y 0025 registradas en producción (confirmado el 21/10). |
| Staging | No existe | La creación falló con `Forbidden`: la organización de Supabase está en plan gratuito y excedida de uso. |
| Pruebas con base | Nunca corridas | `test:db`, `test:e2e`, `eval` y `test-operacion-db.ts` están escritas pero sin ejecutar. Solo `npm test` pasa. |
| Integraciones reales | Sin validar | Campañas con Zernio, `usage.cost` de OpenRouter, sincronización de hojas reales, primeras respuestas con tráfico real. |
| Incidencias vistas en producción | Abiertas | Mensajes entrantes repetidos en un mismo hilo (30/09), acuses de respaldo repetidos, 3 incidentes sin resolver (uno con 24 ocurrencias). |

**Conclusión:** cualquier funcionalidad nueva se apoya sobre una base que todavía no está probada en un entorno real. El paso 0 del plan (sección 10) es cerrar eso.

---

## 3. Lo que piden los documentos, contra lo que hay

Leyenda: **Hecho** (implementado y conectado), **Parcial**, **Falta**, **No aplica** (no conviene o el canal no lo permite).

### 3.1 Conversación y canal

| Funcionalidad | Estado | Qué hay y qué falta |
|---|---|---|
| Recibir por webhook, deduplicar, filtrar entrante/saliente y por número | Hecho | `webhook_events`, `message_triage.message_id` único, `jobs.dedupe_key`, cuenta por organización. |
| Interruptor del bot por conversación | Hecho | `conversations.ai_enabled` + `agent_configs.enabled`. Se revalida justo antes de enviar (`run.ts`). |
| Agrupar ráfagas de mensajes | Parcial | Espera fija de 5 s (`TRIAGE_BATCH_MS`) y corte si llegó otro mensaje (`superseded`). Falta una ventana por silencio configurable, con tope, y que espere la transcripción de un audio antes de responder. |
| Indicador "escribiendo…" visible para el cliente | Falta | Hoy solo se ve dentro del CRM. El OpenAPI de Zernio que tenemos (1.62.0) no trae el endpoint; el documento indica que Zernio ya publica `POST /v1/inbox/conversations/{id}/typing`. Hay que **actualizar el OpenAPI** y la afirmación de `CLAUDE.md`, que quedó vieja. |
| Responder citando un mensaje | Falta | Zernio acepta `replyTo`. Útil cuando el cliente manda varias preguntas. Prioridad baja. |
| Dividir la respuesta en varios mensajes | Falta | Hoy sale un solo mensaje (texto + fichas). El documento recomienda cortar con código, no con un modelo, para no perder montos. |
| Botones y listas | Falta | Zernio soporta `quickReplies` (hasta 13), `buttons` (hasta 3) e `interactive` (listas, CTA, carrusel). `deliverMessage` solo manda texto y plantilla. |
| Ventana de 24 h, plantillas fuera de ventana | Hecho | `window.ts`, decidido por el servidor. |

### 3.2 Medios

| Funcionalidad | Estado | Qué hay y qué falta |
|---|---|---|
| **Audio entrante** | **Falta (crítico)** | La ingesta guarda el tipo (`ingest.ts:145`) pero el triaje corta con `empty_message` cuando no hay texto (`run.ts:335-336`). **Un audio de un lead no recibe respuesta, no se deriva y no aparece en la campanita.** Zernio entrega la URL del adjunto en el webhook, así que se puede descargar y transcribir. |
| **Imagen entrante** | **Falta (crítico)** | Mismo corte. Una foto de un cartel o una captura de un portal queda sin respuesta. |
| Ver adjuntos dentro del CRM | Falta | La burbuja muestra `[audio]` o `[image]` (`chat-view.tsx`). El asesor no puede escuchar ni ver lo que mandó el cliente. |
| Imagen saliente | Falta | Las fichas salen como texto con enlaces. Zernio acepta `attachmentUrl` + `attachmentType`. |
| Nota de voz saliente | Falta | Zernio acepta `voiceNote: true` con Ogg/Opus mono. Requiere conversión y validación del archivo. |
| Documento saliente (PDF de ficha) | Falta | Mismo mecanismo de adjuntos. Prioridad media. |
| Biblioteca de medios aprobados | Falta | Ver sección 6.2. |

### 3.3 Inteligencia y datos

| Funcionalidad | Estado | Qué hay y qué falta |
|---|---|---|
| Separar quién clasifica, quién redacta y quién decide | Hecho | Jev clasifica, la tabla de rutas decide, GPT redacta, el validador revisa. Es exactamente la "regla de diseño" del documento n8n. |
| Buscar en el inventario sin inventar | Hecho | `catalog-search.ts`, `retrieval.ts`, `guard.ts`, fichas armadas por código. |
| Ficha incremental con evidencia | Hecho | `prospect_requirements` + `criteria` (origen, mensaje, confianza, bloqueo manual). Un dato ausente no borra el anterior. |
| Memoria de la conversación | Hecho | Historial por conversación (12 mensajes) + perfil persistido. No depende de "los últimos 7 mensajes" como el ejemplo de n8n. |
| Etiquetas múltiples del CRM | Hecho | `contact_labels` (migración 0024). Etiquetas nativas de WhatsApp Business: **no aplica** (no hay API oficial). |
| Etiquetado automático por origen y propiedad | Falta | Las etiquetas existen pero el bot no las aplica (origen, propiedad consultada, cartera o red). |
| Mascotas y "2 ambientes" en la búsqueda del bot | Parcial | Ya señalado en el informe Xenda: se extraen pero la búsqueda que responde no los usa. |
| Búsqueda en el texto de los mensajes | Falta | La bandeja busca por nombre, teléfono y usuario. No por contenido. |
| Derivación humana | Parcial | Pausa la IA y aparece en la campanita. Falta: aviso por WhatsApp o email, estados `pendiente / asignado / atendido`, vencimiento y escalamiento, y cancelar trabajos pendientes del hilo. |

### 3.4 Reglas del canal que cambian el diseño

- **Precios (vigentes desde el 1/10/2026):** se cobra por mensaje entregado según categoría; hay 1.000 mensajes de servicio gratis por número y por mes, y se cobra desde el 1.001. El bot y los avisos a corredores consumen esa franquicia. Hay que medirlo por inmobiliaria.
- **IA en el canal (términos, sección 4.7):** un asistente acotado al negocio inmobiliario es uso incidental. No hay que ofrecerlo como "ChatGPT por WhatsApp".
- **Campañas en frío:** ver sección 6.1. Es el punto con más riesgo para la cuenta.

---

## 4. Hallazgos críticos (corregir primero)

1. **Audios e imágenes entrantes quedan sin respuesta y sin aviso.** Es el problema de mayor impacto: en WhatsApp inmobiliario el audio es habitual. Corrección mínima, antes de transcribir: si el mensaje no tiene texto, derivarlo a la campanita como "mandó un audio/imagen" en vez de descartarlo en silencio.
2. **El bot nunca ofrece propiedades de la red.** `loadOfferableCatalog` lee solo `properties` de la propia organización. El motor de compatibilidad sí incluye la red (`scoring/candidates.ts`), pero solo alimenta el panel del asesor.
3. **"Notificar al dueño" en la red es solo una marca de fecha.** `requestVisit` en `presentations/queries.ts` escribe `owner_notified_at` sin mandar nada a nadie.
4. **Las plantillas con imagen no se pueden enviar.** `deliverMessage` arma los componentes solo con el cuerpo (`deliver.ts:111`). Una plantilla de marketing con encabezado de imagen necesita el parámetro de media en el envío. Esto bloquea las campañas con imagen.
5. **Mensajes repetidos en producción** sin explicar (30/09). Hay que confirmar en staging si fue reintento del webhook o envíos reales del cliente, antes de sumar más automatizaciones.

---

## 5. El objetivo del negocio, paso por paso

El recorrido que querés:

```
Llega la consulta (anuncio de Instagram o portal)
  → el sistema entiende qué propiedad es y si está en la cartera o en la red
  → etiqueta a la persona
  → responde (texto, fotos, audio, botones)
  → calcula la compatibilidad con otras propiedades
  → en el momento configurado, avisa al corredor encargado
```

### 5.1 Entender de dónde viene la consulta

**Anuncios de Instagram y Facebook.** Ya se guarda el `ad_id`, el título del anuncio y el `ref` (migración 0025). Falta **atar el anuncio a una propiedad**:

- Tabla `ad_property_links` (organización, `ad_id` o `ref`, propiedad o búsqueda guardada). El admin la carga desde la ficha de la propiedad o desde una pantalla de "Anuncios" que liste los `ad_id` que llegaron sin asignar.
- Si no hay vínculo, pasar el título y el texto del anuncio por la misma búsqueda por referencia que ya existe (`retrieval.ts`, modo `referencia`).
- Con eso, la primera respuesta ya sabe de qué propiedad habla.

**Portales (Zonaprop, Argenprop, MercadoLibre).** Las consultas de portales llegan de dos formas: un WhatsApp con el enlace o código del aviso, o un email de notificación del portal. Propuesta, en este orden:

1. **Código del portal en la propiedad (recomendado, sin scraping).** Agregar a la hoja columnas por portal (`codigo_zonaprop`, `codigo_argenprop`, `mlid`) y guardarlas en `properties` (o una tabla `property_portal_ids`). Detectar en el mensaje el enlace o el código y resolver la propiedad por ese id. Es determinista, gratis e instantáneo.
2. **Lectura de la página del portal (Firecrawl o similar) solo como respaldo**, cuando el enlace no coincide con ningún código cargado. Extraer tipo, operación, zona, precio, superficie y ambientes, y con eso:
   - buscar coincidencia en la cartera y en la red (mismo motor de referencia, con umbral);
   - si no coincide, usar esos datos como **criterios de búsqueda** para ofrecer similares.
   Riesgos: costo por lectura, demora (corre dentro de la cola, no en el webhook), términos de uso de cada portal y cambios de diseño de las páginas. Guardar el resultado en caché por URL.
3. **Email de leads del portal** (fase posterior): un buzón que reciba las notificaciones y cree el contacto y la consulta. Es otra vía de entrada, no de WhatsApp.

**Origen como dato propio.** Guardar `lead_source` (`instagram_ads`, `facebook_ads`, `zonaprop`, `argenprop`, `mercadolibre`, `web`, `directo`) separado del canal (WhatsApp, Instagram DM). Es la base del reporte de conversión por origen que ya pedía el informe Xenda.

### 5.2 Determinar tipo de propiedad y si es cartera o red

- Unificar en un solo resolvedor: **resolver la propiedad** (por anuncio, código de portal, enlace o texto) devuelve `{ propiedad, alcance: "cartera" | "red", inmobiliaria_dueña, confianza }`.
- La red ya tiene las piezas: `network_property_listings` (con `owner_organization_id`) y `property_presentations`. El bot tiene que poder **ofrecer propiedades de la red publicadas**, con estas reglas:
  - Solo `publicada` y de otra inmobiliaria (la regla de `candidates.ts`).
  - Las fichas de red muestran solo campos comerciales (la misma regla de la ficha pública).
  - Mostrar una propiedad de red **crea una presentación** (`property_presentations`), para que la colaboración quede registrada.
- El tipo de propiedad sale del dato resuelto, no de lo que diga el modelo.

### 5.3 Etiquetado de la persona

Hoy se completa el perfil (qué busca) y la temperatura. Falta aplicar **etiquetas automáticas** con reglas de código, no por el modelo:

- `Origen: <portal o anuncio>` al recibir el primer mensaje.
- `Consultó: <propiedad>` y `Cartera` o `Red` al resolver la propiedad.
- `Pidió visita`, `Hizo oferta`, `Propietario`, `Tasación` según la ruta.
- Cada etiqueta automática lleva el mensaje que la originó, igual que los criterios del perfil. Una persona puede sacarla y el bot no la vuelve a poner.

### 5.4 Aviso al corredor encargado (configurable)

**Falta el dato base:** las propiedades no tienen responsable. Pasos:

1. **Responsable por propiedad.** Columna `responsible_user_id` en `properties` (y columna en la hoja: `email_asesor`). Para la red, el responsable es el que defina la inmobiliaria dueña, o su contacto general.
2. **Teléfono del corredor.** Guardar el WhatsApp de cada miembro en `organization_members` (con su consentimiento para recibir avisos).
3. **Reglas de aviso por inmobiliaria** (`notification_rules`): cuándo avisar, a quién y por dónde. Disparadores sugeridos:
   - pidió visita a una propiedad concreta;
   - hizo una oferta;
   - compatibilidad mayor a X % con una propiedad de su cartera;
   - pidió hablar con una persona o fue derivado;
   - X mensajes sin respuesta humana después de una derivación.
4. **Canal del aviso**, en orden de preferencia:
   - **WhatsApp desde el número de la inmobiliaria al corredor**, con una **plantilla de utilidad aprobada** ("Nuevo lead para {{propiedad}}: {{resumen}}. Ver: {{enlace}}"). Fuera de la ventana de 24 h no hay otra forma.
   - Email como respaldo si el WhatsApp falla.
   - Campanita, siempre.
5. **Detalle importante:** si el corredor responde al aviso desde su WhatsApp, ese mensaje entra a la bandeja como un contacto más y **el bot le contestaría**. Hay que marcar los números del equipo como internos: la ingesta los reconoce, no dispara el triaje y no los cuenta como leads.
6. **Red:** el aviso al corredor de otra inmobiliaria pasa por la presentación (`owner_notified_at` tiene que corresponder a un aviso realmente enviado, con su resultado).
7. Registrar cada aviso (`notifications`: regla, destinatario, canal, estado de entrega, mensaje de origen). Un aviso fallido queda visible y reintentable.

### 5.5 Compatibilidad entre la persona y la propiedad

**Qué hay:** `lib/scoring/` calcula un puntaje por conversación y propiedad (cartera disponible o reservada, y red publicada de otra inmobiliaria). La IA solo extrae preferencias; la fórmula es código (`score.ts`, pesos en `config.ts`). Se recalcula cuando cambia el perfil y guarda historial. Se muestra en el panel de recomendaciones del asesor.

**Qué falta:**

- **El bot no usa el puntaje.** Busca con su propio filtro (`catalog-search.ts`), más acotado que el puntaje (sin mascotas, sin ambientes, sin red). Hay dos motores con criterios distintos. Propuesta: que la búsqueda del bot tome los candidatos del motor de compatibilidad (con un umbral, por ejemplo 70 %) y conserve sus reglas duras (operación, moneda, disponibilidad). Un solo criterio para el bot y para el asesor.
- **Mostrar el porcentaje con su explicación** en la ficha de la conversación, en el pipeline y en el aviso al corredor ("82 % compatible: coincide zona y presupuesto; falta saber si acepta mascotas").
- **Calibrar los pesos** con casos reales cuando haya volumen. Hoy son valores de partida.
- **Disparar avisos y seguimientos por compatibilidad** (5.4): "entró una propiedad 85 % compatible con este lead" es el aviso con más valor comercial.

---

## 6. Módulos nuevos pedidos

### 6.1 Campañas en frío con imagen y texto

**Antes que nada, el riesgo.** La política de WhatsApp exige que la persona haya dado su número y su permiso. Escribir por la API oficial a una base sin permiso (números de Google Maps, compras de bases, scraping) puede terminar en la **restricción o baja del número**, que es el mismo número que usa el bot. Pagar la plantilla no compra el permiso. El plan V2 de prospección (`herramientas/prospeccion/PLAN-V2-WHATSAPP-ZERNIO.md`) llega a la misma conclusión.

Por eso propongo armar el módulo así:

1. **Origen y permiso de cada contacto obligatorios.** Al importar, el contacto lleva `consent_source` (formulario, portal, conversación previa, evento, importado sin permiso). El sistema no deja confirmar una campaña de WhatsApp a contactos sin permiso registrado.
2. **Número separado para prospección**, distinto del número del bot. Si se restringe, la atención no se cae.
3. **Plantilla de marketing aprobada con encabezado de imagen.** Hay que extender `deliverMessage` para mandar componentes de encabezado (imagen) y no solo cuerpo (hallazgo 4). La imagen se sube una vez y se reutiliza.
4. **Pantalla "Automatizaciones"** que reúna lo que hoy está repartido:
   - Campañas (hoy en Contactos → Campañas).
   - Seguimientos (hoy en `/seguimientos`).
   - Campañas de prospección: audiencia (grupo, etiqueta o segmento), plantilla con imagen, envío en tandas con horarios y topes diarios, pausa automática si sube la tasa de bloqueos o bajas, corte al responder y paso a la bandeja.
5. **Medición:** aceptado, entregado, leído, respondido, baja, y costo estimado por categoría.
6. **El motor de prospección por navegador (KoreBridge)** queda fuera del CRM. El documento lo marca como no oficial y sin contrato con Meta. Si se decide mantenerlo para un caso puntual, debe usar otro número y no compartir la cola ni el bot.

### 6.2 Contenido por propiedad: audios y textos fijos

**Qué es:** una sección donde la inmobiliaria carga, por propiedad (o por tipo de consulta), audios de respuesta y textos fijos que el bot envía en momentos definidos.

**Modelo de datos (nuevo):**

- `property_assets`: organización, propiedad (o `null` para un contenido general), tipo (`audio`, `texto`, `imagen`, `documento`), momento de uso (`primer_contacto`, `pide_ficha`, `pide_fotos`, `pide_visita`, `fuera_de_horario`), archivo (ruta en Storage, SHA-256, MIME y duración reales), texto, versión, estado (`borrador`, `aprobado`, `pausado`), aprobado por y fecha.

**Reglas:**

- **Texto fijo:** sale tal cual, sin pasar por el modelo. Variables solo del sistema (`{{nombre}}`, `{{propiedad}}`). El validador igual lo revisa contra el catálogo (un texto viejo con un precio que cambió no debe salir).
- **Audio:** el admin sube el archivo; el servidor lo convierte a Ogg/Opus mono y valida códec, tamaño (máximo 16 MB, recomendado menos de 512 KB) y duración. Se manda con `voiceNote: true`. La imagen Docker de Dokploy necesita `ffmpeg`.
- **Almacenamiento:** Supabase Storage, bucket privado, subida desde el servidor (la regla del proyecto es no tener cliente de Supabase en el navegador). Zernio necesita una URL: usar una URL firmada con vencimiento corto.
- **Cómo lo usa el bot:** la ruta (`ficha_propiedad`, `coordinar_visita`, etc.) más la propiedad resuelta eligen el contenido aprobado. El modelo no elige archivos ni rutas: recibe "hay un audio aprobado para esta propiedad en este momento" y el código lo adjunta, igual que las fichas.
- **Registro:** cada envío guarda qué versión salió, a quién y su estado de entrega.

**Pantalla:** en la ficha de cada propiedad, una pestaña "Contenido del bot" con la lista de audios y textos, vista previa (reproductor), momento de uso y estado. Y una página general en Configuración para el contenido que no depende de una propiedad.

---

## 7. Diseño y prolijidad

| Pantalla | Problema | Propuesta |
|---|---|---|
| Conversación | Los adjuntos se ven como `[audio]` o `[image]`. | Reproductor de audio, miniatura de imagen, documento descargable. La transcripción del audio debajo, marcada como "transcripción automática". |
| Conversación | La información del lead está repartida (perfil, triaje, recomendaciones, anuncio). | Panel lateral único "Consulta": origen, propiedad consultada (cartera o red), perfil, compatibilidad, responsable, estado y próxima acción. |
| Lista de conversaciones | Solo muestra el último mensaje. | Columnas de intención, origen, responsable y estado; filtros "Mías", "Sin asignar", "Derivadas". |
| Configuración | Ocho pestañas horizontales y un formulario de agente muy largo. | Agrupar: **Canales** (cuentas), **Agente** (por canal, con subsecciones plegables: comportamiento, primeras respuestas, umbrales), **Contenido del bot**, **Avisos al equipo**, **Marca**, **Calendario**, **Pipeline**. |
| Automatizaciones | Campañas dentro de Contactos y Seguimientos aparte. | Una entrada "Automatizaciones" en OPERACIONES con Campañas, Seguimientos y Prospección. |
| Propiedades | No muestra responsable ni si tiene contenido para el bot. | Columna de responsable y un indicador de "audio/texto cargado". |
| Pipeline | Oportunidades "Sin asignar" y sin valor (visto en producción). | Asignación automática por la regla de responsable de la propiedad. |
| Textos de la interfaz | Mezcla de tú y vos ("Escribe un mensaje…", "Selecciona" con "Probalo", "Escribí"). | Definir una sola forma y aplicarla en todas las pantallas. |
| Celular | No validado. Las inmobiliarias trabajan desde el teléfono. | Revisar bandeja, conversación y campanita en pantalla chica antes de vender. |

Todo esto dentro del sistema visual ya definido en `CLAUDE.md`: no rediseñar, reordenar.

---

## 8. Optimización y deuda técnica

- **Un solo camino de salida, con más tipos.** Extender `deliverMessage` a: texto, plantilla con encabezado, adjunto (imagen, audio, nota de voz, documento), botones y listas. Sigue siendo la única función que envía y persiste.
- **Cola de trabajos para medios.** Transcripción, descripción de imagen y lectura de portales corren como `jobs` con reintento, no en el webhook.
- **Ventana de agrupación por silencio**, configurable por inmobiliaria, con tope máximo.
- **Unificar búsqueda del bot y compatibilidad** (5.5).
- **Actualizar el OpenAPI de Zernio** y regenerar tipos. Corregir en `CLAUDE.md` la nota de que Zernio no expone "escribiendo…".
- **Costos:** registrar mensajes entregados por categoría y número, contra la franquicia de 1.000 mensajes de servicio, además del costo de IA ya registrado.
- **Búsqueda en mensajes:** índice de texto en Postgres (`tsvector`) sobre `messages.body` y las transcripciones, filtrado por organización.
- **Pendientes del registro del 20/10** que siguen vigentes: limitador en memoria (bloquea una segunda réplica), RLS por tenant, `getClaims()` en el proxy, paginación de la bandeja.
- **`CLAUDE.md`** supera las 400 líneas. Conviene separar las reglas permanentes de la historia de cada fase, para que se lea entero.

---

## 9. Lo que no conviene hacer

- **Etiquetas nativas de WhatsApp Business:** no hay API oficial. Las etiquetas del CRM alcanzan.
- **Indicador "grabando audio…":** no está documentado en la API oficial.
- **Borrar o editar mensajes enviados por Zernio en WhatsApp:** el endpoint de Zernio lo rechaza para WhatsApp.
- **Dividir respuestas con un modelo:** puede perder montos o negaciones. Hacerlo con código.
- **Dejar que el modelo elija archivos, URLs o destinatarios:** siempre resueltos por código desde la propiedad y la conversación.
- **Campañas frías desde el número del bot.**

---

## 10. Plan por fases

Tamaños relativos: **S** (días), **M** (una a dos semanas), **L** (más de dos semanas). Cada fase cierra con `typecheck`, `lint`, `build` y sus pruebas.

### Fase 0: base probada (bloquea todo lo demás)

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| Resolver el plan de Supabase y crear staging | S | Proyecto de staging con migraciones 0000–0025. |
| Correr `test:db`, `test:e2e` y `eval` en staging | S | Todo en verde, o corregido. |
| Explicar los mensajes repetidos del 30/09 | S | Causa identificada y prueba que la reproduzca. |
| Mergear y desplegar el PR #5 | S | `/api/health` 200, rutas nuevas sin 404. |

### Fase 1: que ningún mensaje quede sin atender

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| Audios e imágenes sin texto pasan a la campanita en vez de descartarse | S | Un audio de prueba aparece en la campanita con el motivo. |
| Mostrar adjuntos en la conversación | S | Se escucha el audio y se ve la imagen desde el CRM. |
| Transcribir audios entrantes y usar la transcripción en el triaje | M | Un audio "busco 2 ambientes en Centro" obtiene la misma respuesta que el texto. La transcripción queda guardada aparte del original. |
| Describir imágenes entrantes (captura de portal, cartel) | M | Una captura de un aviso se resuelve a la propiedad o a criterios de búsqueda. |
| Agrupación por silencio configurable | S | Ráfaga de 4 mensajes: una sola respuesta. |

### Fase 2: entender la consulta y de dónde viene

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| `lead_source` separado del canal | S | Cada conversación tiene origen. |
| Vínculo anuncio → propiedad (`ad_property_links`) y pantalla de anuncios sin asignar | M | Un click en un anuncio vinculado responde por esa propiedad. |
| Códigos de portal en la hoja y en `properties`; detección en el mensaje | M | Un enlace de Zonaprop de una propiedad propia se resuelve sin leer la página. |
| Lectura de página de portal como respaldo (con caché) | M | Un enlace desconocido devuelve criterios o una coincidencia con confianza; nunca inventa la propiedad. |
| Resolvedor único: propiedad + cartera o red | M | Prueba con una propiedad propia y una de red. |
| Etiquetas automáticas por origen, propiedad y ruta | S | Se aplican con evidencia y una persona puede quitarlas. |

### Fase 3: red, compatibilidad y corredor

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| El bot ofrece propiedades de red publicadas, con presentación registrada | M | Mostrar una de red crea su presentación. |
| La búsqueda del bot usa los candidatos del motor de compatibilidad | M | "2 ambientes con perro" solo muestra coincidencias verificadas, o dice qué dato falta. |
| Porcentaje con explicación en conversación, pipeline y avisos | S | Visible en las tres pantallas. |
| Responsable por propiedad y WhatsApp de cada miembro | S | Columna en la hoja y en la ficha. |
| Reglas de aviso configurables (`notification_rules`) | M | La inmobiliaria elige disparadores y canal. |
| Aviso por WhatsApp con plantilla de utilidad + email de respaldo | M | El corredor recibe el aviso; un fallo queda reintentable. |
| Números del equipo marcados como internos | S | El bot no le contesta a un corredor. |
| Asignación automática del lead al responsable | S | La oportunidad nace asignada. |

### Fase 4: respuestas más ricas

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| `deliverMessage` con adjuntos, botones y listas | M | Un solo camino de salida para todos los tipos. |
| Fichas con foto de portada en lugar de solo enlace | S | La primera ficha llega con imagen y pie. |
| Botones "Ver fotos / Agendar visita / Otra zona" | M | Cada botón dispara su ruta con la propiedad correcta. |
| "Escribiendo…" visible para el cliente (OpenAPI actualizado) | S | Se ve desde un teléfono de prueba; si falla, la respuesta sale igual. |
| División de respuestas por código | S | Montos y negaciones intactos. |

### Fase 5: contenido por propiedad

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| `property_assets` + Storage privado + conversión de audio | M | Un audio subido se valida como Ogg/Opus mono. |
| Pantalla "Contenido del bot" en la ficha y en Configuración | M | Carga, vista previa, momento de uso, aprobación. |
| El bot adjunta el contenido aprobado según ruta y propiedad | M | Pedir la ficha de una propiedad con audio cargado manda el audio como nota de voz. |

### Fase 6: automatizaciones y prospección

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| Plantillas con encabezado de imagen en `deliverMessage` | S | Una plantilla de marketing con imagen se envía. |
| Origen del permiso por contacto y bloqueo de campañas sin permiso | S | No se puede confirmar una campaña a contactos sin permiso. |
| Sección "Automatizaciones" (Campañas, Seguimientos, Prospección) | M | Una sola entrada en el menú. |
| Campañas de prospección con número separado, tandas, topes y pausa automática | L | Campaña de prueba con 3 números propios: aceptado, entregado, leído. |

### Fase 7: diseño, medición y escala

| Paso | Tamaño | Criterio de cierre |
|---|---|---|
| Panel "Consulta" en la conversación | M | Toda la información del lead en un solo lugar. |
| Bandeja con "Mías", "Sin asignar", intención y origen | M | Filtros funcionando. |
| Reorganizar Configuración | S | Menos pestañas, secciones plegables. |
| Reportes por asesor y por origen | M | Tiempos y conversión con denominadores claros. |
| Búsqueda en el texto de los mensajes y transcripciones | S | Encuentra "mascota" dentro de una conversación. |
| Revisión en celular | S | Bandeja y conversación usables en pantalla chica. |
| Costos de mensajería por número y categoría | S | Se ve el consumo de la franquicia de 1.000. |

---

## 11. Decisiones que necesito de vos

1. **Supabase:** subir la organización a Pro (recomendado, ver conversación del 21/10) o crear staging en otra organización.
2. **Portales:** ¿cargar los códigos de portal en la hoja (sin scraping) o depender de leer las páginas? Recomiendo códigos primero.
3. **Aviso al corredor:** ¿WhatsApp desde el número de la inmobiliaria (requiere plantilla aprobada y que el corredor acepte), email, o ambos?
4. **Disparadores del aviso** que querés por defecto (visita, oferta, compatibilidad alta, derivación).
5. **Campañas en frío:** confirmar que vas a usar un número separado y que los contactos tienen permiso registrado. Sin eso no recomiendo construir el módulo de prospección dentro del CRM.
6. **Audios:** ¿grabados por la inmobiliaria o generados con voz sintética? El plan asume grabados.
7. **Proveedor de transcripción y visión:** usar OpenRouter (mismo registro de costos) o un servicio aparte.

---

## 12. Qué no se verificó en este análisis

- No se corrieron pruebas con base, modelos ni envíos reales.
- No se verificó que Zernio ya publique el endpoint de "escribiendo…"; lo indica el documento de conocimiento, pero nuestro OpenAPI local (1.62.0) no lo tiene.
- No se revisó el código del motor de prospección por navegador más allá de su plan V2.
- Los tamaños de cada paso son estimaciones relativas, no un presupuesto.
- Las referencias a líneas de código corresponden al commit `14c5fa1`.
