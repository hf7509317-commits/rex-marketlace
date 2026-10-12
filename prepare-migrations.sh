#!/usr/bin/env bash
set -euo pipefail
printf 'Migrasi initial sudah disertakan. Gunakan npm run db:deploy pada DB development terlebih dahulu.\n'
printf 'Untuk perubahan skema berikutnya: npx prisma migrate dev --name nama_perubahan (development ONLY).\n'
