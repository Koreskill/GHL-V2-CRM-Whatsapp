# Comparación de Xenda con nuestro GHL

Fecha: 22 de octubre de 2026. Proyecto revisado: **Setter CRM**, carpeta local `GHL`. Rama: `feat/operacion-campanas-seguimientos`. Commit de referencia: `14c5fa1`.

**Nuestro sistema ya cubre buena parte de la atención y la gestión comercial que se muestran: recibir conversaciones, responder con IA, identificar necesidades, consultar propiedades, conservar el historial y registrar pedidos de visita. La cobertura todavía es parcial en la ficha de consulta unificada, el seguimiento del trabajo humano y la atribución comercial. Faltan la asignación automática al asesor indicado, el aviso personal por WhatsApp y los reportes de rendimiento por asesor y conversión por origen.**

El ejemplo de mascotas merece especial atención: tenemos extracción de preferencias y un motor de compatibilidad, pero la búsqueda que alimenta las respuestas del bot usa criterios más limitados. No corresponde dar ese recorrido por resuelto.

## 1. Qué se revisó y qué significa cada estado

Material aportado, ubicado en `C:\Users\BENJA\Downloads`:

- `WhatsApp Video 2026-10-22 at 18.56.33.mp4`: duración de 47,53 segundos. Se extrajo y transcribió el audio localmente y se revisaron fotogramas del video.
- `WhatsApp Image 2026-10-22 at 18.56.49.jpeg`: conversación fuera de horario, con alternativas que aceptan mascotas y posterior intervención de Martín.
- `WhatsApp Image 2026-10-22 at 18.56.49 (1).jpeg`: listado de consultas con intención, origen, antigüedad, responsable y estado.
- Código actual de ingesta, agente, catálogo, compatibilidad, conversaciones, contactos, oportunidades, visitas, seguimientos y reportes. Los documentos anteriores se usaron como contexto; el código actual prevalece cuando difieren.

Los estados de este informe son:

- **Cubierto:** existe implementación conectada al flujo correspondiente. No significa que se haya comprobado el despliegue y las cuentas reales.
- **Parcial:** existen piezas funcionales, pero falta una parte de la promesa o una conexión entre ellas.
- **Falta:** no se encontró una implementación del comportamiento prometido en el recorrido revisado.
- **Sin validar:** no se midió o comprobó en esta revisión.

Aquí “nuestro GHL” significa este proyecto local. No se están atribuyendo al proyecto todas las funciones que pudiera ofrecer la plataforma comercial GoHighLevel.

El material de Xenda muestra una propuesta comercial. Las imágenes dicen “Conversación de ejemplo” y “Datos de ejemplo”: permiten identificar lo que se vende, pero no verificar su funcionamiento real.

## 2. Qué está vendiendo el video, punto por punto

Los tiempos son aproximados y sirven para localizar cada promesa.

| Tramo | Qué comunica | Qué significa para una inmobiliaria |
|---|---|---|
| 00:00–00:05 | El bot contesta las preguntas habituales al instante. | Reducir el tiempo dedicado a responder consultas repetidas. |
| 00:05–00:11 | Llegan cientos de chats; cuesta saber quién respondió o hizo seguimiento. | Resolver el desorden de la operación y la falta de responsables claros. |
| 00:11–00:17 | Cada conversación se convierte automáticamente en una consulta. | Generar un registro de trabajo sin cargarlo a mano. |
| 00:17–00:21 | La IA deja la información preparada para responder y cerrar. | Entregar al asesor necesidades, contexto y datos del cliente. |
| 00:21–00:25 | La consulta llega sola al asesor correcto. | Asignar automáticamente; la pantalla ejemplifica una asignación por zona y un aviso de WhatsApp. |
| 00:25–00:29 | Cada cliente tiene seguimiento y no se pierden consultas. | Que el equipo pueda continuar y controlar cada caso. |
| 00:29–00:34 | Se muestra cuánto responde el equipo y qué tan rápido. | Medir productividad, carga y tiempos de atención. |
| 00:34–00:38 | Se identifica de dónde vienen los clientes y cuál origen convierte más. | Evaluar captación y resultados por fuente comercial. |
| 00:38–00:47 | Cierre: WhatsApp ordenado y pedido de demo. | La oferta central combina atención automática, organización del equipo y medición. |

La ficha del segundo 19 muestra consulta principal, otra consulta, información adicional, adjuntos y datos del cliente. La pantalla del segundo 33 agrega estados del equipo, carga promedio y consultas cerradas por agente. La del segundo 36 muestra fuentes como ZonaProp, Meta, Argenprop, Google, Directo y MercadoLibre, junto con resultados de las consultas. Mostrar esas etiquetas no demuestra una integración directa con las API de esos portales.

Evidencia visual: [vista general del video](video-contact-sheet.jpg), [ficha de consulta](video-19.jpg), [asignación y aviso](video-24.jpg), [rendimiento](video-33.jpg), [orígenes y resultados](video-36.jpg). También se conserva la [transcripción automática original](transcripcion.json), cuyo reconocimiento del nombre de la marca y del dominio es impreciso; esos datos se identificaron visualmente.

## 3. Comparación de las promesas del video

| # | Punto que venden | Nuestro estado | Qué ya hace nuestro sistema | Qué falta o limita la equivalencia |
|---|---|---|---|---|
| V01 | Responder automáticamente preguntas de clientes. | **Cubierto** | Clasifica el mensaje, determina el flujo, consulta datos, redacta, valida y envía. También permite borradores y derivación humana. [E01] | Requiere canal e IA del hilo habilitados y política automática. Hay casos que quedan para revisión. “Al instante” no es un tiempo garantizado: se agrupan mensajes durante 5 segundos antes del procesamiento. |
| V02 | Gestionar cientos de chats diarios. | **Parcial / capacidad sin validar** | Hay cola persistente, reintentos y procesamiento concurrente. [E02] | No se hizo una prueba de carga. Los topes de respuestas del bot son 20 por conversación/hora, 300 por inmobiliaria/hora y 3.000 globales/hora por defecto; los dos últimos son configurables. Estos valores no equivalen a una capacidad medida ni a cantidad de chats diarios. |
| V03 | Registrar las conversaciones sin carga manual. | **Cubierto** | La ingesta crea o actualiza conversación, resuelve contacto cuando tiene una identidad y guarda mensajes y contadores. [E03] | Depende de recibir los eventos de una cuenta conectada y asignada. No convierte automáticamente todo chat en una oportunidad comercial. |
| V04 | Convertir cada chat en una consulta con toda la información lista para trabajar. | **Parcial** | Extrae necesidades, guarda clasificación, resumen interno y datos faltantes; reúne historial y ficha de contacto. Crea oportunidad cuando se muestran propiedades o se registra una visita. [E04, E05] | No hay una ficha unificada equivalente a la de Xenda para todos los casos. El resumen del triaje solo se presenta en su panel cuando hay borrador o derivación. Garantía, recibo de sueldo, fecha de mudanza y segunda consulta no tienen un recorrido estructurado equivalente. |
| V05 | Calificar lo que busca cada persona. | **Cubierto** | Reconoce compra, alquiler, propietario, tasación, consulta por propiedad, visita, reclamo y pedido de persona. Extrae zona, presupuesto, moneda, ambientes, dormitorios y preferencias; registra temperatura e interés. [E04, E06] | La calidad real de clasificación y extracción depende de los modelos y de su calibración. Una intención principal no equivale a gestionar varias consultas independientes de una persona. |
| V06 | Asignar sola la consulta al asesor correcto. | **Falta** | Se pueden asignar responsables manualmente a oportunidades y visitas. [E07] | No se encontró un motor de reparto por zona, propiedad, especialidad, disponibilidad o carga. La oportunidad creada por el bot nace sin responsable asignado. Derivar a una persona no selecciona automáticamente a un asesor. |
| V07 | Avisarle al asesor por WhatsApp que recibió una consulta. | **Falta** | Los casos que necesitan intervención quedan en los pendientes de la campanita del CRM. [E08] | No se encontró un envío personal al WhatsApp del asesor como el mostrado en el segundo 24. La campanita interna no cubre ese comportamiento. |
| V08 | Que cada cliente tenga seguimiento y no se pierda ninguna consulta. | **Parcial** | Hay pendientes humanos, oportunidades, estados de visita y secuencias automáticas de seguimiento configurables. La respuesta del cliente corta la secuencia. [E08, E09] | El seguimiento automático usa textos fijos del administrador y respeta la ventana de mensajería. No prueba que una persona haya llamado, enviado fotos o retomado a tiempo. Falta un control integral de responsable, vencimiento y escalamiento del trabajo humano. No se puede garantizar “ninguna consulta perdida”. |
| V09 | Medir cantidad de respuestas y velocidad de atención. | **Cubierto, a nivel general** | Reportes muestran conversaciones nuevas, mensajes, respuestas del bot y humanas, fallos, pendientes y mediana del tiempo hasta la primera respuesta del turno. [E10] | Es una medición agregada: combina respuestas automáticas y humanas. El video muestra tiempo promedio; nuestro indicador es mediana. No deben presentarse como la misma medida. |
| V10 | Mostrar cómo rinde cada asesor y la carga del equipo. | **Falta** | Existen responsables de oportunidades y visitas y datos generales de actividad. [E07, E10] | No hay reporte equivalente por persona de consultas asignadas/respondidas/cerradas, velocidad, carga ni estado en línea. El envío humano guarda el origen `human`, pero no recibe el identificador del usuario que lo envió. [E11] |
| V11 | Identificar de dónde viene cada cliente. | **Parcial** | Guarda el referido de Meta cuando llega: anuncio, identificadores, texto, enlace y fecha. Lo muestra en la conversación; también diferencia canales. [E12] | No hay una clasificación comercial completa de ZonaProp, Argenprop, Google, MercadoLibre, directo, etc. WhatsApp es un canal; ZonaProp es un origen. No son datos intercambiables. |
| V12 | Saber cuál origen convierte más y qué pasó con sus consultas. | **Falta** | Tenemos oportunidades ganadas/perdidas, visitas y estadísticas de respuesta a campañas. [E10, E13] | No hay reporte que cruce fuente de captación con visita coordinada, pedido de información, fuera de presupuesto, operación realizada o cierre. Que alguien responda una campaña no demuestra una venta. |

## 4. Qué agregan las dos imágenes

### Imagen de la consulta del domingo por la noche

| # | Paso del ejemplo | Nuestro estado | Comparación concreta |
|---|---|---|---|
| I01 | Responder un domingo a las 23:41. | **Cubierto en el flujo** | El bot no está restringido por un horario de oficina. Puede atender un mensaje entrante fuera de horario si servidor, integraciones y configuración están activos. No se verificó disponibilidad continua en producción. [E01, E02] |
| I02 | Reconocer la propiedad consultada y responder si sigue disponible. | **Cubierto con datos cargados** | Busca referencias de propiedades y consulta el catálogo de esa inmobiliaria. Ofrece disponibles y reservadas; en las reservadas lo advierte. La vigencia depende de mantener actualizado el catálogo. [E14] |
| I03 | Ofrecer otras propiedades según operación, zona y presupuesto. | **Cubierto** | La búsqueda distingue venta/alquiler y moneda, ordena coincidencias y puede ofrecer alternativas identificadas como tales. Las fichas se construyen con datos reales del catálogo. [E14, E15] |
| I04 | Entender “tengo un perro” y ofrecer únicamente propiedades que aceptan mascotas. | **Parcial; el recorrido completo no está cubierto** | Puede extraer preferencias y el motor de compatibilidad evalúa amenities requeridos. Sin embargo, la búsqueda que usa el bot no filtra por mascotas ni amenities. No hay un dato específico y normalizado de aceptación de mascotas en ese recorrido. No podemos garantizar las dos alternativas aptas del ejemplo. [E16] |
| I05 | Respetar exactamente “2 ambientes”. | **Parcial** | La extracción distingue ambientes de dormitorios y guarda ambientes en `raw_extraction`. Pero los criterios de búsqueda del bot solo llevan mínimo de dormitorios; no incluyen ambientes. No corresponde dar por resuelto un filtro exacto de 2 ambientes. [E17] |
| I06 | Dar acceso a fotos de las alternativas. | **Cubierto mediante enlaces** | La ficha incorpora el aviso/ficha o enlace a fotos y, si existen, video y tour virtual. No es una galería multimedia enviada automáticamente al chat: las fichas salen como texto con enlaces. [E15] |
| I07 | Mostrar botones “Ver fotos”, “Visitar Tucumán” y “Otra zona”. | **Falta en las respuestas del bot** | El recorrido automático envía texto. Hay soporte de botones en plantillas de WhatsApp, pero eso no implementa botones dinámicos de conversación ligados a esas acciones. [E11, E18] |
| I08 | Registrar “quiero visitar esa propiedad”. | **Cubierto** | Cuando hay una sola propiedad identificada, crea o actualiza la visita como `solicitada`, guarda la petición del cliente y avisa al equipo. Con varias propiedades, necesita aclarar cuál. [E05] |
| I09 | Agendar una visita con fecha confirmada. | **Parcial** | Existen visitas, calendario, disponibilidad y reserva interna. El bot pide preferencias y deja la coordinación al equipo; no está conectado para ofrecer y reservar horarios por sí mismo. La imagen tampoco demuestra reserva autónoma: Martín propone una hora al día siguiente. [E19] |
| I10 | Pasar la conversación al asesor con contexto. | **Cubierto para la continuidad manual; parcial como automatización** | La persona puede abrir historial, necesidades, propiedades, oportunidad y visita. Los casos delicados o pedidos de persona pausan la IA. Falta seleccionar automáticamente a “Martín, el asesor de esa propiedad”. Tampoco hay garantía de que contacte al día siguiente. [E01, E04, E05, E07] |

### Imagen del panel de consultas

| # | Elemento que muestra Xenda | Nuestro estado | Comparación concreta |
|---|---|---|---|
| I11 | Una fila con resumen, intención, origen, antigüedad, responsable y estado. | **Parcial** | Tenemos esos conceptos repartidos entre conversaciones, contacto, triaje, pipeline y visitas. La lista de conversaciones presenta una vista previa del último mensaje, no una consulta resumida con todas esas columnas. [E04, E20] |
| I12 | Filtros “Sin asignar”, “Mías”, “Activas”, “Cerradas”, “Todas” y por persona. | **Parcial** | La bandeja tiene activas, desactivas, delegadas y archivadas, además de canal y búsqueda. No tiene el mismo circuito de consultas por asesor, “mías” y “sin asignar”. Archivada no significa operación cerrada. [E20] |
| I13 | Buscar por nombre, teléfono o texto. | **Parcial** | La búsqueda de la bandeja contempla nombre, teléfono, usuario e identificador. No busca en el cuerpo de los mensajes ni en un resumen de consulta. [E20] |
| I14 | Distinguir alquiler, compra, tasación y reclamo y abrir el chat. | **Cubierto en clasificación y acceso** | Esas intenciones están contempladas; el CRM permite acceder al hilo y el reclamo sigue una ruta humana distinta de la comercial. La clasificación no aparece organizada en la misma tabla de la imagen. [E06, E20] |

## 5. El ejemplo de Lucía, trasladado a nuestro sistema

1. **Lucía escribe fuera de horario:** la ingesta puede guardar el mensaje y encolarlo para el agente.
2. **Pregunta por una propiedad:** podemos identificarla si el mensaje trae una referencia suficiente. Podemos contestar con datos del catálogo; si no constan, corresponde pedir confirmación.
3. **Dice que tiene un perro:** el dato puede quedar como preferencia o contexto, pero no está garantizada su extracción como condición normalizada ni su aplicación como filtro de la búsqueda automática.
4. **Necesita dos ambientes:** podemos extraer ese dato, pero hoy no se aplica como un criterio propio en esa búsqueda.
5. **Hay que proponer alternativas aptas:** podemos buscar por operación, zona, presupuesto y dormitorios. Para reproducir fielmente la imagen faltan la restricción de mascotas y la de ambientes en el mismo recorrido.
6. **Quiere ver fotos:** podemos compartir enlaces existentes. Faltan los botones dinámicos del ejemplo.
7. **Elige visitar una propiedad:** podemos dejar una visita solicitada y un pendiente para el equipo. No equivale a una visita confirmada.
8. **Debe continuar Martín el lunes:** un integrante del equipo puede asignarlo y responder con el historial disponible. No encontramos una selección automática de Martín, una notificación personal a su WhatsApp ni un compromiso programado que asegure ese contacto.

**El recorrido está avanzado, pero todavía no reproduce de punta a punta el ejemplo de la imagen.**

## 6. Qué conviene completar, en orden

| Prioridad | Trabajo pendiente | Qué debería poder demostrarse para darlo por cubierto |
|---|---|---|
| 1 | Conectar los requisitos importantes con la búsqueda que realmente responde al cliente. | Ante “2 ambientes, con perro”, solo presentar coincidencias verificadas. Si no sabemos si aceptan mascotas, decirlo y pedir confirmación. Un dato ausente no debe convertirse en “no acepta” ni en “sí acepta”. |
| 1 | Asignación automática con reglas y responsable persistido. | Una consulta entra, se aplica una regla definida por la inmobiliaria y queda asignada a una persona activa. Si no hay candidato, queda visible sin asignar. Incluir zona, propiedad u otro criterio que el negocio decida. |
| 1 | Ficha de consulta unificada y bandeja de trabajo del asesor. | Mostrar resumen actualizado, necesidades, información adicional, origen, responsable, estado y próxima acción; filtrar por “mías”, “sin asignar” y pendientes. La clasificación y los datos no deberían exigir recorrer varios módulos. |
| 2 | Avisos al asesor y control de la continuidad humana. | El asesor recibe el aviso por el canal configurado; puede registrar que tomó el caso y su próxima acción. Si vence el plazo de atención definido, el caso vuelve a avisarse o escalarse. |
| 2 | Rendimiento por asesor. | Registrar al autor de cada respuesta y los cambios de asignación; calcular tiempos, carga y resultados por persona, distinguiendo bot, humano y automatizaciones. |
| 2 | Origen comercial y resultados por origen. | Conservar canal y fuente como datos distintos, junto con la evidencia del origen. Relacionar la consulta con visitas y cierres para comparar tasas con denominadores y períodos claros. |
| 3 | Botones dinámicos y presentación multimedia. | Acciones de fotos, visita y cambio de zona que funcionen en el canal y conserven la propiedad y el hilo correspondientes. |
| 3 | Validación operativa del recorrido completo. | Verificar migraciones y configuración del entorno desplegado; probar con cuentas reales la llegada, respuesta, derivación, visita, seguimiento y estados de entrega. Medir volumen y tiempos antes de prometer capacidad. |

La agenda autónoma del bot es una ampliación posible, pero no es necesaria para igualar el ejemplo de la primera imagen: allí la hora la propone una persona.

## 7. Capacidades nuestras que este material no destaca

Estas funciones aparecen implementadas en el proyecto. Que no se muestren en el anuncio no permite concluir que Xenda carezca de ellas.

| Capacidad propia | Implementación encontrada |
|---|---|
| Atención de WhatsApp, Instagram DM y Facebook Messenger en una bandeja. | Canales separados de proveedor e identidades por canal. [E03, E20] |
| Pipeline con oportunidades, propiedades relacionadas e historial. | Estados abierta/ganada/perdida y gestión de responsables. [E05, E07, E13] |
| Visitas con solicitud, agenda, reprogramación y resultado. | Se distingue una petición de una visita confirmada. [E05, E19] |
| Campañas segmentadas y seguimientos automáticos. | Audiencias, programación, estados de envío y exclusión por baja; sujetos a configuración y ventana. [E09, E21] |
| Compatibilidad explicable entre cliente y propiedad. | Puntajes por criterios y preferencias corregibles por personas. Falta aprovechar todos esos criterios en la búsqueda del bot. [E16] |
| Administración del agente. | Guion de primeras respuestas, borradores, versiones y restauración, ejemplos aprobados y laboratorio. [E22] |
| Operación de varias inmobiliarias. | Configuración y contexto por organización y administración de agencia. Su aislamiento y despliegue no se certificaron aquí. [E23] |

## 8. Verificaciones y límites de este informe

- **Ejecutado:** revisión de los tres archivos aportados, transcripción local del audio, inspección de fotogramas, lectura del código actual y ejecución de `npm test`, que terminó correctamente el 22/10/2026.
- **No ejecutado:** pruebas contra base de datos, envío de mensajes, llamadas a modelos o proveedores reales, reservas reales, prueba de carga y revisión visual del CRM funcionando en celular. El video muestra uso móvil; nuestra equivalencia móvil queda sin validar.
- Los documentos operativos del repositorio señalan validaciones pendientes de migraciones e integraciones. Su estado histórico no demuestra qué está aplicado hoy en producción. Este informe tampoco lo comprobó.
- Las pruebas locales confirman reglas y funciones ejercitadas por esas suites. No prueban por sí solas comprensión real del modelo, calidad de atención ni funcionamiento de WhatsApp en producción.
- No se modificó la aplicación ni se enviaron mensajes; se agregó este análisis con su evidencia.

**Cómo describir hoy nuestro alcance:** “Centralizamos conversaciones de WhatsApp, Instagram y Messenger; el agente identifica necesidades, responde con datos del catálogo, registra propiedades mostradas y pedidos de visita, y deja pendientes para la intervención del equipo. Tenemos pipeline, seguimientos y métricas generales. La asignación automática a asesores y los reportes de conversión por origen todavía requieren desarrollo.”

## 9. Evidencia del proyecto

Las líneas se indican como puntos de entrada para la revisión del commit citado; pueden cambiar en versiones posteriores.

- **E01 — Respuesta, revisión y derivación:** [triage/run.ts](../../../src/lib/agent/triage/run.ts), línea 298; [triage/compose.ts](../../../src/lib/agent/triage/compose.ts); [agent/config.ts](../../../src/lib/agent/config.ts), línea 32. Doble interruptor, ventana abierta, modos de envío, validaciones y pausa de IA.
- **E02 — Cola y límites:** [jobs/worker.ts](../../../src/lib/jobs/worker.ts), línea 10; [jobs/queue.ts](../../../src/lib/jobs/queue.ts); [triage/run.ts](../../../src/lib/agent/triage/run.ts), línea 38; [inbox/ingest.ts](../../../src/lib/inbox/ingest.ts), línea 206. Concurrencia de triaje 4 por proceso, agrupación inicial de 5 segundos y topes de respuesta.
- **E03 — Registro automático:** [inbox/ingest.ts](../../../src/lib/inbox/ingest.ts), línea 46; [inbox/contacts.ts](../../../src/lib/inbox/contacts.ts). Creación/actualización de conversación, identidad y mensaje.
- **E04 — Perfil y resumen:** [triage/extract.ts](../../../src/lib/agent/triage/extract.ts), línea 17; [triage/tags.ts](../../../src/lib/agent/triage/tags.ts); [triage/generate.ts](../../../src/lib/agent/triage/generate.ts), línea 54; [triage/run.ts](../../../src/lib/agent/triage/run.ts), línea 281; [triage-panel.tsx](../../../src/components/inbox/triage-panel.tsx), línea 35; [contact-panel.tsx](../../../src/components/contacts/contact-panel.tsx), línea 27. Resumen persistido y presentación condicionada del panel.
- **E05 — Oportunidad y visita automáticas:** [triage/run.ts](../../../src/lib/agent/triage/run.ts), líneas de entrada 171, 193 y 214. Oportunidad al mostrar propiedades y visita solicitada ante propiedad identificada; no creación de una consulta comercial independiente por cada mensaje.
- **E06 — Clasificación:** [triage/questions.ts](../../../src/lib/agent/triage/questions.ts); [triage/routes.ts](../../../src/lib/agent/triage/routes.ts); [triage/tags.ts](../../../src/lib/agent/triage/tags.ts), línea 237. Intención principal, derivación, urgencia, temperatura e interés.
- **E07 — Asignación manual:** [pipeline/actions.ts](../../../src/app/(app)/pipeline/actions.ts), líneas de entrada 50 y 199; [visitas/actions.ts](../../../src/app/(app)/visitas/actions.ts); [triage/run.ts](../../../src/lib/agent/triage/run.ts), línea 171. El bot no completa `assignedUserId` al crear la oportunidad.
- **E08 — Aviso interno:** [triage/compose.ts](../../../src/lib/agent/triage/compose.ts), línea 542; [triage/run.ts](../../../src/lib/agent/triage/run.ts), línea 492; [triage/queries.ts](../../../src/lib/agent/triage/queries.ts), línea 74. `notifyTeam` deja el caso en pendientes; no dispara un WhatsApp al asesor.
- **E09 — Seguimientos:** [followups/run.ts](../../../src/lib/followups/run.ts), línea 30; [followups/logic.ts](../../../src/lib/followups/logic.ts); [inbox/ingest.ts](../../../src/lib/inbox/ingest.ts), línea 171. Inscripción, envío, horarios, ventanas y corte ante respuesta.
- **E10 — Métricas generales:** [crm/queries.ts](../../../src/lib/crm/queries.ts), línea 176; [reportes/page.tsx](../../../src/app/(app)/reportes/page.tsx), línea 37; [crm/ops-metrics.ts](../../../src/lib/crm/ops-metrics.ts). Sin agrupación equivalente por asesor ni fuente comercial.
- **E11 — Salida de mensajes:** [inbox/deliver.ts](../../../src/lib/inbox/deliver.ts), línea 34; [messages/send/route.ts](../../../src/app/api/messages/send/route.ts), línea 27. Entrada de texto o plantilla, origen humano/IA/campaña/seguimiento y persistencia sin identificador del autor humano.
- **E12 — Atribución:** [inbox/attribution.ts](../../../src/lib/inbox/attribution.ts), línea 64; [inbox/ingest.ts](../../../src/lib/inbox/ingest.ts), línea 85. Lectura del referido y conservación del primer origen capturado.
- **E13 — Cierres comerciales:** [pipeline/actions.ts](../../../src/app/(app)/pipeline/actions.ts), línea 144; [pipeline.ts](../../../src/lib/pipeline.ts). Existen cierres de oportunidad, pero no el reporte que los cruza con fuentes.
- **E14 — Catálogo consultado por el bot:** [triage/catalog-search.ts](../../../src/lib/agent/triage/catalog-search.ts), líneas de entrada 53, 308, 361 y 451; [triage/retrieval.ts](../../../src/lib/agent/triage/retrieval.ts). Identificación, estados ofertables, búsqueda y alternativas.
- **E15 — Fichas y fotos:** [triage/listing-cards.ts](../../../src/lib/agent/triage/listing-cards.ts), línea 44. Texto con datos y enlaces; no mensaje con galería ni botones dinámicos.
- **E16 — Brecha entre compatibilidad y búsqueda:** [scoring/profile.ts](../../../src/lib/scoring/profile.ts); [scoring/score.ts](../../../src/lib/scoring/score.ts), línea 206; [triage/compose.ts](../../../src/lib/agent/triage/compose.ts), línea 326; [triage/catalog-search.ts](../../../src/lib/agent/triage/catalog-search.ts), línea 308. Amenities requeridos existen en compatibilidad, pero no en los criterios enviados a la búsqueda del bot. No se encontró un tratamiento específico de mascotas en ese recorrido.
- **E17 — Ambientes:** [triage/extract.ts](../../../src/lib/agent/triage/extract.ts), línea 55; [triage/tags.ts](../../../src/lib/agent/triage/tags.ts), línea 157; [triage/compose.ts](../../../src/lib/agent/triage/compose.ts), línea 326. Se extraen y almacenan, pero no se pasan como filtro a la búsqueda.
- **E18 — Botones en plantillas:** [zernio/templates.ts](../../../src/lib/zernio/templates.ts); [plantillas/actions.ts](../../../src/app/(app)/plantillas/actions.ts). Capacidad distinta de las acciones dinámicas de conversación del ejemplo.
- **E19 — Agenda:** [triage/routes.ts](../../../src/lib/agent/triage/routes.ts), objetivo de `coordinar_visita`; [calendar/book.ts](../../../src/lib/calendar/book.ts); [calendar/book/route.ts](../../../src/app/api/calendar/book/route.ts); [visitas/actions.ts](../../../src/app/(app)/visitas/actions.ts). La ruta del agente expresamente deja la confirmación al equipo.
- **E20 — Bandeja y búsqueda:** [inbox/queries.ts](../../../src/lib/inbox/queries.ts), línea 35; [inbox/status.ts](../../../src/lib/inbox/status.ts), línea 14; [inbox/filters.ts](../../../src/components/inbox/filters.ts); [conversation-list.tsx](../../../src/components/inbox/conversation-list.tsx). Sin filtros por responsable ni búsqueda en el cuerpo del mensaje.
- **E21 — Campañas y segmentación:** [campaigns/batches.ts](../../../src/lib/campaigns/batches.ts); [campaigns/run.ts](../../../src/lib/campaigns/run.ts); [crm/groups.ts](../../../src/lib/crm/groups.ts); [crm/contact-filters.ts](../../../src/lib/crm/contact-filters.ts).
- **E22 — Configuración y mejora:** [agent/first-replies.ts](../../../src/lib/agent/first-replies.ts); [agent/versions.ts](../../../src/lib/agent/versions.ts), líneas de entrada 12 y 43; [agent/feedback.ts](../../../src/lib/agent/feedback.ts); [lab/run.ts](../../../src/lib/lab/run.ts). Existencia de laboratorio no implica evaluación real contra proveedores en esta revisión.
- **E23 — Organizaciones y contexto:** [tenancy.ts](../../../src/lib/tenancy.ts); [agency/context.ts](../../../src/lib/agency/context.ts); [db/schema.ts](../../../src/db/schema.ts).
- **Contexto operativo:** [registro de implementación del 20/10](../2026-10-20-registro-implementacion.md) y [checklist OPE-005](../../checklist-ope-005.md). Se tomaron como antecedentes, sin tratar sus pendientes históricos como prueba del estado actual de producción.
