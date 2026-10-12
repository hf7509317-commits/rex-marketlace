#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE:?Set NEW restore database name}"
: "${PGUSER:?Set PGUSER}"; : "${DUMP_FILE:?Set DUMP_FILE}"
# Deliberately never creates/drops/cleans an existing database.
createdb -h "${PGHOST:-127.0.0.1}" -U "$PGUSER" "$RESTORE_DATABASE"
pg_restore -h "${PGHOST:-127.0.0.1}" -U "$PGUSER" --no-owner --exit-on-error -d "$RESTORE_DATABASE" "$DUMP_FILE"
echo 'Restore finished. Restore storage into a NEW private directory and test app before cutover.'
