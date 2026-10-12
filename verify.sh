#!/usr/bin/env bash
set -euo pipefail
[ -f package-lock.json ] && [ -f web/package-lock.json ] || { echo 'Generate and review both lockfiles first'; exit 1; }
# Only tests point at a separate rexmarket_test DB. Do NOT set production URL.
case "${DATABASE_URL:-}" in
  */rexmarket_test\?*) ;;
  *) echo 'Verification requires DATABASE_URL=.../rexmarket_test?schema=public' >&2; exit 1 ;;
esac
npm ci
npm --prefix web ci
npm run db:generate
npx prisma validate
npm run db:deploy
npm run check
npm run build
npm test
for script in scripts/*.sh; do bash -n "$script"; done
npm audit --omit=dev --audit-level=high
npm --prefix web audit --omit=dev --audit-level=high
echo 'Local automated checks passed. Telegram/browser/TLS/restore acceptance still required.'
