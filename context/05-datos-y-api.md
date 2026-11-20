# 05 · Modelo de datos y API

Fuente: RQ_002, RQ_005–RQ_008, RQ_010–RQ_012, RQ_026. Convención: PK `id bigint generated always as identity`, `public_id uuid` (v7, generado en la API) único, `snake_case` sin tildes, timestamps `timestamptz` UTC.

## Esquemas y tablas

### `maestros` — información existente del Ministerio (la API solo tiene SELECT)

| Tabla | Columnas clave | Notas |
|---|---|---|
| `region` | id, nombre | Caribe, Pacífico, Andina, Orinoquía, Amazonía, Bogotá D. C. |
| `municipio` | id, region_id, nombre, codigo_dane | |
| `entidad` | id, public_id, nombre, municipio_id, activa | ejecutoras de estrategias |
| `sede` | id, nombre, municipio_id | sede educativa |
| `estudiante` | id, public_id, huella_documento `bytea(32)` UNIQUE, tipo_documento_cif, numero_documento_cif, nombres_cif, fecha_nacimiento_cif (`bytea`, AES-GCM con nonce embebido), nombre_visible, sede_id | **Particionada `HASH(id)` en 16 particiones** (RQ_002). `nombre_visible` = "Nombre A." (minimización) |
| `tutor` | id, public_id, nombres, correo, municipio_id | Tutores líderes |
| `docente` | id, public_id, nombres, correo, sede_id | Tutores docentes |

> Con particionado por HASH(id), el UNIQUE sobre `huella_documento` no puede ser global. Solución MVP: tabla índice `maestros.estudiante_huella(huella bytea PK, estudiante_id bigint)`. Documentarlo si se pregunta.

### `seguridad`

| Tabla | Columnas | Notas |
|---|---|---|
| `participante` | id, public_id, keycloak_sub UNIQUE, correo, rol, persona_tipo (`TUTOR`/`DOCENTE`/`FUNCIONARIO`), persona_id, ultimo_ingreso, ingreso_actual | Se enlaza por correo/atributo `persona_id` en el primer login |
| `gestor_entidad` | participante_id, entidad_id | Qué entidades administra cada gestor |

### `estrategias`

```sql
create table estrategias.estrategia (
  id bigint generated always as identity primary key,
  public_id uuid not null unique,
  entidad_id bigint not null references maestros.entidad(id),
  nombre varchar(150) not null,
  objetivo varchar(2000) not null,
  poblacion varchar(300) not null,
  fecha_inicio date not null,
  fecha_fin date not null check (fecha_fin > fecha_inicio),
  estado text not null default 'EDITABLE' check (estado in ('EDITABLE','BLOQUEADA')),
  estudiantes_vinculados int not null default 0,
  creado_por bigint not null, creado_en timestamptz not null default now(),
  actualizado_en timestamptz
);
create unique index ux_estrategia_entidad_nombre on estrategias.estrategia (entidad_id, lower(nombre));

create table estrategias.estrategia_estudiante (
  estrategia_id bigint not null references estrategias.estrategia(id),
  estudiante_id bigint not null,
  vinculado_por bigint not null, vinculado_en timestamptz not null default now(),
  primary key (estrategia_id, estudiante_id)
);
```

**Trigger de bloqueo (RQ_007)** — `BEFORE UPDATE` en `estrategia`: si cambia cualquiera de `entidad_id, nombre, objetivo, poblacion, fecha_inicio, fecha_fin` y existe al menos una fila en `estrategia_estudiante` para ese id → `RAISE EXCEPTION 'ESTRATEGIA_BLOQUEADA' USING ERRCODE = 'P0001'`. Permite cambiar `estado` y `estudiantes_vinculados`.
**Trigger de vínculo** — `AFTER INSERT` en `estrategia_estudiante` (statement-level con transition table): incrementa `estudiantes_vinculados` y pone `estado='BLOQUEADA'`.

### `acompanamiento`

| Tabla | Columnas | Notas |
|---|---|---|
| `asignacion` | tutor_id, docente_id, estrategia_id, vigente | Precargada. PK (tutor_id, docente_id, estrategia_id) |
| `plan` | id, public_id, tutor_id, estrategia_id, mes `char(7)` 'AAAA-MM', modalidad (`INDIVIDUAL`/`GRUPAL`), temas, creado_en | |
| `plan_docente` | plan_id, docente_id, tutor_id, mes | UNIQUE (tutor_id, docente_id, mes) → 409 `PLAN_DUPLICADO` |
| `hito_semanal` | id, public_id, plan_id, numero_semana 1..5, semana_iso 'AAAA-Www', fecha_inicio, fecha_fin, estado, actualizado_en | `xmin` como versión |
| `seguimiento_semanal` | id, public_id, hito_id UNIQUE, actividades varchar(4000), avances varchar(4000), origen (`EN_LINEA`/`SIN_CONEXION`), capturado_en (hora del dispositivo), registrado_en, registrado_por | **Particionada RANGE mensual** por `registrado_en`; en el MVP particiones declarativas creadas por script (prod: pg_partman + pg_cron) |
| `asistencia_seguimiento` | seguimiento_id, docente_id, asistio bool | |
| `evidencia` | id, seguimiento_id, uri, tipo_mime, bytes, sha256 | Archivo en `./data/evidencias/{public_id}.webp` |
| `idempotencia` | clave uuid PK, endpoint, respuesta_status, respuesta_cuerpo jsonb, creado_en | Retención 7 días |

Cumplimiento de un mes para un tutor = `count(hitos REGISTRADA) / count(hitos)` de sus planes del mes, 2 decimales.

### `auditoria`

```sql
create table auditoria.bitacora (
  id bigint generated always as identity,
  fecha_utc timestamptz not null default now(),
  usuario text not null, rol text not null, ip inet,
  accion text not null,            -- LOGIN, CREAR_ESTRATEGIA, EDITAR_ESTRATEGIA, BUSCAR_ESTUDIANTE, VINCULAR, PROGRAMAR_PLAN, REGISTRAR_SEGUIMIENTO, SINCRONIZAR, CONFLICTO_RESUELTO
  entidad text, entidad_id text,
  antes jsonb, despues jsonb,
  traceparent text,
  hash_anterior bytea, hash bytea not null,
  primary key (id, fecha_utc)
) partition by range (fecha_utc);
```

- `hash = sha256(hash_anterior || fila_canonica)`. Calcular en la API dentro de la transacción con `pg_advisory_xact_lock` para serializar la cadena (o en un trigger `BEFORE INSERT`, más simple).
- Grants: `sses_api` solo `INSERT, SELECT` en `auditoria.bitacora`. Ni UPDATE ni DELETE.
- Función `auditoria.verificar_cadena()` que recorre y devuelve OK / primer id roto. Endpoint de demo para mostrarla.
- **Nunca** guardar documento ni nombres completos del estudiante en `antes/despues`: solo `public_id`.

## Índices para volumen

- `maestros.estudiante_huella (huella)` PK → búsqueda O(log n).
- `estrategia_estudiante (estrategia_id, estudiante_id)` PK sirve para listado keyset.
- `plan_docente (tutor_id, mes)`, `hito_semanal (plan_id, numero_semana)`.

## API `/api/v1` (contrato MVP)

Todas exigen `Authorization: Bearer`. Errores en Problem Details con `code`.

### Sesión y contexto
| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| POST | `/sesion/inicio` | cualquiera | Registra LOGIN, actualiza último ingreso. `200 {nombre, rol, ultimoIngreso, menu[]}` |
| GET | `/me` | cualquiera | Igual sin registrar |
| GET | `/auditoria/verificacion` | cualquiera (demo) | `{ok, filas, primerIdRoto?}` |
| GET | `/auditoria/recientes?limite=20` | cualquiera (demo, filtrado al propio usuario) | últimos eventos |

### Estrategias (RQ_006, RQ_007, RQ_008)
| Método | Ruta | Detalle |
|---|---|---|
| GET | `/entidades` | Entidades activas del gestor |
| GET | `/estrategias?entidadId=&estado=&despuesDe=` | Keyset, 50 por página |
| POST | `/estrategias` | `{entidadId, nombre, objetivo, poblacion, fechaInicio, fechaFin}` → `201` + `Location` + `ETag`. `400` validación, `403`, `409 NOMBRE_DUPLICADO`, `422 ENTIDAD_INACTIVA` |
| GET | `/estrategias/{id}` | `{..., estado, editable, estudiantesVinculados}` + `ETag` |
| PUT | `/estrategias/{id}` | `If-Match` obligatorio. `200`, `409 ESTRATEGIA_BLOQUEADA`, `412 VERSION_CAMBIADA`, `428` sin If-Match |
| GET | `/estudiantes?tipoDoc=&numDoc=` | `200 {id, nombre, sede, municipio}` o `404`. Incluye cabecera `Server-Timing: db;dur=…` para mostrar velocidad |
| GET | `/estrategias/{id}/estudiantes?despuesDe=` | Vinculados, keyset 50 |
| POST | `/estrategias/{id}/estudiantes` | `{estudianteIds: uuid[] (máx 200)}` → `201 {vinculados, yaVinculados}`. Usa `INSERT ... ON CONFLICT DO NOTHING`. `404 ESTUDIANTE_NO_ENCONTRADO`, `422 ESTRATEGIA_FUERA_DE_VIGENCIA` |

Transacción de edición (RQ_007): `READ COMMITTED`, `SELECT ... FROM estrategia WHERE id=@id FOR UPDATE`, comparar xmin con If-Match, comparar `estudiantes_vinculados = 0`, `UPDATE`, bitácora, commit. Si el trigger dispara P0001 → mapear a 409.

### Acompañamiento (RQ_010, RQ_011)
| Método | Ruta | Detalle |
|---|---|---|
| GET | `/tutores/me/docentes` | Docentes asignados agrupados por estrategia |
| POST | `/acompanamientos` | `{mes, modalidad, estrategiaId, docenteIds[], temas, semanas[]}` → `201` con plan(es) e hitos `PROGRAMADA`. `409 PLAN_DUPLICADO`, `422 DOCENTE_NO_ASIGNADO`/`SEMANA_FUERA_DEL_MES`/`GRUPO_EXCEDE_30` |
| GET | `/tutores/me/plan?mes=AAAA-MM` | Plan completo del mes (planes, hitos con versión, docentes, seguimientos, cumplimiento) + `ETag`. Es lo que el front guarda en IndexedDB |
| GET | `/hitos/{id}` | Hito + docentes + versión |
| POST | `/evidencias` | multipart, 1 imagen ≤ 1 MB JPEG/WebP → `201 {evidenciaId, uri}` (sustituye URL SAS) |
| PUT | `/hitos/{id}/seguimiento` | `If-Match`. `{asistencia:[{docenteId, asistio}], actividades, avances, evidenciaIds[]}` → `200 {cumplimientoMes}`. `409 SEMANA_CERRADA`, `412` |

### Sincronización (RQ_012)
| Método | Ruta | Detalle |
|---|---|---|
| POST | `/sincronizacion/seguimientos` | Lote ≤ 50. Cada ítem: `{idempotencyKey, hitoId, versionBase, capturadoEn, asistencia, actividades, avances, evidencias:[{nombre, base64}]}`. Respuesta por ítem: `{idempotencyKey, estado: APLICADO|DUPLICADO|CONFLICTO|RECHAZADO, cumplimientoMes?, versionServidor?, registroServidor?}`. Ítems con más de 30 días → `RECHAZADO` |

Detalle de reglas en `06-offline-sync.md`.

### Desempeño e informe mensual del Tutor Líder (D40, D41)
| Método | Ruta | Detalle |
|---|---|---|
| GET | `/tutores/me/desempeno?meses=6` | Solo `TUTOR_LIDER`. Por mes: programadas, registradas, confirmadas, observadas, `enLinea`/`sinConexion`, docentes atendidos, cumplimiento y regularidad; indicadores del periodo; `porRegistrar` (5 más recientes) y `totalPorRegistrar`. Bitácora `CONSULTAR_DESEMPENO` |
| POST | `/tutores/me/informe-mensual` | `{mes}` → `200 {id, codigo, huella, mes, descarga}`; `422 MES_SIN_PLAN`. PDF/A-2b con el mismo generador de los reportes de ley; tabla `reportes.informe_mensual` (`05-informe-mensual.sql`, sin RLS, filtrada por participante). Bitácora `GENERAR_INFORME_MENSUAL` |
| GET | `/tutores/me/informe-mensual/{id}/pdf` | Solo el tutor que lo emitió (404 para otros) |

`reportes.verificar(codigo)` une emisiones de ley e informes mensuales: `GET /reportes-ley/verificar/{codigo}` valida ambos. La URL de verificación impresa en el PDF sale del origen de la petición (`X-Forwarded-Host/Proto` de nginx) salvo que se configure `Reportes:UrlVerificacion`.

### Mesa de ayuda (RQ_020, D31)
| Método | Ruta | Detalle |
|---|---|---|
| POST | `/incidentes` | Cualquier rol. `{tipo: BLOQUEANTE|FUNCIONAL|CONSULTA, descripcion (máx 2.000), pantalla, navegador, traceparent}` → `201 {numero: INC-AAAA-NNNNNN, severidad, estado: ABIERTO}`. Severidad: Bloqueante = Alta, Funcional = Media, Consulta = Baja. Tabla `mesa.incidente` (`03-mesa.sql`) |
| GET | `/incidentes/mios` | 'Mis casos': solo los del usuario, últimos 50 |
