# AI_CONTEXT — Docaa Freight Simulator

> **Правило для AI:** читай цей файл + `DECISIONS.md`, `ROADMAP.md`, `BUSINESS_RULES.md`, `CHANGELOG.md` перед кожною новою задачею.

## Що це

Навчальний тренажер експедитора (українською). Студент грає роль експедитора: листи від замовників → торг → пошук перевізників → заявки → документи → інциденти рейсу. AI грає замовників і перевізників.

**Прод:** https://sim.docaa.net · VPS `/var/www/sim-docaa/` · PM2 `docaa-sim`

## Стек

| Шар | Технологія |
|-----|------------|
| Backend | Node.js, Express, better-sqlite3 (**синхронний** — ніколи `.catch` на DB) |
| DB | SQLite WAL, міграції `scripts/migrate-vN.js` (остання: v26) |
| Frontend | **Один файл** `public/simulator.html` (~10k+ рядків, весь UI + клієнтський JS) |
| AI | Claude Sonnet через проксі `/api/student/ai` (ключ на сервері) |
| Auth | JWT, ролі: superadmin → lecturer → student |

## Ключові файли

```
public/simulator.html          — фронт, промпти AI, торг B, matchOrderByRoute
server/routes/student.js       — API студента (чати, заявки, біржа, документи)
server/routes/lecturer.js      — кабінет лектора, сесії, reset
server/routes/admin.js         — суперадмін
server/utils/incident-scheduler.js — інциденти за сим-часом
server/utils/route-matcher.js  — матчинг маршруту до листа (біржа)
server/utils/negotiation.js    — дзеркало торгу B (сервер не використовує в runtime)
scripts/seed-*.js              — letters, carriers, clients, letters_v2

docs/                          — ВСЯ документація (не на сервері)
docs/handoff/docaa_handoff/    — повний хендоф (еталони, скріни, історія)
docs/config/*.md               — довідкові промпти (сервер не читає)
```

## Ролі і флоу

```
superadmin → створює лекторів
lecturer   → групи, запуск сесій, reset студента
student    → simulator.html (гра)
```

## Сим-час

- 1 реальний день = 120 хв; сим-день 9:00–21:00; 1 сим-год = 10 хв реальних
- `timerDay = floor(хв/120)+1`
- Інциденти: `target_sim_hour_abs` (cron звіряє сим-годину, не лише день)

## Джерела даних

- 120 рейсів: `letters` ↔ `letters_v2` (freight_ref, rate_basis, vehicle_required, km, border…)
- ODS `Симулятор_1_1`, `Симулятор_2_0` — еталонні параметри
- На проді: 120/120 linked, freight_ref 750..7500

## Архітектурні принципи (власник Luke)

1. **Детермінований код > промпт** — цифри, межі, рішення рахує код; AI лише формулює фразу
2. Обговорити корінь перед кодом для складних фіч (дати!)
3. Точкові правки, не великі рефактори
4. Не over-engineer
5. Дані (км, ціна) — з файлу Симулятор, прив'язані до рейсу

## Поточний фокус

**Торг (пріоритет 1):** біржа не передавала `letter_id` → `dirsNeeded=[]` → невідповідні перевізники + `fref=0` → торг пливе. Фікс: вибір рейсу на біржі, прибрано лазівку фільтру напрямку, покращено `matchOrderByRoute`.

**Наступне (не чіпати без обговорення):** дати/сим-час, резюме (маржа≠заробіток), звіт лектору.

## Дизайн

Темна тема: фон `#151515`, акцент `#FFBE63`, Inter, Viber-стиль чатів.

## Деплой — два середовища

| Де | Що зберігається |
|----|-----------------|
| **Git / Cursor (dev)** | Код + папка `docs/` (пам'ять AI, handoff, інструкції) |
| **VPS prod** | Тільки runtime: `server/`, `public/`, `scripts/`, `package.json`. **Без** `docs/` |

На сервер **не деплоїть** папку `docs/` — вона не використовується Node.js.

```bash
cd /Users/ucomluke/project/sim-docaa
DEPLOY_HOST=root@IP ./scripts/deploy.sh

# Перевірка без змін:
DEPLOY_HOST=root@IP ./scripts/deploy.sh --dry-run
```

Детальніше для першого налаштування: `docs/DEPLOY-SIMPLE.md` (лише локально, не на VPS).
