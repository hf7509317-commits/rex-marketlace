#!/usr/bin/env bash
set -euo pipefail
umask 077
secret_file=$(mktemp)
trap 'rm -f "$secret_file"' EXIT
read -r -s -p 'Password Super Admin (16–128 karakter): ' password; echo
printf '%s' "$password" > "$secret_file"
unset password
BOOTSTRAP_PASSWORD_FILE="$secret_file" npm run bootstrap
