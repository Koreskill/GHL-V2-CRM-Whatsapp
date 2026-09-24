# Modelo de datos — CRM inmobiliario multi-tenant con red de propiedades

> Estado: **diseño propuesto** (aún no implementado en `src/db/schema.ts`).
> Este documento es la fuente de verdad del modelo de datos que vamos a construir
> por fases. Los campos y nombres siguen las convenciones actuales del proyecto
> (uuid `defaultRandom`, `snake_case`, `timestamps` con timezone, `jsonb` para
> metadata). Fecha de diseño: 2026-09-24.

## 1. Principios que no se pueden romper

Estos invariantes son la razón de ser del diseño. Romperlos no da un error: filtra
datos de un cliente a otro o pierde mensajes en silencio.

1. **El tenant real es `organization_id` (la inmobiliaria).** *Toda* fila de datos
   transaccionales lleva `organization_id` y *toda* query se filtra por él.
2. **La red comparte inventario, nunca contactos ni conversaciones.** Una red
   (ej: Cowin) habilita un catálogo compartido de propiedades. No es "padre" de sus
   miembros: no hereda acceso a sus datos privados.
3. **`owner_organization_id` de una propiedad publicada nunca cambia.** Compartir
   una propiedad en la red publica una *proyección* con solo los campos comerciales,
   no abre acceso a la fila privada del dueño.
4. **La identidad es `(organization_id, channel, external_id)`, no el teléfono.**
   Dos inmobiliarias pueden hablarle al mismo teléfono como contactos distintos.
5. **La conversación y su perfil de prospecto nunca salen del tenant.** El motor de
   matching compara el *perfil estructurado* contra el catálogo de red; nunca expone
   la conversación fuera de la inmobiliaria.
6. **Las claves de IA viven solo server-side.** Nunca en tablas expuestas al cliente.

## 2. Enums nuevos

```
operation_type       = venta | alquiler | temporario
property_type        = departamento | casa | ph | terreno | local | oficina | cochera | otro
property_status      = borrador | disponible | reservada | vendida | alquilada | pausada
listing_status       = publicada | pausada | retirada
presentation_status  = presentada | visita_solicitada | visita_agendada | negociando | cerrada_ganada | cerrada_perdida | cancelada
match_status         = sugerida | presentada | descartada
ai_function          = conversacional | extraccion | calificacion | fallback
ai_call_status       = ok | error | timeout
member_role          = admin | agente          -- rol dentro de una inmobiliaria
network_member_status= activa | invitada | suspendida
```

(Se mantienen los enums actuales: `channel`, `provider`, `message_direction`,
`message_status`.)

## 3. Núcleo de tenancy

### `organizations` — la inmobiliaria (tenant)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| slug | text NOT NULL UNIQUE | identificador legible |
| status | text NOT NULL default `activa` | activa / suspendida |
| metadata | jsonb NOT NULL default `{}` | branding, config no sensible |
| created_at, updated_at | timestamptz | |

### `networks` — la red (ej: Cowin)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| slug | text NOT NULL UNIQUE | |
| status | text NOT NULL default `activa` | |
| metadata | jsonb NOT NULL default `{}` | |
| created_at, updated_at | timestamptz | |

### `network_members` — membresía inmobiliaria ↔ red
La red **no** hereda acceso; esta tabla solo dice quién puede ver/publicar en el catálogo.
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| network_id | uuid NOT NULL → networks | |
| organization_id | uuid NOT NULL → organizations | |
| status | network_member_status NOT NULL default `invitada` | |
| collaboration_terms | jsonb NOT NULL default `{}` | reparto de comisión por defecto, condiciones |
| joined_at | timestamptz | |
| created_at, updated_at | timestamptz | |

**Único:** `(network_id, organization_id)`.

### `organization_members` — usuario ↔ inmobiliaria
Mapea un usuario de Supabase Auth a su inmobiliaria y su rol. Reemplaza al
`crm_role` plano de hoy (que pasa a resolverse por org).
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL | = `auth.users.id` |
| organization_id | uuid NOT NULL → organizations | |
| role | member_role NOT NULL default `agente` | |
| created_at, updated_at | timestamptz | |

**Único:** `(user_id, organization_id)`. Un usuario puede pertenecer a más de una
inmobiliaria (poco común, pero soportado).

### Plano de control de la agencia
El administrador de la agencia opera en un plano separado con **cambio de contexto
explícito**. Se modela con un flag en `app_metadata` (`is_agency_admin: true`,
solo escribible por SQL/service key) más registro de auditoría. No es miembro de las
inmobiliarias: cuando "entra" a una, lo hace pasando un `organization_id` explícito
que queda auditado.

### `audit_logs` — auditoría del plano de control
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| actor_user_id | uuid NOT NULL | quién actúa |
| acting_as_organization_id | uuid → organizations | contexto en el que actuó |
| action | text NOT NULL | ej: `context_switch`, `config_change` |
| target | text | recurso afectado |
| metadata | jsonb NOT NULL default `{}` | |
| created_at | timestamptz | |

## 4. Cambios a las tablas existentes

Todas las tablas de CRM actuales suman `organization_id uuid NOT NULL → organizations`
y sus reglas de unicidad pasan a ser **por tenant**:

| Tabla | Cambio de unicidad |
|---|---|
| `contacts` | + `organization_id` |
| `contact_identities` | único `(channel, external_id)` → `(organization_id, channel, external_id)` |
| `channel_accounts` | único `external_id` → `(organization_id, external_id)` |
| `conversations` | único `(provider, external_id)` → `(organization_id, provider, external_id)` |
| `messages` | único parcial `external_id` → `(organization_id, external_id) WHERE external_id IS NOT NULL` |
| `agent_configs` | PK `scope` → PK `(organization_id, scope)` |
| `webhook_events` | queda global (ledger de dedupe por id de evento del proveedor); se puede taggear con `organization_id` para observabilidad |

**Ruteo entrante:** el webhook no tiene usuario logueado. El tenant se resuelve desde
`channel_accounts.organization_id` (la cuenta de Zernio pertenece a una inmobiliaria).
`ingest.ts` ya busca la cuenta por `external_id`; de ahí sale el `organization_id`
que se propaga a contacto, conversación y mensaje. **Onboarding de una inmobiliaria =
crear sus `channel_accounts` con el `organization_id` correcto** → el ruteo es automático.

## 5. Propiedades

### `properties` — la propiedad privada del tenant (dato completo)
Contiene TODO, incluida la información reservada que **nunca** se comparte.
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL → organizations | |
| owner_contact_id | uuid → contacts | el propietario, como contacto del tenant |
| operation | operation_type NOT NULL | |
| property_type | property_type NOT NULL | |
| status | property_status NOT NULL default `borrador` | |
| title | text | |
| description | text | descripción comercial (compartible) |
| price | numeric(14,2) | |
| currency | text NOT NULL default `USD` | |
| address_full | text | **privado** (dirección exacta) |
| zone | text | barrio/zona (compartible) |
| city | text | |
| lat, lng | numeric | ubicación aproximada para la red |
| bedrooms, bathrooms | integer | |
| area_m2 | numeric | |
| features | jsonb NOT NULL default `{}` | cochera, amenities, etc. |
| photos | jsonb NOT NULL default `[]` | URLs (compartible) |
| internal_notes | text | **privado** — nunca sale del tenant |
| documents | jsonb NOT NULL default `[]` | **privado** — escrituras, etc. |
| metadata | jsonb NOT NULL default `{}` | |
| created_at, updated_at | timestamptz | |

Índices: `(organization_id, status)`, `(organization_id, operation, property_type)`.

### `network_property_listings` — proyección compartida en la red
La versión visible en red. Solo campos comerciales. **Compartir = crear/actualizar
esta fila**, no abrir acceso a `properties`.
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| network_id | uuid NOT NULL → networks | |
| property_id | uuid NOT NULL → properties | referencia interna (no visible a otros) |
| owner_organization_id | uuid NOT NULL → organizations | **fijo, nunca cambia** |
| operation | operation_type NOT NULL | |
| property_type | property_type NOT NULL | |
| price | numeric(14,2) | |
| currency | text NOT NULL default `USD` | |
| zone, city | text | ubicación **aproximada**, sin `address_full` |
| lat, lng | numeric | |
| bedrooms, bathrooms | integer | |
| area_m2 | numeric | |
| features | jsonb NOT NULL default `{}` | |
| photos | jsonb NOT NULL default `[]` | |
| commercial_description | text | |
| availability | text NOT NULL default `disponible` | espejo comercial del estado |
| presentation_link | text | link de presentación para el prospecto |
| collaboration_terms | jsonb NOT NULL default `{}` | reparto de comisión de esta propiedad |
| status | listing_status NOT NULL default `publicada` | |
| published_at | timestamptz | |
| created_at, updated_at | timestamptz | |

**Único:** `(network_id, property_id)`. Regla de sincronización: los campos privados
de `properties` (`address_full`, `internal_notes`, `documents`, `owner_contact_id`)
**nunca** se copian acá.

## 6. Prospectos y matching

### `prospect_requirements` — perfil estructurado del prospecto
Lo extrae la IA de la conversación. **Nunca sale del tenant.**
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL → organizations | |
| contact_id | uuid NOT NULL → contacts | |
| conversation_id | uuid → conversations | origen |
| operation | operation_type | |
| property_types | jsonb NOT NULL default `[]` | tipos aceptados |
| zones | jsonb NOT NULL default `[]` | zonas de interés |
| bedrooms_min, bathrooms_min | integer | |
| price_min, price_max | numeric(14,2) | |
| currency | text default `USD` | |
| area_min | numeric | |
| must_have | jsonb NOT NULL default `[]` | requisitos excluyentes |
| nice_to_have | jsonb NOT NULL default `[]` | deseables |
| raw_extraction | jsonb | salida cruda del modelo |
| confidence | numeric | 0–1, confianza de la extracción |
| status | text NOT NULL default `activo` | activo / cerrado |
| created_at, updated_at | timestamptz | |

### `property_matches` — resultado del cruce
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL → organizations | tenant del prospecto |
| prospect_requirement_id | uuid NOT NULL → prospect_requirements | |
| network_property_listing_id | uuid NOT NULL → network_property_listings | |
| score | numeric NOT NULL | 0–1 |
| reasons | jsonb NOT NULL default `[]` | `[{factor, peso, detalle}]` |
| status | match_status NOT NULL default `sugerida` | |
| created_at | timestamptz | |

**Único:** `(prospect_requirement_id, network_property_listing_id)`.

## 7. Atribución comercial

### `property_presentations` — quién aportó qué
Es el **único** punto donde se tocan dos tenants, y solo con IDs + estado +
condiciones comerciales. Sin datos privados de ninguno de los dos.
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| network_id | uuid NOT NULL → networks | |
| network_property_listing_id | uuid NOT NULL → network_property_listings | |
| owner_organization_id | uuid NOT NULL → organizations | dueño de la propiedad |
| presenting_organization_id | uuid NOT NULL → organizations | quien presenta al prospecto |
| prospect_contact_id | uuid NOT NULL → contacts | contacto en el tenant que presenta |
| prospect_requirement_id | uuid → prospect_requirements | |
| match_id | uuid → property_matches | |
| status | presentation_status NOT NULL default `presentada` | |
| presented_at | timestamptz NOT NULL defaultNow | |
| visit_requested_at | timestamptz | |
| owner_notified_at | timestamptz | **null hasta que el prospecto pide visita** |
| commission_terms | jsonb NOT NULL default `{}` | snapshot de condiciones al presentar |
| metadata | jsonb NOT NULL default `{}` | |
| created_at, updated_at | timestamptz | |

**Regla de negocio:** la inmobiliaria que presenta una propiedad ajena **no** notifica
al propietario en ese momento. `owner_notified_at` se completa recién cuando `status`
pasa a `visita_solicitada`. La coordinación ocurre ahí, no antes.

## 8. Capa de IA (OpenRouter)

Todas las llamadas a IA pasan por un servicio interno; nunca directo al proveedor
desde la automatización. OpenRouter es la capa de acceso multi-modelo.

### `ai_model_configs` — modelo por inmobiliaria y función
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL → organizations | |
| function | ai_function NOT NULL | conversacional / extraccion / calificacion / fallback |
| provider | text NOT NULL default `openrouter` | |
| model | text NOT NULL | slug de OpenRouter (ej: `openai/gpt-4.1-mini`) |
| params | jsonb NOT NULL default `{}` | temperature, max_tokens, etc. |
| priority | integer NOT NULL default 0 | orden de fallback (menor primero) |
| enabled | boolean NOT NULL default true | |
| created_at, updated_at | timestamptz | |

**Único:** `(organization_id, function, priority)`. Permite cadena de fallback por
función. Las **claves** de OpenRouter NO van acá: viven en env server-side; esta tabla
solo elige proveedor/modelo/params.

### `ai_usage_logs` — registro de cada request
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL → organizations | |
| function | ai_function NOT NULL | |
| provider | text NOT NULL | |
| model | text NOT NULL | |
| prompt_tokens, completion_tokens, total_tokens | integer | |
| cost_usd | numeric(12,6) | |
| latency_ms | integer | |
| status | ai_call_status NOT NULL | |
| error | text | sin datos personales (usar `safeError`) |
| request_ref | jsonb | ej: `{conversationId, messageId}` |
| created_at | timestamptz | |

Índice: `(organization_id, created_at)`.

## 9. Aislamiento y RLS

Dos capas (defensa en profundidad):

1. **Filtro a nivel app:** cada query de tabla de tenant agrega
   `eq(tabla.organizationId, orgId)`. El `organizationId` viaja en el contexto de
   request (resuelto desde la sesión vía `organization_members`, o desde
   `channel_accounts` en el webhook).
2. **RLS en Postgres** como red de seguridad, por si se olvida un `.where()`. Como la
   app usa un solo rol `crm_app` sobre el pooler de transacciones, se setea un GUC por
   transacción:
   ```sql
   -- en cada unidad de trabajo con tenant:
   SET LOCAL app.current_org = '<organization_id>';
   -- política:
   USING (organization_id = current_setting('app.current_org', true)::uuid)
   ```
   Reemplaza el `USING (true)` actual de `crm_app_all` (migración 0002).

**Tablas de red (excepción al aislamiento puro):** `networks`, `network_members`,
`network_property_listings`, `property_matches`, `property_presentations` tienen reglas
de visibilidad propias:
- Un miembro ve los `network_property_listings` de las redes donde está activo, pero
  solo las columnas compartibles (la tabla ya no tiene columnas privadas).
- `property_presentations` es legible por **ambas** organizaciones involucradas
  (`owner_organization_id` y `presenting_organization_id`).
- `property_matches` es privado del tenant del prospecto (`organization_id`).

**Toda tabla nueva:** RLS habilitada + GRANT/política solo para `crm_app`, nunca para
`anon`/`authenticated` (regla vigente del proyecto, migración 0003).

## 10. Mapa de relaciones

```
organizations 1─┬─* organization_members *─1 auth.users
                ├─* channel_accounts ─* conversations ─* messages
                ├─* contacts ─* contact_identities
                ├─* properties ─* network_property_listings *─1 networks
                ├─* prospect_requirements ─* property_matches *─1 network_property_listings
                ├─* agent_configs (PK org+scope)
                ├─* ai_model_configs
                └─* ai_usage_logs

networks 1─* network_members *─1 organizations
networks 1─* network_property_listings   (owner_organization_id fijo)
property_presentations  ──> owner_organization_id + presenting_organization_id
                        ──> network_property_listing_id, prospect_contact_id
```

## 11. Camino de implementación por fases

Sin avanzar si la fase previa no compila (`typecheck`, `lint`, `build`).

1. ✅ **Tenancy base (HECHA — migración `0004_multi_tenant`):** `organizations`,
   `networks`, `network_members`, `organization_members`, `audit_logs`. Crea las
   tablas, inserta la org por defecto (`00000000-0000-0000-0000-000000000001`,
   "Kore Inmobiliaria"), backfillea `organization_id` en las tablas actuales, `NOT NULL`,
   y agrega los índices únicos por tenant. Datos actuales = inmobiliaria #1. Los dos
   usuarios admin quedaron con `organization_id` en `app_metadata` + fila en
   `organization_members`.
2. ✅ **Filtrado por tenant en la app (HECHA):** `organizationId` en la sesión
   (`auth.ts`: `orgOf`, `getSession` cacheada, `requireOrgId`), propagado a todas las
   queries (`inbox/queries.ts`, `crm/queries.ts`, `agent/config.ts`, `agent/run.ts`),
   a la ingesta (`ingest.ts` lo resuelve desde `channel_accounts.organization_id`),
   a `deliverMessage` (guard de tenant) y a páginas/rutas/actions. **RLS por tenant
   (SET LOCAL) todavía NO**: el aislamiento hoy es a nivel app; el RLS es el
   endurecimiento siguiente.
3. **Propiedades:** `properties` + `network_property_listings` + flujo de publicar en
   red (proyección de campos compartibles).
4. **Capa de IA OpenRouter:** cliente interno único, `ai_model_configs`,
   `ai_usage_logs`; migrar el motor del agente de OpenAI directo a este servicio.
5. **Prospectos y matching:** `prospect_requirements` (extracción con IA),
   motor de `property_matches`.
6. **Atribución:** `property_presentations` + regla de notificación al dueño en
   `visita_solicitada`.
7. **Plano de agencia:** cambio de contexto explícito + auditoría; vistas
   cross-tenant para el admin de la agencia.

### Puente de transición (Fases 1–2) y endurecimiento

Para no romper la app YA deployada al aplicar la migración en producción:

- `organization_id` nace con **DEFAULT = org por defecto**, así el código viejo (que
  todavía no manda `organization_id`) sigue insertando, y los datos existentes se
  backfillean solos.
- Los **índices únicos globales viejos** (`conversations_provider_external_id_key`,
  `messages_external_id_key`, `contact_identities_channel_external_id_key`,
  `channel_accounts_external_id_unique`) se **conservan** conviviendo con los por
  tenant, porque el código viejo los usa en sus `ON CONFLICT`. Con una sola org son
  igualmente únicos.
- Una vez deployado el código nuevo, correr **a mano** `drizzle/0005_harden_tenant_isolation.sql`:
  elimina esos índices viejos y quita el DEFAULT de `organization_id` (a partir de ahí,
  todo INSERT trae su org explícita o falla ruidosamente).
- El **RLS por tenant** (`SET LOCAL app.current_org` + políticas `USING
  (organization_id = current_setting(...))`) es un paso posterior, ya con el filtrado
  a nivel app validado en producción.

## 12. Notas y decisiones abiertas

- **OpenRouter reemplaza a OpenAI directo** (decisión del 2026-09-24, revierte la
  regla previa de CLAUDE.md). Al implementar la fase 4 hay que actualizar CLAUDE.md.
- **Credenciales de Zernio por inmobiliaria:** hoy no hay tabla de secretos por org.
  Si cada inmobiliaria tiene su propio workspace/claves de Zernio, hace falta un
  almacén de config por org (server-side). Pendiente de definir.
- **Campos de propiedad** (`property_type`, `features`) son un punto de partida
  razonable para el mercado argentino; ajustar según el catálogo real.
- Los tipos/valores de enums y precisiones numéricas son propuestas; confirmar con
  el negocio antes de la migración 1.
