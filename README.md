# SSES · Piloto — Sinapsis Andina S.A.S.

MVP del Piloto del Sistema de Seguimiento de Actividades Extracurriculares (SSES), propuesto al Ministerio de Educación Nacional (caso académico, datos 100 % sintéticos).

**Línea A — software piloto:** ingreso con segundo factor y menú por rol · estrategias con bloqueo de edición cuando tienen estudiantes · vinculación por documento sin duplicados (huella HMAC, 500.000 estudiantes) · plan mensual del Tutor Líder · seguimiento semanal con evidencias, con y sin señal (PWA offline, sincronización idempotente y conflictos) · bitácora inmutable.
**Línea B — ejecución del pilotaje:** botón 'Ayuda' en todas las pantallas con número de caso y 'Mis casos'.

Stack: React 19 + Vite 7 (PWA, Workbox 7, Dexie 4) · ASP.NET Core 10 · Keycloak 26.8.1 · PostgreSQL 17.11 · Docker Compose.

## Arranque

```bash
cp .env.example .env
docker compose up -d --build                                   # web http://localhost:5174 · API :5080 · Keycloak :8180
dotnet run --project tools/Sses.Seed -c Release -- --estudiantes 500000
./scripts/reset-demo.sh                                        # estado inicial del guion de demo
```

Para publicarlo con un enlace accesible basta exponer el puerto web por HTTPS, por ejemplo `cloudflared tunnel --url http://localhost:5174`: el login (Keycloak) se sirve en el mismo origen, en `/realms`.

Usuarios demo (`gestor.demo@sinapsis.co`, `tutor.lider@sinapsis.co`), contraseña y secreto TOTP en `.env.example`.
Contexto, trazabilidad Necesidad → HU → CU → RQ y decisiones en [`context/`](context/).
