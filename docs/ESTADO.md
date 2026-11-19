# Estado — Setter CRM (GHL)

Estado vivo del proyecto: un solo documento, se actualiza al cerrar cada tarea. Las reglas técnicas viven en [CLAUDE.md](../CLAUDE.md); los análisis largos, en [historial/](historial/).

Última actualización: 2026-11-19 · Rama `feat/operacion-campanas-seguimientos` · PR #5 sin mergear.

## Producción hoy (revisado 2026-11-19)

`https://cowin.estudiantehibrido.com` corre **`main` (03112ab, catálogo #3)**: nada del PR #5 está desplegado (`/api/cron/jobs` da 404 y `/api/health` no informa migraciones). La base, en cambio, ya tiene las tablas de 0024/0025 (`jobs`, etiquetas, seguimientos) y **no** la 0026 (`message_derivations`). Datos de los últimos 30 días, solo conteos:

- **La cuenta de WhatsApp está desconectada desde el 5/11**, por `coexistence disconnected: PRIMARY_INACTIVITY`: la app WhatsApp Business del teléfono principal pasó unos 14 días sin abrirse. Solo Instagram está conectado: 94 conversaciones activas por Instagram y 0 por WhatsApp.
- **El bot no contestó nada en 30 días:** 0 triajes y 0 llamadas a la IA. El agente de WhatsApp está prendido pero sin cuenta, y el de Instagram está apagado. Las 222 respuestas salieron a mano.
- 23 mensajes entrantes traían adjuntos (audio o foto). El código desplegado no los lee.
- Catálogo: 119 propiedades desde la hoja (75 disponibles, 44 pausadas); 118 con enlace, 76 con portada y 24 con video.
- **Red Cowin: 0 redes, 0 miembros y 0 propiedades compartidas.**
- **Agenda de visitas:** ni agenda interna ni Cal.com configuradas.
- **Perfil de los contactos:** 2 de 223 tienen requisitos o temperatura, y hay puntajes de compatibilidad en solo 2 conversaciones.
- Anuncios: 8 conversaciones de Instagram traen el anuncio de origen.
- 4 incidentes abiertos: agente 2, mensajería 1, hoja 1.

Prioridad antes de cualquier función nueva: reconectar WhatsApp, decidir si el agente atiende Instagram, desplegar el PR #5 y aplicar la 0026.

## Visión Cowin: objetivo del chat a futuro

Lo que tiene que hacer el agente (pedido del 2026-11-19), contra lo que existe:

| Pide | Estado |
|---|---|
| Conocimiento de cada inmobiliaria: propiedades, estados, características, links y multimedia | **Hecho** (hoja → catálogo; el bot lo consulta y arma las fichas por código) |
| Días disponibles para visitas | Hecho en código (agenda interna o Cal.com), **sin configurar** en producción |
| Conocimiento de la red: propiedades compartidas | Modelo de datos listo, **sin pantalla ni datos** (auditoría H-01 a H-03; etapa 3) |
| WhatsApp del corredor a cargo de cada propiedad, y avisarle | **Falta** (etapa 3: responsable por propiedad, reglas de aviso, plantilla de utilidad) |
| Entradas de Zonaprop, Argenprop, KiteProp y carteles | **Falta** el origen (`lead_source`) y el reconocimiento por código o enlace de portal (etapa 2). Los anuncios de Meta ya se detectan |
| Etiquetar canal de contacto, interés y % de compatibilidad | Interés y compatibilidad **hechos** (se ven en la bandeja). Falta el origen por portal o cartel (etapa 2) |
| Responder a texto y voz | Hecho en el PR #5 (transcripción y lectura de imágenes), **no desplegado** |
| Enviar audios grabados por el equipo | **Falta** (etapa 5: contenido por propiedad) |
| Enviar links de las propiedades | **Hecho** (fichas con enlace) |
| Guardar el contacto por operación y propiedad | **Hecho** (contacto, requisitos y oportunidad con propiedades) |
| Difusión con novedades de la red a esa base | Campañas con plantilla, por segmento, en el PR #5; falta el contenido de red y el permiso por contacto (etapa 6) |
| Avisar a los corredores cuando una propiedad les puede interesar a esos contactos | **Falta** (etapa 3, junto con el aviso al corredor) |

## Lanzamiento al público

El procedimiento completo, con responsables y criterios de cierre, está en [historial/2026-11-19-plan-lanzamiento-v01-borrador.md](historial/2026-11-19-plan-lanzamiento-v01-borrador.md). Acá solo el avance:

- [ ] Fase 1: recuperar WhatsApp y operar lo que ya está (sin código).
- [x] Fase 2: correcciones de la auditoría que bloquean (hoja vacía, pestaña con cuenta de servicio, anonimización, agente fuera de rubro). Código listo; faltan las pruebas manuales (ver «Hecho»).
- [ ] Fase 3: despliegue del PR #5 (bucket, 0026, verificación y reversión).
- [ ] Fase 4: WhatsApp oficial con Meta (portfolio, verificación, privacidad, opt-in, plantillas, costos).
- [ ] Fase 5: origen de cada conversación (UTM por redireccionador, portales, QR).
- [ ] Fase 6: primeras inmobiliarias (acuerdo de datos, alta, `borrador` → `auto`).
- [ ] Fase 7: seguridad antes de abrir (rotar claves, SMTP, respaldos).
- [ ] Fase 8: rutina de autogestión diaria, semanal y mensual.
- [x] Commit y push de la etapa 1, la copia de adjuntos y la Fase 2 en la rama del PR #5 (2026-11-19).

## Hecho

- Auditoría integral y plan de corrección → [historial/2026-10-19-auditoria-integral.md](historial/2026-10-19-auditoria-integral.md).
- Operación: cola persistente, contactos (etiquetas, grupos, segmentos), campañas, seguimientos, ciclo de vida de clientes, mejora del agente, métricas → [historial/2026-10-20-registro-implementacion.md](historial/2026-10-20-registro-implementacion.md).
- Anuncio de origen y primeras respuestas (migración 0025).
- Etapa 1, "que ningún mensaje quede sin atender": audios transcritos, imágenes descritas, lo ilegible a la campanita con acuse, espera configurable (migración 0026) → [historial/2026-11-16-checklist-etapa-1.md](historial/2026-11-16-checklist-etapa-1.md).
- **2026-11-19 — Copia propia de los adjuntos:** cada mensaje con adjuntos encola `media_store`, que los copia a Storage al llegar. El CRM y las lecturas de IA leen de ahí primero. Anonimizar borra la copia. Verificado con `typecheck`, `lint` y `build`; sin probar contra Storage ni Zernio reales.
- **2026-11-19 — Fase 2 del lanzamiento:** una hoja sin ningún `property_id` ya no pausa la cartera (abre el incidente `hoja-sin-filas`). Con cuenta de servicio se lee la pestaña del `gid` y todas las columnas (antes primera pestaña y `A:Z`). `media_store` no sube nada si la inmobiliaria quedó eliminada. El agente no atiende pedidos fuera del rubro, y hay un escenario `fuera_de_rubro` en el Laboratorio. Verificado con `typecheck`, `lint` y `build`. **Sin probar:** hoja con solo el encabezado, lectura con cuenta de servicio y escenario del Laboratorio.
- **2026-11-19 — Documentos ordenados:** los 5 análisis con fecha pasaron a `docs/historial/`, con sus enlaces corregidos.

## Pendiente

**Pruebas manuales de la Fase 2** (código listo, sin probar):
- [ ] Sincronizar una hoja con solo el encabezado: 0 pausadas y el incidente `hoja-sin-filas`.
- [ ] Con cuenta de servicio, leer una pestaña que no sea la primera (`gid`): las mismas filas que por CSV, incluidas las columnas después de la Z.
- [ ] Laboratorio, escenario `fuera_de_rubro`: no escribe el poema, contesta corto y vuelve a las propiedades (o lo descarta como spam).

**Verificaciones con servicios reales** (no hay staging; nada de esto se probó):
- [ ] Un audio real por WhatsApp se transcribe (`input_audio` en `ogg` con `google/gemini-2.5-flash` no está confirmado en OpenRouter).
- [ ] Una foto real (captura de aviso) se describe bien.
- [ ] El adjunto queda en el bucket y se reproduce desde el CRM en Chrome y en el celular (Ogg/Opus puede no andar en Safari).
- [ ] Video y PDF llegan a la campanita con acuse; audio + texto contesta una sola vez.
- [ ] `usage.cost` de OpenRouter llega a `ai_usage_logs` (costo por audio e imagen).
- [ ] `test:db`, `test:e2e` y `eval` cuando exista staging (incluye `scripts/test-operacion-db.ts`, escrita y nunca corrida).

**Siguientes etapas** (plan completo en [historial/2026-11-16-analisis-chatbot-whatsapp.md](historial/2026-11-16-analisis-chatbot-whatsapp.md), §10):
- [ ] Etapa 2: `lead_source`, vínculo anuncio→propiedad, códigos de portal, lectura de portal como respaldo, resolvedor único, etiquetas automáticas.
- [ ] Etapa 3: red de propiedades operable (H-01 a H-03 de la auditoría), compatibilidad en el bot, aviso al corredor.
- [ ] Etapas 4 a 7: respuestas con adjuntos y botones, contenido por propiedad, prospección, diseño y medición.

**Deuda de la auditoría que sigue abierta:** delegación con destinatario y consentimiento (H-05), conexión de canal atada a la inmobiliaria (H-08), RLS por tenant (H-04), límites de uso en la base (H-11), fusión de duplicados.

## Decisiones

- Sin Supabase de staging por ahora; se avanza por etapas y se verifica en producción con cuidado.
- Propiedades que no están en la base: se buscan en la web (respaldo de la etapa 2).
- Campañas en frío: número comercial de Cowin; por ahora solo la lógica (etapa 6).
- Seguimientos con texto fijo del admin; eliminar una inmobiliaria = anonimizar; suspendida = guardar lo entrante sin responder; seguimientos por defecto 5 por día, de 8 a 22 h.
- Adjuntos: se copian todos al llegar (salvo stickers y contenido compartido), en Supabase Storage, sin tabla nueva (la ruta es determinista).
- Forma de trabajo: Ponytail activo (el cambio más chico que resuelve todo). Sin tests nuevos salvo pedido; se verifica con `typecheck`, `lint` y `build`.

## Preguntas abiertas

- ¿Cuánto tiempo guarda Meta un adjunto entrante? El OpenAPI de Zernio dice "un plazo limitado" sin número. La copia se hace en segundos; los reintentos cubren ~8 minutos.
- Supabase: ¿plan Pro para tener staging o un proyecto aparte?
- Aviso al corredor: ¿WhatsApp, email o ambos? ¿Qué disparadores por defecto?
- Audios por propiedad: ¿grabados por la inmobiliaria o voz sintética?
