#!/usr/bin/env bash
# Restore only into a NEW isolated container; never points at production.
set -euo pipefail
umask 077
archive="${1:?usage: restore-drill.sh /absolute/backup.tar.gz}"
test -f "$archive"
name="teamspace-restore-$(date -u +%Y%m%d%H%M%S)"
stage="$(mktemp -d)"
tar -xzf "$archive" -C "$stage" --no-same-owner
(cd "$stage" && sha256sum -c database.sha256 && { test ! -s files.sha256 || sha256sum -c files.sha256; })
docker run -d --name "$name" --label teamspace.scope=restore-drill --network none --memory=256m -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for attempt in $(seq 1 30); do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$name" createdb -U postgres restored
docker exec -i "$name" pg_restore -U postgres -d restored --no-owner --no-privileges --exit-on-error < "$stage/database.dump"
docker exec "$name" psql -U postgres -d restored -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS organizations FROM org_organization; SELECT count(*) AS projects FROM prj_project;'
docker exec "$name" psql -U postgres -d restored -Atc "SELECT json_build_object('organizations',(SELECT count(*) FROM org_organization),'projects',(SELECT count(*) FROM prj_project),'files',(SELECT count(*) FROM prj_file));" > "$stage/restored-counts.json"
diff -u "$stage/counts.json" "$stage/restored-counts.json"
docker cp "$stage/uploads" "$name:/restored-uploads"
if test -s "$stage/files.sha256"; then sed 's|  uploads/|  /restored-uploads/|' "$stage/files.sha256" | docker exec -i "$name" sha256sum -c -; fi
docker exec "$name" sh -c 'find /restored-uploads -type f | wc -l'
echo "Restored DB and verified file checksums. Evidence container: $name; evidence directory: $stage"
docker stop "$name" >/dev/null
