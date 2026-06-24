#!/usr/bin/env bash
# Деплой на прод: лише runtime-файли. Документація і handoff НЕ їдуть на сервер.
#
# Використання:
#   DEPLOY_HOST=root@95.216.45.123 ./scripts/deploy.sh
#   DEPLOY_HOST=root@IP ./scripts/deploy.sh --dry-run
#
# Після деплою на сервері (автоматично якщо не --no-remote):
#   npm install --production
#   node scripts/migrate-v26.js  (і інші нові migrate-v*.js за потреби)
#   pm2 restart docaa-sim

set -euo pipefail

HOST="${DEPLOY_HOST:-}"
REMOTE_DIR="${DEPLOY_DIR:-/var/www/sim-docaa}"
DRY_RUN=""
NO_REMOTE=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="--dry-run" ;;
    --no-remote) NO_REMOTE=1 ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Вкажіть сервер: DEPLOY_HOST=root@IP ./scripts/deploy.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RSYNC_OPTS=(-avz --delete $DRY_RUN)

# Виключення: docs/ (документація), БД, секрети, git
EXCLUDES=(
  --exclude='.git/'
  --exclude='docs/'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='data/'
  --exclude='node_modules/'
  --exclude='.cursor/'
  --exclude='.DS_Store'
)

echo "→ Синхронізація $ROOT → $HOST:$REMOTE_DIR"
rsync "${RSYNC_OPTS[@]}" "${EXCLUDES[@]}" \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

if [[ -n "$DRY_RUN" ]]; then
  echo "(dry-run — нічого не змінено)"
  exit 0
fi

if [[ -n "$NO_REMOTE" ]]; then
  echo "Файли скопійовано. На сервері вручну: npm install, migrate, pm2 restart"
  exit 0
fi

echo "→ npm install + міграції + pm2 restart на сервері..."
ssh "$HOST" "cd $REMOTE_DIR && npm install --production && \
  for m in scripts/migrate-v*.js; do node \"\$m\" 2>/dev/null || true; done && \
  pm2 restart docaa-sim"

echo "✓ Готово. Перевір: curl https://sim.docaa.net/health"
