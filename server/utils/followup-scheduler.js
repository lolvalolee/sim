// server/utils/followup-scheduler.js
// Планувальник нагадувань "де заявка?" від перевізника.
//
// При підтвердженні угоди з перевізником → 3 тригери:
//   1. +1 сим-година від підтвердження
//   2. наступний сим-день (~9:30)
//   3. день перед завантаженням (~14:00)
//
// Працює з або без рядка applications (letter_id + carrier_id).

const { v4: uuidv4 } = require('uuid');
const simTime = require('./sim-time');

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

function parseDmy(s) {
  const [d, m, y] = String(s || '').split('.').map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function dmyToSimDay(startDmy, targetDmy) {
  const start = parseDmy(startDmy);
  const target = parseDmy(targetDmy);
  if (!start || !target) return 1;
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((target - start) / 86400000) + 1);
}

function calculateTriggerTimes({ session, loadDateStr, confirmedAtMs }) {
  const DAY_MS = simTime.DAY_MS_REAL;
  const SIM_HOUR_MS = simTime.SIM_HOUR_MS_REAL;
  const sessionCreatedMs = session.created_at
    ? new Date(session.created_at).getTime()
    : confirmedAtMs;
  const timerMs = session.timer_ms || 0;
  const parts = simTime.timerMsToParts(timerMs);

  const trigger_1hour = confirmedAtMs + SIM_HOUR_MS;

  let trigger_next_day = null;
  let trigger_day_minus_1 = null;

  try {
    const loadSimDay = dmyToSimDay(session.start_date, loadDateStr);

    // Наступний сим-день, ~9:30 (0.5 сим-год від початку дня)
    trigger_next_day = sessionCreatedMs
      + parts.timer_day * DAY_MS
      + (0.5 / 12) * DAY_MS;

    // День перед завантаженням, ~14:00 (5 сим-год від початку дня)
    if (loadSimDay >= 2) {
      trigger_day_minus_1 = sessionCreatedMs
        + (loadSimDay - 2) * DAY_MS
        + (5 / 12) * DAY_MS;
    }

    if (trigger_next_day && trigger_day_minus_1 && trigger_next_day >= trigger_day_minus_1) {
      trigger_next_day = null;
    }
    if (trigger_day_minus_1 && trigger_day_minus_1 <= trigger_1hour) {
      trigger_day_minus_1 = null;
    }
    // Минуле — не плануємо
    const now = confirmedAtMs;
    if (trigger_next_day && trigger_next_day < now) trigger_next_day = null;
    if (trigger_day_minus_1 && trigger_day_minus_1 < now) trigger_day_minus_1 = null;
  } catch (e) {
    console.error('[followups] calculateTriggerTimes:', e.message);
  }

  return { trigger_1hour, trigger_next_day, trigger_day_minus_1 };
}

function syntheticAppId(sessionId, letterId, carrierId) {
  return `letter:${sessionId}:${letterId}:${carrierId}`;
}

function isSyntheticAppId(id) {
  return String(id || '').startsWith('letter:');
}

function scheduleFollowups({
  db, session, application, letterId, carrierId, sessionStartDateStr, loadDateStr,
}) {
  if (!carrierId || !letterId) return;

  const confirmedAtMs = Date.now();
  const appId = application?.id || syntheticAppId(session.id, letterId, carrierId);

  const times = calculateTriggerTimes({
    session,
    loadDateStr: loadDateStr || sessionStartDateStr,
    confirmedAtMs,
  });

  db.prepare(`
    UPDATE application_followups SET cancelled=1
    WHERE fired=0 AND cancelled=0 AND session_id=? AND carrier_id=?
      AND (application_id=? OR letter_id=?)
  `).run(session.id, carrierId, appId, letterId);

  const triggers = [
    { type: '1hour', ts: times.trigger_1hour },
    { type: 'next_day', ts: times.trigger_next_day },
    { type: 'day_minus_1', ts: times.trigger_day_minus_1 },
  ].filter(t => t.ts);

  for (const t of triggers) {
    db.prepare(`INSERT INTO application_followups
      (id, application_id, session_id, student_id, carrier_id, letter_id, trigger_type, scheduled_at)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(
        uuidv4(),
        appId,
        session.id,
        session.student_id,
        carrierId,
        letterId,
        t.type,
        new Date(t.ts).toISOString()
      );
  }
  const label = application?.number_seq || letterId.slice(0, 8);
  console.log(`[followups] Заплановано ${triggers.length} тригерів для ${label}`);
}

function cancelFollowups({ db, applicationId }) {
  const result = db.prepare(
    'UPDATE application_followups SET cancelled=1 WHERE application_id=? AND fired=0 AND cancelled=0'
  ).run(applicationId);
  if (result.changes > 0) {
    console.log(`[followups] Скасовано ${result.changes} тригерів для ${String(applicationId).slice(0, 12)}`);
  }
}

function cancelFollowupsForDeal({ db, sessionId, letterId, carrierId }) {
  db.prepare(`
    UPDATE application_followups SET cancelled=1
    WHERE session_id=? AND carrier_id=? AND letter_id=? AND fired=0 AND cancelled=0
  `).run(sessionId, carrierId, letterId);
}

function isApplicationSent(db, followup) {
  if (isSyntheticAppId(followup.application_id)) {
    const op = db.prepare(`
      SELECT application_sent FROM order_progress
      WHERE session_id=? AND letter_id=?
    `).get(followup.session_id, followup.letter_id);
    return !!op?.application_sent;
  }
  const app = db.prepare('SELECT sent_to_carrier_at FROM applications WHERE id=?').get(followup.application_id);
  return !!app?.sent_to_carrier_at;
}

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

  let processed = 0;
  for (const f of pending) {
    try {
      if (isApplicationSent(db, f)) {
        db.prepare('UPDATE application_followups SET cancelled=1 WHERE id=?').run(f.id);
        continue;
      }

      let text;
      switch (f.trigger_type) {
        case '1hour': text = pickRandomText(TEXTS_1HOUR); break;
        case 'next_day': text = pickRandomText(TEXTS_NEXT_DAY); break;
        case 'day_minus_1': text = pickRandomText(TEXTS_DAY_MINUS_1); break;
        default: text = 'Очікую заявку.';
      }

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
        try { messages = JSON.parse(chat.messages || '[]'); } catch (e) {}
        messages.push(newMsg);
        db.prepare("UPDATE carrier_chats SET messages=?, updated_at=datetime('now') WHERE id=?")
          .run(JSON.stringify(messages), chat.id);
      } else {
        db.prepare("INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,?)")
          .run(uuidv4(), f.session_id, f.carrier_id, JSON.stringify([newMsg]), 'confirmed');
      }

      db.prepare('UPDATE application_followups SET fired=1, fired_at=? WHERE id=?').run(now, f.id);
      processed++;
    } catch (e) {
      console.error(`[followups] Помилка обробки тригера ${f.id}:`, e.message);
    }
  }

  if (processed) console.log(`[followups] Опрацьовано ${processed} тригерів`);
  return processed;
}

async function handleStudentReplyToFollowup({ db, sessionId, carrierId, studentText }) {
  if (!studentText || studentText.length < 3) return;

  const activeFollowups = db.prepare(`
    SELECT * FROM application_followups
    WHERE session_id=? AND carrier_id=? AND fired=0 AND cancelled=0
    ORDER BY scheduled_at ASC
  `).all(sessionId, carrierId);

  if (activeFollowups.length === 0) return;

  const text = studentText.toLowerCase();
  const cancelKeywords = /не\s*ї[ду][емо]*|скасов|відмов|не\s*буде|пропуст/;
  const delayKeywords = /зара[з]?|готу[єюя]|надішл|через\s*\d?\s*(годину|хв|хвил)|трохи\s*пізніше|пізніше|сьогодні|завтра|хвилин|готов[ао]/;

  if (cancelKeywords.test(text)) {
    db.prepare('UPDATE application_followups SET cancelled=1 WHERE session_id=? AND carrier_id=? AND fired=0')
      .run(sessionId, carrierId);
  } else if (delayKeywords.test(text)) {
    const pauseUntilMs = Date.now() + simTime.SIM_HOUR_MS_REAL * 4;
    db.prepare(`
      UPDATE application_followups SET paused_until=?
      WHERE session_id=? AND carrier_id=? AND fired=0 AND cancelled=0
    `).run(new Date(pauseUntilMs).toISOString(), sessionId, carrierId);
  }
}

module.exports = {
  scheduleFollowups,
  cancelFollowups,
  cancelFollowupsForDeal,
  processPendingFollowups,
  handleStudentReplyToFollowup,
  TEXTS_1HOUR,
  TEXTS_NEXT_DAY,
  TEXTS_DAY_MINUS_1,
};
