# Checklist: etapa 1 (que ningún mensaje quede sin atender)

Fecha: 16 de noviembre de 2026 · Rama `feat/operacion-campanas-seguimientos` · Plan completo: [2026-11-16-analisis-chatbot-whatsapp.md](2026-11-16-analisis-chatbot-whatsapp.md) (Fase 1).

**Estado: código terminado y verificado con `typecheck`, `lint`, `npm test` y `npm run build`. NO se probó con base, con Zernio ni con modelos reales.** Sin staging, lo único que cubre la prueba es la lógica pura. Nada está commiteado ni desplegado.

**Re-verificación del 16/11/2026 (segunda sesión):** `typecheck` (tsc --noEmit), `lint` sobre los archivos tocados, `npm test` completo y `npm run build` pasan sin errores. Contrato de medios confirmado contra `openapi/zernio.slim.json` (ver abajo). Nada nuevo se probó contra servicios reales.

## Decisiones tomadas para esta etapa

- **Sin Supabase de staging por ahora.** La etapa 0 (staging, `test:db`, `test:e2e`) queda en pausa; se arrancó por la etapa 1.
- **Propiedades que no están en la base: se buscan en la web.** Es el respaldo de la etapa 2 (portales). Queda como decisión registrada; no se implementó en esta etapa.
- **Campañas en frío: número comercial de Cowin, solo la lógica.** Aplica a la etapa 6. No se tocó en esta etapa.

## Hecho

### Que un adjunto nunca quede sin respuesta
- [x] Un mensaje sin texto pero con adjunto ya no se descarta: antes cortaba con `empty_message` (`triage/run.ts`).
- [x] **Audio entrante:** se descarga y se transcribe antes de clasificar. Entra al triaje como texto marcado como "transcripción automática".
- [x] **Imagen entrante:** se descarga y se describe (si es una captura de un aviso, se transcribe el texto visible). También cuando trae pie de foto.
- [x] **Lo que no se puede leer queda para una persona:** video, archivo, contenido compartido, falla de descarga o de modelo, audio sin voz. Aparece en la campanita con el motivo, y en modo automático la persona recibe un acuse fijo ("Recibimos tu audio. Una persona del equipo lo va a revisar.") sin plazos.
- [x] No pausa la IA por un adjunto ilegible: si después escribe texto, el agente lo atiende.
- [x] Sticker: se ignora sin molestar. Contenido compartido: avisa al equipo sin acuse.
- [x] Una falla del sistema (descarga o modelo caído) abre un incidente; "no se entiende el audio" no.
- [x] **Ráfagas:** audio y después texto → contesta uno solo, y ese lee el audio anterior (`deriveEarlierMedia`, tope 3, últimas 2 h).
- [x] **Baja por audio:** si la transcripción es un pedido de baja, se marca el contacto y se confirma como si lo hubiera escrito.
- [x] Lo leído por un modelo se guarda **aparte** del original (`message_derivations`), con el modelo usado. Se guardan las lecturas buenas y las "no se entiende nada"; una falla transitoria no se guarda y se reintenta.
- [x] El agente ve las lecturas marcadas como automáticas y como contenido de un tercero (dato, no instrucción).

### Ver los adjuntos en el CRM
- [x] Reproductor de audio, miniatura de imagen (se abre en otra pestaña), video y enlace a archivos, dentro de la burbuja del chat.
- [x] La transcripción o descripción se muestra debajo, marcada como "automática".
- [x] Ruta `GET /api/messages/[messageId]/media`: baja el medio con la clave del servidor, porque los medios de WhatsApp exigen autenticación y el navegador no la tiene.
- [x] Seguridad de esa ruta: solo mensajes de la organización de la sesión; la URL sale de lo guardado; **la clave de Zernio solo viaja al host `zernio.com`** (probado contra `zernio.com.otro.com` y similares); https obligatorio, sin IPs ni nombres internos; HTML y SVG bajan como descarga; tope de 25 MB; soporta `Range` para Safari.

### Espera antes de responder configurable
- [x] Campo "Espera antes de responder (segundos)" en Configuración → Agente (0 a 60, por canal con herencia de General). Antes era fijo en 5 s dentro de la ingesta.
- [x] Misma lógica de siempre: contesta el último mensaje de la ráfaga, desde el último mensaje.
- [x] La lectura de esa configuración va en un savepoint: un error de SQL no puede abortar la transacción de ingesta y perder el mensaje.
- [x] Entra en el historial de versiones de la configuración y se restaura.

### Base de datos y documentación
- [x] Migración `0026_medios_entrantes`: tabla `message_derivations` (con RLS, permisos solo para `crm_app`), columna `agent_configs.reply_delay_seconds` y las funciones de IA `transcripcion` y `vision`.
- [x] Script para aplicarla con el rol dueño: `drizzle/manual_apply_0026.sql` (una transacción, registra la migración).
- [x] Pruebas nuevas: `scripts/test-medios.ts` (dentro de `npm test`).
- [x] `CLAUDE.md` y `.env.example` actualizados (`OPENROUTER_TRANSCRIBE_MODEL`, `OPENROUTER_VISION_MODEL`).

## Falta para cerrar la etapa 1

Antes de desplegar:
- [ ] **Aplicar `drizzle/manual_apply_0026.sql` con el rol dueño.** Sin ella falla la lectura de la configuración del agente y de la lista de mensajes. **Bloqueado:** el proyecto de GHL no aparece en el MCP de Supabase de esta cuenta (solo `Koreskill-Academia` y `App Koreskill`), así que no se pudo aplicar ni comprobar qué migraciones están en producción.
- [ ] Revisar y commitear (no hay commit ni push de esta etapa). Pendiente de decisión del usuario: no se commiteó porque no se pidió explícitamente.

Verificaciones que no se pudieron hacer sin staging ni cuentas reales:
- [ ] **Mandar un audio real por WhatsApp** y confirmar que se transcribe. El audio se envía como `input_audio` en formato `ogg`; no se verificó que OpenRouter lo acepte con el modelo por defecto (`google/gemini-2.5-flash`). Si falla, elegir otro modelo con `OPENROUTER_TRANSCRIBE_MODEL`.
- [ ] **Mandar una foto real** (una captura de un aviso de portal) y confirmar la descripción con el modelo por defecto (`openai/gpt-4.1-mini`).
- [~] Confirmar que la URL del adjunto que entrega Zernio es la que describe el OpenAPI (`GET /v1/whatsapp/media/{id}` con `Authorization: Bearer`) y que la ruta de medios la baja bien. **Contrato confirmado en el OpenAPI (16/11):** el webhook trae esa URL para WhatsApp y la descarga exige Bearer; `lib/ai/media.ts` la usa con la clave solo hacia `zernio.com`. Falta la prueba real con un adjunto vivo.
- [ ] Reproducir el audio desde el CRM en Chrome y en el celular. Ogg/Opus puede no reproducirse en algunos Safari: ahí queda la transcripción.
- [ ] Mandar un video y un PDF: deben aparecer en la campanita y recibir el acuse.
- [ ] Mandar un audio seguido de un texto y confirmar que contesta una sola vez, viendo el audio.
- [ ] Revisar el costo real por audio y por imagen en `ai_usage_logs` (`usage.cost` de OpenRouter sigue sin confirmarse).
- [ ] Correr `npm run test:db` y `npm run test:e2e` cuando haya staging (la etapa 1 agrega una tabla y una consulta en el contexto del agente que esas pruebas todavía no ejercitan).

## Límites conocidos de esta etapa
- No hay tope de espera total: si alguien manda mensajes sin pausas mayores a la espera configurada, la respuesta se retrasa hasta que pare.
- No se leen videos ni documentos (PDF). Se derivan a una persona.
- Un audio muy largo (más de 10 MB) o una imagen de más de 5 MB no se leen y se derivan.
- Los mensajes importados del historial no traen el archivo: se siguen viendo como "[audio]".
- La lectura de un audio o una imagen puede equivocarse (cifras, nombres). Por eso se muestra como automática y no reemplaza al mensaje original.
- El Laboratorio todavía no simula audios ni fotos.

## Próximos puntos (anotado al cierre de la sesión del 16/11)

Pendientes que quedan después de la etapa 1, en orden sugerido:

1. [ ] **Persistir el adjunto al llegar (riesgo nuevo).** El OpenAPI indica que Meta descarta el medio entrante tras un plazo y que después el endpoint responde 400 para siempre. Hoy `lib/ai/media.ts` no guarda bytes: el triaje los baja en el momento (bien), pero **cada vista en el CRM vuelve a bajarlos de Zernio**, así que un audio viejo podría no reproducirse aunque la transcripción sí esté guardada en `message_derivations`. Propuesta: guardar el archivo en Supabase Storage (bucket privado) en la ingesta o en el triaje, y servir desde ahí.
2. [ ] Probar con un adjunto real (audio, foto, video, PDF) y con `ai_usage_logs`, en cuanto haya staging o un número de prueba. Es el bloque de verificaciones de arriba.
3. [ ] Aplicar `0026` y comprobar la base de producción. Depende de tener acceso al proyecto correcto.
4. [ ] Commitear la etapa 1 (decisión del usuario).
5. [ ] Etapa 2: `lead_source`, vínculo anuncio→propiedad, códigos de portal, búsqueda web como respaldo, resolvedor único y etiquetas automáticas.

**Verificado en esta sesión (16/11):** `typecheck`, `lint` (archivos tocados), `npm test` y `npm run build`, todos en verde.

## Lo que sigue (de la etapa 1 a la 2)

- [ ] Etapa 2: `lead_source` separado del canal, vínculo anuncio → propiedad, códigos de portal en la propiedad, **búsqueda en la web cuando la propiedad no está en la base**, resolvedor único (cartera o red) y etiquetas automáticas.
- [ ] Etapa 3: propiedades de la red en el bot, motor de compatibilidad compartido, corredor responsable y avisos configurables.
- [ ] Etapas 4 a 7: respuestas con adjuntos y botones, contenido por propiedad (audios y textos fijos), automatizaciones con campañas en frío (número comercial de Cowin) y rediseño de pantallas.
