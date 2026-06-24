# Docaa Freight Simulator

Навчальний тренажер експедитора · **sim.docaa.net**

## На сервері лише це

```
server/       — бекенд (Express, SQLite)
public/       — фронт (simulator.html, login, кабінети)
scripts/      — міграції БД, seed
package.json
.env          — на сервері (не в git)
data/         — simulator.db на сервері (не в git)
```

## Документація і контекст для AI

У папці **[docs/](docs/)** (не деплоїть на VPS).

## Деплой (після git push через Sublime Merge)

```bash
cd /Users/ucomluke/project/sim-docaa
DEPLOY_HOST=root@IP ./scripts/deploy.sh
```

Скрипт копіює тільки runtime, **без** `docs/`, **без** перезапису `data/` і `.env`.

Перше налаштування сервера: [docs/DEPLOY-SIMPLE.md](docs/DEPLOY-SIMPLE.md)
