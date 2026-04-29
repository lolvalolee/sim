# Docaa Simulator — Інструкція розгортання
## sim.docaa.net

---

## Що потрібно перед початком

- VPS сервер з Ubuntu 22.04 (мінімум 2GB RAM, 20GB диск)
- Домен docaa.net з доступом до DNS (nombres.ua)
- SSH доступ до сервера

---

## КРОК 1 — Піддомен DNS

На сайті **nombres.ua** або де керуєте DNS:

```
Тип:   A
Ім'я:  sim
Значення: [IP вашого сервера]
TTL:   3600
```

Перевірити через 10-30 хвилин:
```bash
ping sim.docaa.net
```

---

## КРОК 2 — Підключення до сервера

```bash
ssh root@[IP_ВАШОГО_СЕРВЕРА]
```

---

## КРОК 3 — Встановлення Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # має бути v20.x
npm --version
```

---

## КРОК 4 — Встановлення PM2 (менеджер процесів)

```bash
npm install -g pm2
```

---

## КРОК 5 — Встановлення Nginx

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

---

## КРОК 6 — Завантаження файлів симулятора

```bash
# Створити папку
mkdir -p /var/www/sim-docaa
cd /var/www/sim-docaa

# Завантажити файли (через scp з вашого комп'ютера):
# scp -r ./sim-server/* root@[IP]:/var/www/sim-docaa/
```

Або через FileZilla (SFTP) — переносьте всю папку `sim-server`.

---

## КРОК 7 — Налаштування .env

```bash
cd /var/www/sim-docaa
cp .env.example .env
nano .env
```

Заповніть:
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=    # згенеруйте: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
ANTHROPIC_API_KEY=sk-ant-api03-...
DB_PATH=./data/simulator.db
FRONTEND_URL=https://sim.docaa.net
```

Зберегти: Ctrl+O, Enter, Ctrl+X

---

## КРОК 8 — Встановлення залежностей та ініціалізація БД

```bash
cd /var/www/sim-docaa
npm install
node scripts/init-db.js
node scripts/create-admin.js
```

Запам'ятайте email/пароль суперадміна!

---

## КРОК 9 — Скопіювати файли симулятора

```bash
# freightdesk-v4.html → simulator.html
cp public/freightdesk-v4.html public/simulator.html

# Або завантажте через scp
```

---

## КРОК 10 — Запуск через PM2

```bash
cd /var/www/sim-docaa
pm2 start server/index.js --name "docaa-sim"
pm2 save
pm2 startup   # виконайте команду яку покаже
```

Перевірити що працює:
```bash
pm2 status
curl http://localhost:3000/health
```

---

## КРОК 11 — Nginx конфігурація

```bash
sudo nano /etc/nginx/sites-available/sim.docaa.net
```

Вставити:
```nginx
server {
    listen 80;
    server_name sim.docaa.net;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/sim.docaa.net /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## КРОК 12 — SSL сертифікат (HTTPS)

```bash
sudo certbot --nginx -d sim.docaa.net
```

Слідувати інструкціям, вибрати "Redirect HTTP to HTTPS".

Перевірити: відкрийте https://sim.docaa.net в браузері.

---

## КРОК 13 — Перевірка роботи

```bash
# Статус
pm2 status

# Логи в реальному часі
pm2 logs docaa-sim

# Здоров'я сервера
curl https://sim.docaa.net/health
```

---

## Управління після запуску

```bash
# Перезапустити після оновлення файлів
pm2 restart docaa-sim

# Зупинити
pm2 stop docaa-sim

# Переглянути логи
pm2 logs docaa-sim --lines 100

# Моніторинг
pm2 monit
```

---

## Оновлення симулятора (нова версія)

```bash
# Завантажте новий файл simulator.html
scp freightdesk-v5.html root@[IP]:/var/www/sim-docaa/public/simulator.html
# Перезапуск не потрібен — статичний файл оновлюється одразу
```

---

## Резервне копіювання БД

```bash
# Ручне копіювання
cp /var/www/sim-docaa/data/simulator.db /var/backups/simulator_$(date +%Y%m%d).db

# Автоматичне (додати в crontab)
crontab -e
# Додати рядок:
0 3 * * * cp /var/www/sim-docaa/data/simulator.db /var/backups/simulator_$(date +\%Y\%m\%d).db
```

---

## Структура акаунтів

```
Суперадмін (ви)
    └── Лектор 1
        ├── Група "Логістика 2025-1"
        │   ├── Студент Іванов
        │   ├── Студент Петров
        │   └── ...
        └── Група "Логістика 2025-2"
            └── ...
```

### Після запуску:

1. Зайдіть на https://sim.docaa.net
2. Логін суперадміна → відкривається `/superadmin.html`
3. Створіть лектора
4. Лектор логіниться → відкривається `/lecturer.html`
5. Лектор створює групу → додає студентів
6. Студент логіниться → відкривається `/simulator.html`

---

## Порти і безпека

Закрити зайві порти (залишити тільки 22, 80, 443):
```bash
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo ufw status
```

---

## Технічні характеристики

| Параметр | Значення |
|---|---|
| Одночасні користувачі | 500+ |
| База даних | SQLite (WAL mode) |
| API проксі | Через сервер (ключ прихований) |
| Автозбереження | Кожні 30 сек |
| Таймаут сесії | 7 днів |
