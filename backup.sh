#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${BACKUP_DIR:?Set private BACKUP_DIR outside web root}"
: "${PGDATABASE:?Set PGDATABASE}"; : "${PGUSER:?Set PGUSER}"
: "${STORAGE_ROOT:?Set absolute STORAGE_ROOT}"
mkdir -p "$BACKUP_DIR"
name="$BACKUP_DIR/rexmarket-$(date -u +%Y%m%dT%H%M%SZ)-$$"
# Stop ALL writers for a consistent DB/media snapshot. Planned downtime required.
pm2 stop rexmarket-api rexmarket-bot
trap 'pm2 start rexmarket-api rexmarket-bot' EXIT
pg_dump -h "${PGHOST:-127.0.0.1}" -Fc --file="$name.dump"
tar -czf "$name-storage.tar.gz" -C "$STORAGE_ROOT" .
sha256sum "$name.dump" "$name-storage.tar.gz" > "$name.sha256"
echo 'Encrypt and copy backups offsite; back up encryption key separately. Test restore to a NEW DB.'
