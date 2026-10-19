#!/usr/bin/env bash
# Consistent DB + file backup. Run from the deployment checkout during a maintenance window.
set -euo pipefail
umask 077
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DEST="${1:?usage: backup.sh /absolute/backup-directory}"
[[ "$DEST" = /* ]] || { echo 'backup path must be absolute' >&2; exit 1; }
mkdir -p "$DEST"
exec 9>"$DEST/.backup.lock"
flock -n 9 || { echo 'backup already running' >&2; exit 1; }
compose=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
api_id="${API_CONTAINER:-$("${compose[@]}" ps -q api)}"
postgres_id="${PG_CONTAINER:-$("${compose[@]}" ps -q postgres)}"
test -n "$api_id"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "$DEST/.stage.XXXXXXXX")"
restart() { docker start "$api_id" >/dev/null; }
trap restart EXIT
docker stop "$api_id" >/dev/null
docker exec "$postgres_id" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$stage/database.dump"
docker exec "$postgres_id" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT json_build_object('\''organizations'\'',(SELECT count(*) FROM org_organization),'\''projects'\'',(SELECT count(*) FROM prj_project),'\''files'\'',(SELECT count(*) FROM prj_file));"' > "$stage/counts.json"
mkdir "$stage/uploads"
docker cp "$api_id:/data/uploads/." "$stage/uploads/"
(cd "$stage" && find uploads -type f -print0 | sort -z | xargs -0 -r sha256sum > files.sha256 && sha256sum database.dump > database.sha256)
tar -C "$stage" -czf "$DEST/teamspace-$stamp.tar.gz" .
echo "Backup created: $DEST/teamspace-$stamp.tar.gz"
echo 'Contains tenant data. Store encrypted off-host with restricted access and retention.'
# Keep staging evidence rather than deleting computed paths automatically.
