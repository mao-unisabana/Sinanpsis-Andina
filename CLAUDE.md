# SSES MVP — Sinapsis Andina S.A.S.

MVP demostrable del **Piloto del Sistema de Seguimiento de Actividades Extracurriculares (SSES)** para el
Ministerio de Educación Nacional (caso académico). Es el software que se muestra **en vivo** en la
presentación comercial del parcial (30 de 100 puntos de la rúbrica). Lo que se construye aquí debe
coincidir con lo que la propuesta de Sinapsis Andina ya vendió: mismos actores, mismas reglas, mismos
nombres de pantallas y la misma arquitectura (con las sustituciones locales de `context/decisiones.md`).

## Qué demuestra el MVP (no más, no menos)

Definido en la propuesta, §15.1 "MVP: cierre del Sprint 3":

1. **Acceso con segundo factor** (Keycloak 26.8.1, OIDC + PKCE, TOTP) y menú por rol — HU_002 / CU_002 / RQ_003, RQ_005
2. **Estrategias estudiantiles con bloqueo de edición** cuando ya tienen estudiantes — HU_003 / CU_003, CU_004 / RQ_006, RQ_007
3. **Vinculación de estudiantes existentes** por documento (huella HMAC, sin duplicados) — HU_004 / CU_005 / RQ_008
4. **Plan mensual del Tutor Líder** (individual/grupal, hitos semanales) — HU_005 / CU_006 / RQ_010
5. **Seguimiento semanal con evidencias, con y sin señal** (PWA offline + sincronización idempotente + conflictos) — HU_006 / CU_007 / RQ_011, RQ_012

Línea B (adelanto del Sprint 4, D31): botón **'Ayuda'** en todas las pantallas → caso `INC-AAAA-NNNNNN` con
contexto técnico y 'Mis casos' — HU_011 / CU_013 / RQ_020. El profesor exige que el MVP muestre las dos necesidades
macro del cliente: el software piloto (Línea A) y la ejecución del pilotaje (Línea B). El MVP debe estar
**desplegado con enlace web accesible** (D38: Keycloak en el mismo origen, basta exponer el puerto web por HTTPS) y **nunca** se presenta un video.

Adiciones para la presentación: **'Mi desempeño'** del Tutor Líder con **informe mensual en PDF verificable**
(D40, D41), **reapertura sin conexión** de la PWA (D39), y del stretch F9 la confirmación del Tutor Docente, el
tablero del Analista y los reportes de ley del Ente de Control.

Transversal: bitácora de auditoría inmutable (RQ_005), cifrado de datos del estudiante (RQ_026),
modelo de datos para millones de registros (RQ_002). Todo lo demás está **fuera de alcance** salvo que
se pida (ver `context/02-alcance-mvp.md`, sección "Stretch").

## Stack (fijo, viene de la propuesta §10)

- **Front-End:** React 19 + TypeScript 5.9 + Vite 7, PWA con Workbox 7 (`vite-plugin-pwa`), Dexie 4 sobre IndexedDB, `oidc-client-ts` 3, Tailwind CSS 4, Apache ECharts solo si se hace el stretch de analítica.
- **API:** ASP.NET Core 10 (C# 14), REST JSON en `/api/v1`, OpenAPI 3.1, errores Problem Details (RFC 9457), EF Core 10 + Npgsql, FluentValidation 12.
- **Identidad:** Keycloak 26.8.1 (realm `sses`, TOTP obligatorio).
- **Datos:** PostgreSQL 17.11 (esquemas `maestros`, `seguridad`, `estrategias`, `acompanamiento`, `auditoria`, `mesa`).
- **Local:** Docker Compose. Azure (Key Vault, Blob, Service Bus, Front Door) se sustituye localmente, ver `context/decisiones.md`.

## Estructura del repo (objetivo)

```
backend/Sses.Api/          API ASP.NET Core 10 (módulos por carpeta: Seguridad, Estrategias, Acompanamiento, Auditoria, Sincronizacion)
backend/Sses.Api.Tests/    xUnit
tools/Sses.Seed/           Generador de datos sintéticos (consola .NET)
frontend/                  React + Vite PWA
infra/keycloak/            realm-sses.json (import)
infra/postgres/            scripts SQL de init (triggers, RLS, grants, particiones)
tests/e2e/                 Playwright (recorrido de la demo)
docker-compose.yml
```

## Comandos

Requiere .NET 10 SDK (`export PATH=$HOME/.dotnet:$PATH`), Docker y Node 22. Copiar `.env.example` a `.env`.
Puertos del host (ver D10): Postgres 5433, Keycloak 8180, API 5080, web 5174.

- `docker compose up -d --build` — Postgres, Keycloak, API, web (`curl localhost:5080/health/ready`; web en http://localhost:5174)
- `dotnet run --project tools/Sses.Seed -c Release -- --estudiantes 500000` — datos sintéticos
- `npm --prefix frontend run dev` — front en desarrollo
- `dotnet test backend/Sses.sln` / `npm --prefix frontend test` / `npm --prefix tests/e2e test` (Playwright; requiere el stack arriba y `npx playwright install chromium`)
- `./scripts/reset-demo.sh` — (requiere el stack arriba) deja la base en el estado inicial del guion de demo y aplica los scripts SQL idempotentes posteriores (D32), siembra el historial del tutor demo (D42) y ajusta el cliente `sses-web` (D38)
- Despliegue público: exponer `http://localhost:5174` por HTTPS (p. ej. `cloudflared tunnel --url http://localhost:5174`); Keycloak va en el mismo origen (D38)

## Reglas de negocio que no se negocian

- Una estrategia **solo se edita si tiene 0 estudiantes vinculados**. Se garantiza en dos niveles: API (transacción + `SELECT ... FOR UPDATE` + If-Match/ETag) **y** trigger `BEFORE UPDATE` en PostgreSQL. El primer vínculo la pasa a `BLOQUEADA` en la misma transacción.
- Los datos maestros (estudiantes, docentes, tutores, entidades) **ya existen** en la BD del Ministerio: el piloto **solo los lee**. No hay pantallas para crearlos ni editarlos.
- Documento, nombres y fecha de nacimiento del estudiante se guardan cifrados (AES-256-GCM); la búsqueda es por huella HMAC-SHA-256. La API devuelve solo nombre, sede y municipio.
- Toda escritura, consulta de datos personales e inicio de sesión deja fila en `auditoria.bitacora` (solo inserción, cadena de hashes).
- El seguimiento sin conexión **no se pierde ni se duplica**: clave de idempotencia por registro, 409 con ambas versiones si el hito cambió.
- Cumplimiento del mes = semanas `REGISTRADA` / semanas `PROGRAMADA`.

## Convenciones

- Código (identificadores, tablas, endpoints) en **español sin tildes**, como en la propuesta: `estrategia_estudiante`, `/api/v1/estrategias`, `hito_semanal`.
- Textos de UI **exactamente** como en las HU (`'Nueva estrategia'`, `'Bloqueada para edición'`, `'Sin conexión: tus registros se guardarán en este dispositivo'`, `'Sincronizado'`…). Lista completa en `context/03-funcional.md`.
- IDs públicos UUID v7 en la API; PK internas `bigint identity`.
- Roles de realm: `ADMIN_FUNCIONAL, GESTOR_ESTRATEGIAS, TUTOR_LIDER, TUTOR_DOCENTE, ANALISTA_MEN, ENTE_CONTROL, COORDINADOR_PILOTO, SOPORTE`. El MVP usa los tres primeros de flujo + ADMIN para seed.
- Solo datos **sintéticos**. Nada de logos oficiales del Ministerio ni del Gobierno: la marca visible es Sinapsis Andina / SSES.
- Cada endpoint o regla nueva referencia en un comentario su RQ (`// RQ_007`), para poder sustentar la trazabilidad Necesidad → HU → CU → RQ en la presentación.

## Cómo trabajar en este repo

- Antes de implementar una fase, lee el archivo de `context/` correspondiente; si algo no está ahí, revisa `context/fuentes/propuesta-sinapsis-andina.txt` (fuente de verdad) antes de inventar.
- Avanza por las fases de `context/09-plan-y-qa.md` en orden; cada fase cierra con su criterio de terminado verificado.
- Prioriza que la demo funcione de punta a punta sobre la completitud. Si hay que recortar, recorta stretch, nunca los 5 puntos del MVP.
- No crees archivos `.md` de documentación adicionales; las explicaciones van en el chat. Solo se actualizan `CLAUDE.md` y `context/` cuando cambie una decisión.
- Si una decisión contradice la propuesta, regístrala en `context/decisiones.md` con su justificación (el jurado puede preguntar).

## Índice de contexto

| Archivo | Para qué |
|---|---|
| `context/01-caso-y-rubrica.md` | Pliego, rúbrica, qué evalúan en la presentación |
| `context/02-alcance-mvp.md` | Dentro / fuera / stretch, trazabilidad, criterios de aceptación |
| `context/03-funcional.md` | HU y CU del MVP, flujos, estados, textos de UI por pantalla |
| `context/04-arquitectura.md` | Componentes, módulos (diagrama de clases), compose, estructura |
| `context/05-datos-y-api.md` | Modelo de datos, triggers, RLS, contrato de endpoints |
| `context/06-offline-sync.md` | PWA, IndexedDB cifrado, cola de salida, conflictos |
| `context/07-seguridad.md` | Keycloak, TOTP, roles, bitácora, cifrado |
| `context/08-semilla-y-demo.md` | Datos sintéticos, usuarios demo, guion de la demo en vivo |
| `context/09-plan-y-qa.md` | Fases de implementación y pruebas del MVP |
| `context/decisiones.md` | Desviaciones respecto a la propuesta y por qué |
| `context/fuentes/` | PDFs originales + texto extraído de la propuesta |
