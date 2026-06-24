# Документація проєкту (не для сервера)

Усе в цій папці — **лише для розробки** (Cursor, Sublime Merge, git).  
На VPS `sim.docaa.net` ця папка **не потрібна** і не деплоїться.

## Файли пам'яті для AI

| Файл | Коли читати / оновлювати |
|------|--------------------------|
| [AI_CONTEXT.md](AI_CONTEXT.md) | Перед кожною задачею; при новому функціоналі |
| [DECISIONS.md](DECISIONS.md) | При архітектурних рішеннях |
| [ROADMAP.md](ROADMAP.md) | При завершенні задач |
| [BUSINESS_RULES.md](BUSINESS_RULES.md) | При зміні бізнес-логіки |
| [CHANGELOG.md](CHANGELOG.md) | При будь-яких змінах коду |

## Інше

- [DEPLOY-SIMPLE.md](DEPLOY-SIMPLE.md) — покроковий деплой для першого налаштування
- [handoff/](handoff/) — хендоф з чатів (еталони, скріни, історія багів)
- [config/](config/) — довідкові промпти/правила (сервер їх не читає)

## Що на сервері (корінь репо, без `docs/`)

```
server/  public/  scripts/  package.json  .env.example
```
