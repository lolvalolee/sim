#!/usr/bin/env bash
# Оновлення на проді після git pull (запускати НА СЕРВЕРІ в /var/www/sim-docaa).
# Rate limit — через RATE_LIMIT_MAX у .env, не локальний патч index.js.
#
#   cd /var/www/sim-docaa && bash scripts/prod-update.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ROOT}/.env"

ensure_env_rate_limit() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "⚠ .env не знайдено — створіть з .env.example"
    return
  fi
  if grep -q '^RATE_LIMIT_MAX=' "$ENV_FILE"; then
    echo "✓ RATE_LIMIT_MAX уже в .env"
  else
    echo 'RATE_LIMIT_MAX=5000' >> "$ENV_FILE"
    echo "✓ додано RATE_LIMIT_MAX=5000 у .env"
  fi
}

# Локальний патч max:5000 у index.js більше не потрібен
if git diff --name-only 2>/dev/null | grep -qx 'server/index.js'; then
  if git diff server/index.js | grep -q 'max: 5000'; then
    echo "→ скидаємо локальний патч rate limit у server/index.js (→ .env)"
    git restore server/index.js
  fi
fi

echo "→ git pull"
git pull

ensure_env_rate_limit

echo "→ міграції"
for m in scripts/migrate-v*.js; do
  [[ -f "$m" ]] || continue
  node "$m" || true
done

echo "→ pm2 restart docaa-sim"
pm2 restart docaa-sim

echo ""
echo "✓ Готово. HEAD: $(git log -1 --oneline)"
curl -sf "http://127.0.0.1:${PORT:-3000}/health" && echo "" || echo "(health: перевірте PORT у .env)"
