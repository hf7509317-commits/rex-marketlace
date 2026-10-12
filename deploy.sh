#!/usr/bin/env bash
set -euo pipefail
[ -f package-lock.json ] && [ -f web/package-lock.json ] || { echo 'Generate/review both lockfiles on development first'; exit 1; }
[ -f .env ] || { echo 'Configure .env first'; exit 1; }
[ -d prisma/migrations ] || { echo 'Missing migrations'; exit 1; }
npm ci
npm --prefix web ci
npm run db:generate
npm run build
# Back up DB/storage/key and test restore BEFORE production migrations.
npm run db:deploy
npm run db:seed
NODE_ENV=production npm run readiness
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
