#!/usr/bin/env bash
# D38: aplica al cliente `sses-web` de un realm ya importado las URIs relativas al mismo origen
# (el import de Keycloak no sobrescribe un realm existente). Idempotente. Requiere el stack arriba.
set -euo pipefail
export MSYS_NO_PATHCONV=1  # Git Bash en Windows: no reescribir las rutas del contenedor
cd "$(dirname "$0")/.."
docker compose exec -T keycloak bash -c '
  set -e
  K=/opt/keycloak/bin/kcadm.sh; C=/tmp/kcadm.config
  $K config credentials --config $C --server http://localhost:8080 --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null
  ID=$($K get clients --config $C -r sses -q clientId=sses-web --fields id --format csv --noquotes)
  $K update clients/$ID --config $C -r sses -s "rootUrl=\${authBaseUrl}" -s "redirectUris=[\"/*\",\"http://localhost:5173/*\",\"http://localhost:5174/*\"]" -s "webOrigins=[\"+\"]" -s "attributes.\"post.logout.redirect.uris\"=+"
  echo "Cliente sses-web: URIs del mismo origen aplicadas."
'
