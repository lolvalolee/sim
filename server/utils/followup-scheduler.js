// server/utils/followup-scheduler.js
// Планувальник нагадувань "де заявка?" від перевізника.
//
// Логіка:
// При підтвердженні угоди з перевізником → плануємо 3 тригери:
//   1. +1 година симуляції від моменту підтвердження
//   2. наступний робочий день (ранок ~9:30) симуляції
//   3. день перед завантаженням
//
// Кожен тригер спрацьовує ТІЛЬКИ якщо заявка ще не надіслана.
// При надсиланні заявки — усі тригери цього application скасовуються.

const { v4: uuidv4 } = require('uuid');

// Тексти нагадувань
const TEXTS_1HOUR = [
  'Коли очікувати заявку?',
  'Зможете прислати заявку ще сьогодні?',
  'Не забудьте вказати в заявці повні адреси завантаження і розвантаження',
  'Якщо вам бракує якихось даних для заявки — повідомте мене.',
];

const TEXTS_NEXT_DAY = [
  'Добрий день! Чекаю від вас заявку.',
  'Добрий день. Заявка так і не надходила. Починаю хвилюватися.',
  'Добрий день! Що із заявкою? Якщо щось не так із завантаженням, краще повідомити про це зараз.',
  'Добрий день. Бронювати авто для вас? Заявка вчора так і не надходила.',
];

const TEXTS_DAY_MINUS_1 = [
  'Добрий день. Нагадую, завтра забираємо ваш вантаж. Але я так і не побачив від вас заявки.',
  'Добрий день! Хочу перепитати чи все в силі на завтра. Заявка від вас так і не приходила.',
  'Добрий день. Пришліть, будь ласка, заявку, щоб я розумів чи відправляти авто на завантаження.',
  'Добрий день. Завантаження, про яке домовились, ще в силі? Чи мені шукати щось інше?',
];

function pickRandomText(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Обчислюємо реальний час спрацювання тригера.
// У симуляції 1 день = 36 хв реального часу (CFG.dayDuration на клієнті).
// 1 година симуляції = 1.5 хв реального часу.
// Сесія має start_date (date старту симуляції) + момент створення сесії.
//
// Параметри:
//   confirmedAtMs — реальний timestamp (Date.now()) коли підтвердили угоду
//   loadDateStr   — дата завантаження "DD.MM.YYYY" з заявки
//   sessionStartDateStr — дата старту симуляції "DD.MM.YYYY"
//
// Повертає об'єкт із трьома timestamps для трьох тригерів.
function calculateTriggerTimes({ confirmedAtMs, loadDateStr, sessionStartDateStr }) {
  const SIM_DAY_MS = 36 * 60 * 1000;            // 1 симуляційний день = 36 хв
  const SIM_HOUR_MS = SIM_DAY_MS / 24;           // 1 симуляційна година = 1.5 хв

  const trigger1Hour = confirmedAtMs + SIM_HOUR_MS;

  // Обчислюємо симуляційну дату на момент підтвердження
  // та реальні timestamps для "наступний день ранок 9:30" і "day-1 перед завантаженням"
  let trigger_next_day = null;
  let trigger_day_minus_1 = null;

  try {
    const parseDate = (s) => {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    };
    const startDate = parseDate(sessionStartDateStr);
    const loadDate = parseDate(loadDateStr);
    const sessionStartMs = confirmedAtMs - Math.floor((confirmedAtMs - confirmedAtMs) / SIM_DAY_MS) * SIM_DAY_MS;
    // Spravdi нам потрібен момент створення сесії, а не confirmed.
    // Але ми не маємо його тут — буде передано окремо.
    // Поки що використовуємо confirmedAtMs як приблизне базою.

    // Інша логіка: знаходимо коли в реальному часі настане "наступний день після confirmedAt"
    // Тобто плюс той час від confirmedAt який потрібен щоб симуляційний день змінився на 1.
    // Простіше: confirmedAtMs + SIM_DAY_MS (приблизно)
    trigger_next_day = confirmedAtMs + SIM_DAY_MS;

    // День перед завантаженням:
    // Скільки симуляційних днів від confirmedAt до loadDate?
    const confirmedSimDate = new Date(startDate);
    confirmedSimDate.setTime(startDate.getTime()); // початок
    // Це приблизно — для точності треба знати на якому симуляційному дні було confirmedAt.
    // Передамо це з контексту вище.
  } catch (e) {
    trigger_next_day = confirmedAtMs + SIM_DAY_MS;
    trigger_day_minus_1 = null;
  }

  return {
    trigger_1hour: trigger1Hour,
    trigger_next_day: trigger_next_day,
    trigger_day_minus_1: trigger_day_minus_1,
  };
}

// Краща версія обчислення часів — приймає всі потрібні параметри
function calculateTriggerTimesV2({ confirmedAtMs, sessionCreatedMs, currentSimDay, loadDateStr, sessionStartDateStr, simDayDurationMs = 36 * 60 * 1000 }) {
  const SIM_HOUR_MS = simDayDurationMs / 24;

  // Тригер 1: +1 година симуляції
  const trigger_1hour = confirmedAtMs + SIM_HOUR_MS;

  // Симуляційні дати
  const parseDate = (s) => {
    const [d, m, y] = s.split('.').map(Number);
    return new Date(y, m - 1, d);
  };

  let trigger_next_day = null;
  let trigger_day_minus_1 = null;

  try {
    const startDate = parseDate(sessionStartDateStr);
    const loadDate = parseDate(loadDateStr);

    // Скільки симуляційних днів між стартом сесії і датою завантаження
    const daysUntilLoad = Math.floor((loadDate - startDate) / (24 * 60 * 60 * 1000));

    // На якому симуляційному дні зараз?
    // currentSimDay (1..5) — передається з клієнту або обчислюється
    // або беремо з confirmedAtMs - sessionCreatedMs

    const elapsedMs = confirmedAtMs - sessionCreatedMs;
    const elapsedSimDays = elapsedMs / simDayDurationMs; // 0..5
    const currentDayFractional = elapsedSimDays;

    // Тригер "наступний день ранок ~9:30":
    // наступний симуляційний день після поточного, точка ~9:30 = 0.4 від дня
    const nextDayInt = Math.floor(currentDayFractional) + 1;
    // зміщення від 0:00 наступного дня до 9:30 = (9.5/24) * SIM_DAY_MS
    const morningOffsetMs = (9.5 / 24) * simDayDurationMs;
    const nextDayStartMs = sessionCreatedMs + nextDayInt * simDayDurationMs;
    trigger_next_day = nextDayStartMs + morningOffsetMs;

    // Тригер "день перед завантаженням":
    // Якщо завантаження на симуляційний день daysUntilLoad,
    // то day-1 — це симуляційний день (daysUntilLoad - 1) о 14:00 (середина другої половини)
    if (daysUntilLoad >= 1) {
      const dayBeforeIdx = daysUntilLoad - 1; // 0-based
      const afternoonOffsetMs = (14 / 24) * simDayDurationMs;
      trigger_day_minus_1 = sessionCreatedMs + dayBeforeIdx * simDayDurationMs + afternoonOffsetMs;
    }

    // Якщо trigger_next_day >= trigger_day_minus_1 — пропускаємо next_day (він вже після day-1)
    if (trigger_next_day && trigger_day_minus_1 && trigger_next_day >= trigger_day_minus_1) {
      trigger_next_day = null;
    }
    // Якщо trigger_day_minus_1 < trigger_1hour — пропускаємо
    if (trigger_day_minus_1 && trigger_day_minus_1 <= trigger_1hour) {
      trigger_day_minus_1 = null;
    }
  } catch(e) {
    console.error('Помилка обчислення triggers:', e.message);
  }

  return {
    trigger_1hour,
    trigger_next_day,
    trigger_day_minus_1,
  };
}

// Планує нагадування при підтвердженні угоди
function scheduleFollowups({ db, session, application, carrierId, sessionStartDateStr, loadDateStr, simDayDurationMs = 36 * 60 * 1000 }) {
  if (!application?.id || !carrierId) return;

  const confirmedAtMs = Date.now();
  // Беремо moment створення сесії
  const sessionCreatedMs = session.created_at
    ? new Date(session.created_at).getTime()
    : confirmedAtMs - simDayDurationMs * 3; // fallback - припускаємо 3 дні минуло

  const times = calculateTriggerTimesV2({
    confirmedAtMs,
    sessionCreatedMs,
    loadDateStr,
    sessionStartDateStr,
    simDayDurationMs,
  });

  // Скасовуємо попередні (на випадок переузгодження)
  db.prepare(
    'UPDATE application_followups SET cancelled=1 WHERE application_id=? AND fired=0'
  ).run(application.id);

  const triggers = [
    { type: '1hour', ts: times.trigger_1hour },
    { type: 'next_day', ts: times.trigger_next_day },
    { type: 'day_minus_1', ts: times.trigger_day_minus_1 },
  ].filter(t => t.ts);

  for (const t of triggers) {
    db.prepare(`INSERT INTO application_followups
      (id, application_id, session_id, student_id, carrier_id, trigger_type, scheduled_at)
      VALUES (?,?,?,?,?,?,?)`)
      .run(
        uuidv4(),
        application.id,
        session.id,
        session.student_id,
        carrierId,
        t.type,
        new Date(t.ts).toISOString()
      );
  }
  console.log(`[followups] Заплановано ${triggers.length} тригерів для заявки ${application.number_seq}`);
}

// Скасовує всі тригери для заявки (коли заявка надіслана)
function cancelFollowups({ db, applicationId }) {
  const result = db.prepare(
    'UPDATE application_followups SET cancelled=1 WHERE application_id=? AND fired=0 AND cancelled=0'
  ).run(applicationId);
  if (result.changes > 0) {
    console.log(`[followups] Скасовано ${result.changes} тригерів для заявки ${applicationId.slice(0, 8)}`);
  }
}

// Виконує всі тригери що настали — викликається cron'ом
function processPendingFollowups({ db }) {
  const now = new Date().toISOString();
  const pending = db.prepare(`
    SELECT * FROM application_followups
    WHERE fired = 0
      AND cancelled = 0
      AND scheduled_at <= ?
      AND (paused_until IS NULL OR paused_until <= ?)
  `).all(now, now);

  if (pending.length === 0) return 0;

  console.log(`[followups] Обробляю ${pending.length} тригерів...`);

  let processed = 0;
  for (const f of pending) {
    try {
      // Перевіряємо чи заявка ще не надіслана
      const app = db.prepare('SELECT id, sent_to_carrier_at FROM applications WHERE id=?').get(f.application_id);
      if (!app) {
        // Заявка зникла - скасовуємо
        db.prepare('UPDATE application_followups SET cancelled=1 WHERE id=?').run(f.id);
        continue;
      }
      if (app.sent_to_carrier_at) {
        // Заявка вже надіслана - скасовуємо тригер
        db.prepare('UPDATE application_followups SET cancelled=1 WHERE id=?').run(f.id);
        continue;
      }

      // Обираємо текст по типу
      let text;
      switch (f.trigger_type) {
        case '1hour': text = pickRandomText(TEXTS_1HOUR); break;
        case 'next_day': text = pickRandomText(TEXTS_NEXT_DAY); break;
        case 'day_minus_1': text = pickRandomText(TEXTS_DAY_MINUS_1); break;
        default: text = 'Очікую заявку.';
      }

      // Додаємо повідомлення в carrier_chats
      const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?')
        .get(f.session_id, f.carrier_id);

      const newMsg = {
        role: 'ai',
        text,
        timestamp: now,
        followup_type: f.trigger_type,
        read: false,
      };

      if (chat) {
        let messages = [];
        try { messages = JSON.parse(chat.messages || '[]'); } catch(e){}
        messages.push(newMsg);
        db.prepare("UPDATE carrier_chats SET messages=?, updated_at=datetime('now') WHERE id=?")
          .run(JSON.stringify(messages), chat.id);
      } else {
        db.prepare("INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,?)")
          .run(uuidv4(), f.session_id, f.carrier_id, JSON.stringify([newMsg]), 'confirmed');
      }

      // Відмічаємо тригер як виконаний
      db.prepare('UPDATE application_followups SET fired=1, fired_at=? WHERE id=?').run(now, f.id);
      processed++;
    } catch (e) {
      console.error(`[followups] Помилка обробки тригера ${f.id}:`, e.message);
    }
  }

  console.log(`[followups] Опрацьовано ${processed} тригерів`);
  return processed;
}

// AI-розбір відповіді студента на нагадування — Q2
// Якщо студент написав "зараз / трохи пізніше / готую" — паузимо тригери на N годин
async function handleStudentReplyToFollowup({ db, sessionId, carrierId, studentText }) {
  if (!studentText || studentText.length < 3) return;

  // Знаходимо активні тригери цього перевізника
  const activeFollowups = db.prepare(`
    SELECT * FROM application_followups
    WHERE session_id=? AND carrier_id=? AND fired=0 AND cancelled=0
    ORDER BY scheduled_at ASC
  `).all(sessionId, carrierId);

  if (activeFollowups.length === 0) return;

  // Прості евристики (без AI поки)
  // "зараз / зара / через годину / в обід / після обіду / трохи пізніше / готую / роблю / надішлю /
  //  хвилинку / 5 хв / маленьку хвилину" — позитивна відповідь, паузимо
  // "не їдемо / скасовую / не їду / відмова" — скасовуємо всі тригери (рейс відмінений)
  const text = studentText.toLowerCase();

  const cancelKeywords = /не\s*ї[ду][емо]*|скасов|відмов|не\s*буде|пройди|пропуст/;
  const delayKeywords = /зара[з]?|готу[єюя]|надішл|через\s*\d?\s*(годину|хв|хвил)|трохи\s*пізніше|пізніше|пізно|сьогодні|завтра|пожд|хвилин|готов[ао]/;

  if (cancelKeywords.test(text)) {
    // Скасовуємо всі тригери — рейс відмінений
    db.prepare('UPDATE application_followups SET cancelled=1 WHERE session_id=? AND carrier_id=? AND fired=0').run(sessionId, carrierId);
    console.log(`[followups] Скасовано тригери (рейс відмінений студентом) для carrier ${carrierId.slice(0,8)}`);
  } else if (delayKeywords.test(text)) {
    // Паузимо тригери на 4 симуляційні години (= 6 реальних хв)
    const SIM_HOUR_MS = (36 * 60 * 1000) / 24; // ~1.5 хв
    const pauseUntilMs = Date.now() + SIM_HOUR_MS * 4;
    db.prepare(`
      UPDATE application_followups SET paused_until=?
      WHERE session_id=? AND carrier_id=? AND fired=0 AND cancelled=0
    `).run(new Date(pauseUntilMs).toISOString(), sessionId, carrierId);
    console.log(`[followups] Паузнуто тригери на 4 сим. години для carrier ${carrierId.slice(0,8)}`);
  }
  // Якщо ні те, ні те — нічого не робимо, тригери йдуть за графіком
}

module.exports = {
  scheduleFollowups,
  cancelFollowups,
  processPendingFollowups,
  handleStudentReplyToFollowup,
  TEXTS_1HOUR,
  TEXTS_NEXT_DAY,
  TEXTS_DAY_MINUS_1,
};
