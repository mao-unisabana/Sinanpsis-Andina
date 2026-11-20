#!/usr/bin/env bash
# Deja la base en el estado inicial del guion de demo (no re-siembra estudiantes; la bitácora NO se borra: es inmutable).
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash en Windows: no reescribir las rutas del contenedor
cd "$(dirname "$0")/.."
PSQL="docker compose exec -T postgres psql -U postgres -d sses -v ON_ERROR_STOP=1 -q"
# Cambios de esquema posteriores al primer arranque (idempotentes): mesa de ayuda, permisos e informe mensual (D32, D41)
docker compose exec -T -e PGOPTIONS=--client-min-messages=warning postgres psql -U postgres -d sses -v ON_ERROR_STOP=1 -q -f /docker-entrypoint-initdb.d/03-mesa.sql
docker compose exec -T -e PGOPTIONS=--client-min-messages=warning postgres psql -U postgres -d sses -v ON_ERROR_STOP=1 -q -f /docker-entrypoint-initdb.d/05-informe-mensual.sql
$PSQL <<'SQL'
-- Transaccional del Tutor Líder demo (tutor_id = 1) del mes actual en adelante; su historial anterior se conserva (D42)
create temp table _planes as select id from acompanamiento.plan where tutor_id = 1 and mes >= to_char(now() at time zone 'America/Bogota', 'YYYY-MM');
create temp table _hitos  as select id from acompanamiento.hito_semanal where plan_id in (select id from _planes);
create temp table _segs   as select id from acompanamiento.seguimiento_semanal where hito_id in (select id from _hitos);
delete from acompanamiento.asistencia_seguimiento where seguimiento_id in (select id from _segs);
delete from acompanamiento.evidencia where seguimiento_id in (select id from _segs) or (seguimiento_id is null and subido_por = (select id from seguridad.participante where rol = 'TUTOR_LIDER' and persona_id = 1));
delete from acompanamiento.seguimiento_semanal where id in (select id from _segs);
delete from acompanamiento.confirmacion_docente where hito_id in (select id from _hitos);
delete from acompanamiento.hito_semanal where id in (select id from _hitos);
delete from acompanamiento.plan_docente where plan_id in (select id from _planes);
delete from acompanamiento.plan where id in (select id from _planes);
delete from acompanamiento.idempotencia;
-- Casos de la mesa de ayuda abiertos durante la demo
delete from mesa.incidente;
-- Informes mensuales emitidos durante la demo
delete from reportes.informe_mensual;
-- Estrategias creadas durante la demo (las precargadas son las 60 primeras)
delete from acompanamiento.asignacion where estrategia_id > 60;
delete from estrategias.estrategia_estudiante where estrategia_id > 60;
delete from estrategias.estrategia where id > 60;
SQL
# Historial del tutor demo en los 5 meses anteriores (idempotente) para "Mi desempeño" (D42)
$PSQL -f - < scripts/seed-historial-tutor.sql >/dev/null
rm -f data/evidencias/* 2>/dev/null || true
# D38: cliente sses-web con URIs del mismo origen (realms importados antes de este cambio)
bash scripts/actualizar-cliente-web.sh || echo "Aviso: no se pudo actualizar el cliente sses-web (¿Keycloak arriba?)"
# Limpia bloqueos de fuerza bruta de Keycloak (si está arriba)
KC=${KC_URL:-http://localhost:8180}
T=$(curl -sf -d "grant_type=password&client_id=admin-cli&username=${KEYCLOAK_ADMIN:-admin}&password=${KEYCLOAK_ADMIN_PASSWORD:-admin}" "$KC/realms/master/protocol/openid-connect/token" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])' 2>/dev/null || true)
[ -n "$T" ] && curl -sf -X DELETE -H "Authorization: Bearer $T" "$KC/admin/realms/sses/attack-detection/brute-force/users" >/dev/null || true
echo "Demo reiniciada."
