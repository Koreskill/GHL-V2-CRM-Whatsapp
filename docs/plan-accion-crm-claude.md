# Plan de acción para Claude: evolución del CRM Cowin

## 1. Encargo y estado comprobado

Implementar las funcionalidades solicitadas sobre este repositorio, por entregas pequeñas y verificables. Antes de tocar código, leer `AGENTS.md`, `CLAUDE.md` y la guía pertinente de `node_modules/next/dist/docs/`: esta instalación usa Next.js 16.3.6 y sus reglas pueden diferir de ejemplos conocidos. No sobrescribir cambios preexistentes: al redactar este plan, `src/app/api/webhooks/zernio/route.ts` ya figura modificado.

Mapa actual:

| Área | Implementación existente | Brecha concreta |
| --- | --- | --- |
| Apariencia | `src/app/globals.css` define tokens claros y sidebar oscuro; `src/app/layout.tsx` no gestiona tema. | Falta modo oscuro integral, selector y persistencia. |
| Pipeline | `src/app/(app)/pipeline/page.tsx`, `src/lib/pipeline.ts`, `src/app/(app)/pipeline/actions.ts`. Cinco etapas fijas, tarjetas y selector que persiste movimientos. | Falta arrastrar y soltar y personalizar color por columna e inmobiliaria. |
| Propiedades | Ficha privada en `src/app/(app)/propiedades/[propertyId]/page.tsx`; catálogo propio y proyección compartible para la red. | Faltan página pública Cowin, link limpio, control de publicación y branding. |
| Contactos | `src/app/(app)/contactos/page.tsx` y `src/lib/crm/queries.ts`: búsqueda y filtro por canal. | Faltan vistas y filtros por propiedad, fecha y presupuesto, panel lateral y estimador de campaña. |
| Conversaciones | Inbox por organización, con búsqueda/canal (`src/lib/inbox/queries.ts` y `src/components/inbox/*`). `conversations.ai_enabled` pausa la IA. | Faltan tres pestañas de estado, archivo/borrado y flujo de delegación entre inmobiliarias. |
| Visitas | Jev clasifica en `src/lib/agent/triage/compose.ts`; `recordVisitRequest` en `run.ts` crea una visita `solicitada` sin fecha para una propiedad inequívoca y evita duplicados habituales. | Hay que completar casos ambiguos, revisar la trazabilidad y conectar la confirmación de fecha con Calendario. |
| Calendario | `src/lib/calcom.ts` usa `CALCOM_URL` y `CALCOM_API_KEY` globales y solo lee próximas reservas; `src/app/(app)/calendario/page.tsx` muestra lista + iframe. | No hay configuración por inmobiliaria, vínculo visita-reserva ni sincronización de cambios. |

Reglas que deben conservarse: `organization_id` sale de la sesión y se valida en cada query/acción; la conversación se identifica por `conversationId`, no por contacto; un contacto puede tener varias conversaciones; los eventos de oportunidades y visitas son históricos; solicitar una visita no equivale a confirmarla. La proyección de una propiedad de red no expone datos privados del dueño. Toda tabla nueva requiere migración Drizzle, grants y RLS para `crm_app`.

## 2. Decisiones de producto que debe fijar Claude antes del diseño de datos

Usar estas definiciones provisionales, documentarlas y validarlas con el responsable del producto antes de activar envíos, cesiones o publicaciones reales:

1. **Pestañas del inbox:** `Desactivas`, `Activas`, `Delegadas` en ese orden pedido. Interpretar activa/desactiva como estado operativo del hilo, independiente de `ai_enabled`, de la ventana de mensajería y de `unread_count`. No deducir actividad de fecha del último mensaje. `Delegadas` muestra solicitudes de la red pendientes de tomar; una vez tomada, desaparece de esa bandeja y aparece en `Activas` de la inmobiliaria receptora. Conservar referencia de origen y auditoría.
2. **Borrar conversación:** para uso cotidiano, implementar archivo/ocultación reversible con confirmación. Si se requiere borrado irreversible de mensajes y datos personales, diseñar un flujo aparte con permisos, retención, auditoría y manejo de nuevos webhooks; nunca hacer `DELETE` ingenuo que el proveedor recreará.
3. **Presupuesto de campaña:** distinguir *estimación de costo* de *ejecución de envíos*. La primera calcula destinatarios elegibles y costo estimado; la segunda necesita una acción explícita, vista previa, confirmación y registro de lote. La plantilla es por canal y estado de aprobación del proveedor; no asumir precio fijo o universal. Guardar moneda, precio unitario, fuente y fecha de tarifa, excluidos y total. No confundir este presupuesto con `prospect_requirements.budget_max`, que es el presupuesto inmobiliario del prospecto.
4. **Página pública de propiedad:** usar solamente campos aprobados para publicación, con identidad Cowin y opción de marca de la inmobiliaria; nunca mostrar `internal_notes`, documentos privados, dirección completa si no fue autorizada ni contacto del propietario. La ficha pública debe poder pausarse/revocarse.
5. **Calendario por inmobiliaria:** cada `organization_id` vincula su propia cuenta/evento de Cal.com mediante una integración por organización. Las variables globales actuales sirven solo para transición o un tenant explícitamente configurado; no exponer reservas de todos los tenants en una misma vista.

## 3. Orden de implementación

### Entrega A — Base visual y configuración por inmobiliaria

1. Definir tokens semánticos claro/oscuro en `src/app/globals.css`; revisar componentes con colores literales y el iframe de Cal.com. Añadir selector visible en shell, persistencia por usuario o preferencia local, arranque sin parpadeo y respeto opcional de preferencia del sistema. Verificar contraste, focus, estados de error, overlays y tablas en ambos temas.
2. Añadir configuración de colores del pipeline por organización. Mantener los IDs y el orden de las cinco etapas existentes. Ofrecer una paleta limitada de tonos tipo Notion, fondos tenues/translúcidos y previsualización en ambos temas. Validar color en servidor contra presets: no aceptar CSS arbitrario.
3. Entregar migración y políticas de acceso si la preferencia es persistente en DB. Si el tema solo es una preferencia individual del navegador, no agregar columnas innecesarias.

**Aceptación:** cambiar de tema mantiene legibles todas las rutas; el tema persiste al recargar; dos inmobiliarias pueden elegir colores distintos sin alterar las etapas ni los datos de la otra.

### Entrega B — Pipeline arrastrable

1. Extraer el tablero a un componente cliente acotado; usar una librería de drag and drop compatible con la versión instalada o APIs nativas si cumplen teclado y accesibilidad. Leer primero documentación local de Next y comprobar compatibilidad de la dependencia elegida.
2. Reutilizar la validación de `moveDealStage` de `src/app/(app)/pipeline/actions.ts` en una mutación invocable desde la UI: `dealId` y etapa destino validados, `organization_id` desde la sesión, solo oportunidades abiertas. Registrar `deal_events`; preservar la semántica actual de ganada/perdida. Definir expresamente si soltar en `cerrado_ganado` cierra el negocio o solo cambia etapa: no permitir contradicción entre `stage` y `status`.
3. Mostrar destino, estado de guardado, reversión si falla y acción alternativa con teclado/selector. Evitar que un doble drop escriba eventos duplicados.

**Aceptación:** mover entre columnas se persiste tras recargar, funciona con teclado, no mueve negocios de otra inmobiliaria y un fallo del servidor devuelve la tarjeta a su posición anterior.

### Entrega C — Ficha pública y landing de propiedades

1. Definir una plantilla de página pública Cowin con portada, galería, resumen, características, ubicación aproximada, descripción, precio con moneda, inmobiliaria responsable y CTA de contacto. Crear un link corto y estable por inmueble mediante slug/token público independiente del ID interno. Dar acciones `Previsualizar`, `Publicar`, `Copiar enlace`, `Pausar` en la ficha privada.
2. Crear una configuración de branding (logo, colores aprobados, datos de contacto y aviso legal) para Cowin y, si corresponde, cada inmobiliaria. Separar campos de publicación de los sincronizados desde Google Sheets para que la sincronización no borre decisiones editoriales. Validar elegibilidad de foto, precio, estado y campos faltantes; permitir borrador antes de publicar.
3. La ruta pública debe consultar únicamente el inmueble autorizado y publicado. Si se usa una propiedad de la red, leer su proyección pública y consentimiento, nunca la tabla privada del dueño desde otro tenant. Añadir metadatos para compartir, vista móvil y CTA medible.

**Aceptación:** un enlace publicado abre sin login con marca Cowin; una ficha pausada deja de ser pública; no filtra notas, documentos ni datos internos; los cambios de la hoja no anulan el estado editorial.

### Entrega D — Contactos, vistas, panel y campañas

1. Ampliar `listContacts` con filtros **en servidor** y paginación: propiedad vinculada por `deals`/`deal_properties` y/o interés registrado; fecha de alta, última interacción o visita (selector explícito de campo); rango de presupuesto del prospecto y moneda, operación, canal y etiquetas. Resolver duplicados al cruzar relaciones y mantener `organization_id` en subconsultas. Vistas guardadas opcionales por usuario/inmobiliaria con nombre, filtros y orden.
2. Al seleccionar fila, abrir panel lateral con identidad, canales, etiquetas, perfil/requerimientos, presupuesto y moneda, propiedades mostradas/interesadas, oportunidades, visitas y últimas conversaciones. Cargar detalle por contacto en ruta o recurso autorizado; permitir abrir el hilo sin cerrar contexto. En móvil, panel de pantalla completa. Accesibilidad: foco, cierre con Escape y retorno de foco.
3. Incorporar plantillas de campaña separadas de la respuesta individual: selección de canal, plantilla aprobada, variables, cantidad filtrada, exclusiones, costo unitario editable o consultado de fuente confiable, impuestos/recargos configurables y total con moneda. Para activar el envío: congelar una audiencia en un lote, mostrar muestra + exclusiones, confirmar, enviar por un job controlado con idempotencia, rate limit, registro por destinatario y resumen de éxitos/fallos. Reutilizar el camino de entrega existente (`deliverMessage`) cuando aplique y validar las ventanas/reglas de cada canal. Nunca activar envíos masivos solo por cambiar un filtro.

**Aceptación:** filtros combinables y reproducibles, conteos consistentes sin duplicados, panel con información del tenant correcto; la estimación explica su fórmula; una ejecución confirmada usa exactamente la audiencia congelada y no duplica destinatarios.

### Entrega E — Estados del inbox y delegación de red

1. Añadir estado operativo explícito para conversaciones locales (`activa`, `desactiva`, `archivada`) y eventos de cambio. Migrar las actuales como activas salvo regla de negocio aprobada. No reutilizar `ai_enabled`: este campo solo controla el bot. Agregar pestañas y conteos en ambas rutas de conversación, actualizar filtros/URL, búsqueda, auto refresh y vistas vacías.
2. Modelar **solicitudes de delegación** con `network_id`, conversación origen, inmobiliaria emisora, destinatario o asignación abierta, estado (`pendiente`, `tomada`, `rechazada`, `cancelada`), timestamps, usuario que tomó y consentimiento/alcance de los datos. No cambiar simplemente `conversations.organization_id`: mensajes, identidades, cuentas y webhooks están anclados al tenant y proveedor de origen. Diseñar un handoff que conserve historial y genere un hilo/expediente receptor controlado, o una referencia de trabajo con acceso limitado. Determinar qué cuenta de canal podrá responder después de la toma; no prometer continuidad del mismo canal sin verificar capacidad técnica y autorización del proveedor.
3. Implementar toma atómica: una agencia de la red activa puede tomar una solicitud una sola vez; desaparecer de `Delegadas` y aparecer en su inbox activo; conservar trazabilidad en origen y auditoría. Si el usuario insiste en “borrar”, la opción de UI recomendada es archivar con recuperación. Documentar un flujo separado para borrado legal irreversible.

**Aceptación:** pestañas y conteos reflejan el estado real; pausar la IA no cambia la pestaña; dos agencias no pueden tomar la misma solicitud; un tenant no ve el contenido privado de otro sin delegación aprobada; webhooks posteriores no reabren ni duplican un expediente transferido.

### Entrega F — Visitas, Jev y Calendario

1. Mantener la secuencia `solicitada` → `agendada` → resultado. Revisar `compose.ts`, `routes.ts`, `run.ts` y `scripts/test-visits.ts`: Jev debe clasificar el pedido; el código solo crea visita cuando hay contacto y propiedad inequívoca. Si hay varias propiedades, registrar tarea/aviso para aclarar cuál, sin inventar reserva. Guardar ID de conversación y mensaje que originó la solicitud para auditoría e idempotencia; incluir fecha/hora sugerida solo como texto o propuesta hasta confirmación humana.
2. Crear integración Cal.com por inmobiliaria: conexión/autorización segura, event type de visitas, zona horaria, prueba de conexión y desconexión. Guardar secretos cifrados o en un almacén seguro, nunca en cliente ni en metadata libre. Consultar documentación/API vigente antes de implementar creación, actualización y cancelación de reservas. Asociar `visit_id` ↔ booking UID, estado de sync, error/reintentos e ID externo con índices únicos por organización.
3. Al confirmar `scheduleVisit`, crear/actualizar la reserva de la inmobiliaria correspondiente y mostrarla en Calendario junto a visitas locales. Al reprogramar/cancelar, sincronizar el evento remoto de forma idempotente y registrar `visit_events`. Incorporar webhook de Cal.com validado para reservas creadas o modificadas fuera del CRM, con conciliación periódica. Evitar doble reserva y conflictos de horario. El calendario debe consultar por `organization_id`, no con una API key global compartida.
4. Definir degradación: si Cal.com falla, la visita local y el error de sincronización deben quedar visibles y reintentables; no afirmar que la reserva está confirmada en Cal.com si no lo está. El bot no confirma horarios por su cuenta.

**Aceptación:** Jev crea una sola visita solicitada para pedido inequívoco; al confirmar aparece una vez en Visitas y Calendario de la misma inmobiliaria; reprogramar y cancelar actualiza ambos; un fallo remoto se puede reintentar sin duplicar; no aparecen reservas de otros tenants.

## 4. Método de ejecución y verificación para Claude

1. Antes de cada entrega: inspeccionar los archivos citados y migraciones previas, documentar el diseño de datos y los permisos. Conservar el cambio preexistente del webhook. Usar migraciones nuevas, no editar las ya aplicadas; registrar grants/RLS e índices para cada tabla. Mantener salidas Zernio por el único camino existente y firma/idempotencia del webhook.
2. Implementar por entregas A–F, idealmente una rama/commit revisable por entrega. Para cada una: UI, queries, validación del servidor, migración, pruebas de reglas de negocio y actualización de `CLAUDE.md`/documentación pertinente. Entregar un resumen de archivos cambiados y decisiones.
3. Ejecutar `npm run typecheck`, `npm run lint`, `npm test` y `npm run build` al cerrar cada entrega. Añadir pruebas significativas para aislamiento entre organizaciones, transiciones de estado, idempotencia, permisos, costos/segmentación y conciliación de reservas. Pruebas de interfaz manuales en desktop/móvil y claro/oscuro.
4. Antes de despliegue: probar migración en entorno no productivo, configurar conexión Cal.com por organización y tarifas de campaña, revisar datos existentes, y definir monitoreo de errores de sincronización y envíos. Las acciones externas (publicar fichas, enviar campañas, delegar conversaciones, crear reservas remotas) se habilitan después de revisar una vista previa concreta con el responsable.

## 5. Preguntas que condicionan el comportamiento final

- ¿`Desactivas` significa hilos cerrados manualmente, o conversaciones con IA apagada? El plan usa estado operativo manual, porque `ai_enabled` ya tiene otra finalidad.
- ¿Qué se transfiere a la agencia que toma una conversación: solo expediente comercial, copia del historial, o capacidad efectiva para responder desde la cuenta original? Requiere definir consentimiento y canal autorizado.
- ¿La campaña presupuestada se enviará por WhatsApp, Instagram, Facebook o por más de un canal? ¿Qué cuenta paga y qué tarifa se usará?
- ¿La landing es una ficha por propiedad o también una página de captación por inmobiliaria/campaña?
- ¿Cada inmobiliaria tendrá su propia cuenta Cal.com o eventos separados dentro de una cuenta Cowin? El plan recomienda cuenta/credenciales por organización.

No bloquear las entregas independientes A–D por estas respuestas. Antes de activar E o envíos reales en D, resolver las preguntas de delegación/campañas. Antes de conectar F en producción, resolver la propiedad de las cuentas Cal.com.
