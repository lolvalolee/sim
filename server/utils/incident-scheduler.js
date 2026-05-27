// server/utils/incident-scheduler.js
//
// Інцидент-планувальник для Деплою 13.
//
// Архітектура:
// 1) При підтвердженні угоди з перевізником — функція scheduleInitialIncidents
//    планує ланцюжок початкових інцидентів для рейсу (loaded_ok, at_border, ...).
// 2) Cron щохвилини викликає runDueIncidents — шукає 'pending' інциденти з
//    scheduled_at <= now, перевіряє умови, спрацьовує (створює повідомлення)
//    і планує наступні у ланцюжку.
// 3) При певних діях студента (відмова перевізника, відмова замовника тощо)
//    також викликаємо scheduleReactiveIncidents для cross-context.
//
// ВАЖЛИВО:
// - "симуляційний час" = тут все в простих ISO datetime. Cron не залежить
//   від режиму швидкості; інтервали між інцидентами фіксовані в "годинах сим",
//   які пересчитуються в реальні мс через SIM_HOUR_MS_REAL (з налаштувань).
// - 1 година сим = 1.5 хв реального часу (1.5*60*1000 мс)
//   Це залежить від поточного режиму швидкості сесії.
//   Для простоти Деплоя 13 — фіксована швидкість.

const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const scenariosLib = require('./incident-scenarios');

// Один сим-час: за замовч. 1.5 хв реального
// (Збігається з SIM_HOUR_MS у simulator.html)
const SIM_HOUR_MS_REAL = 1.5 * 60 * 1000;

function simHoursToMs(hours) {
  return Math.round(hours * SIM_HOUR_MS_REAL);
}

// Допоміжне: now+ms у вигляді ISO
function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
}

// ────────────────────────────────────────────────────────────
// Планування початкових інцидентів при підтвердженні угоди
// ────────────────────────────────────────────────────────────
function scheduleInitialIncidents({ sessionId, studentId, letterId, applicationId, scenarioId, carrierChatId, loadDateIso }) {
  if (!sessionId || !studentId || !letterId) {
    console.warn('[incident-sched] scheduleInitialIncidents: missing params');
    return;
  }
  const scenario = scenarioId || 1;

  // Базовий час відліку — або дата завантаження (loadDateIso), або зараз
  // Для простоти: рахуємо від моменту підтвердження (зараз).
  // Час до loading_started = (loadDateIso - now), якщо є, або 0
  let loadingStartedAt;
  if (loadDateIso) {
    try {
      const dt = new Date(loadDateIso);
      if (!isNaN(dt.getTime())) {
        loadingStartedAt = dt.toISOString();
      }
    } catch (e) {}
  }
  if (!loadingStartedAt) {
    // Якщо немає дати завантаження — за 6 год симуляції
    loadingStartedAt = nowPlus(simHoursToMs(6));
  } else if (new Date(loadingStartedAt).getTime() < Date.now()) {
    // Якщо дата вже минула — ставимо через 2 год симуляції
    loadingStartedAt = nowPlus(simHoursToMs(2));
  }

  const inc = scenariosLib.SIM_INTERVALS;

  // Загальна функція додавання інциденту
  function add(type, baseTime, deltaHours, payload = {}) {
    const id = uuidv4();
    const scheduledAt = new Date(new Date(baseTime).getTime() + simHoursToMs(deltaHours)).toISOString();
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id, type, state, scheduled_at, payload_json)
      VALUES (?,?,?,?,?,?,?,'pending',?,?)
    `).run(id, sessionId, studentId, letterId, applicationId || null, scenario, type, scheduledAt, JSON.stringify(payload));
    return { id, scheduledAt };
  }

  // ─── ЛАНЦЮЖОК ПОДІЙ ─────────────────────
  // 1) "Завантажились, виїжаємо" — через 2 год сим від loadingStartedAt
  const loaded = add('loaded_ok', loadingStartedAt, inc.loading_started_to_loaded, { carrier_chat_id: carrierChatId });

  // 2) Після завантаження — через 24 год сим — "на кордоні"
  // Тип залежить від сценарію
  let atBorderType = 'at_border_clear'; // R1, R6, R8 — гладке
  if ([2, 3, 5, 7].includes(scenario)) atBorderType = 'at_border_need_pd'; // R2,R3 ПД; R5,R7 теж з ПД
  if ([4].includes(scenario)) atBorderType = 'at_border_clear'; // R4 — гладко, проблема буде на розвантаженні
  if ([6].includes(scenario)) atBorderType = 'at_border_clear'; // R6 — гладко, проблема на терміналі

  const atBorder = add(atBorderType, loaded.scheduledAt, inc.loaded_to_at_border, {
    carrier_chat_id: carrierChatId,
    next_step: 'arrived_terminal',
  });

  // 3) Після кордону — через 24 год сим — "прибули на термінал" (з запитом довідки)
  const atTerminal = add('at_terminal', atBorder.scheduledAt, inc.at_border_to_arrived_terminal, {
    carrier_chat_id: carrierChatId,
  });

  // 4) Замовник просить довідку — через 30 хв
  const askCert = add('client_ask_certificate', atTerminal.scheduledAt, inc.arrived_terminal_to_ask_cert, {});

  // 5) Прибуття на розвантаження — через 6 год сим (умовно: після того як студент надав довідку)
  // У Деплої 13 — спрощено: тригер настає за часом, не за дією студента
  let atUnloadingType = 'at_unloading_arrived';
  if (scenario === 4) atUnloadingType = 'at_unloading_wait'; // R4: склад не приймає

  const atUnloading = add(atUnloadingType, askCert.scheduledAt, inc.customs_done_to_unloading, {
    carrier_chat_id: carrierChatId,
  });

  // 6) Розвантажились — через 4 год сим
  const unloadingDone = add('unloading_done', atUnloading.scheduledAt, inc.unloading_to_done, {
    carrier_chat_id: carrierChatId,
  });

  // 7) Замовник дякує — через 30 хв
  add('client_delivery_confirmed', unloadingDone.scheduledAt, inc.done_to_client_thanks, {});

  // ─── СЦЕНАРІЙ-СПЕЦИФІЧНІ ДОПОВНЕННЯ ───────
  // R2: ПД-затримка без претензій
  // R3: ПД-затримка + простій
  if ([2, 3].includes(scenario)) {
    // Після at_border (запит ПД) — через 30 хв замовник пише "ПД буде завтра"
    const pdTomorrow = add('client_pd_tomorrow', atBorder.scheduledAt, inc.at_border_to_client_pd_response, {});
    // Через 24 год сим — замовник надсилає ПД
    add('client_pd_sent', pdTomorrow.scheduledAt, inc.client_pd_response_to_pd_sent, {});
    // R2: ще "перевізник чекає мирно" — через 15 хв після ПД-Tomorrow
    if (scenario === 2) {
      add('carrier_waits_calm', pdTomorrow.scheduledAt, 0.25, { carrier_chat_id: carrierChatId });
    }
    // R3: через 12 год без ПД — перевізник вимагає простій
    if (scenario === 3) {
      add('carrier_simple_demand', atBorder.scheduledAt, inc.pd_requested_to_simple_demand, {
        carrier_chat_id: carrierChatId,
        amount: 50, // €50/добу
      });
    }
  }

  // R4: М'якша реакція після затримки розвантаження
  if (scenario === 4) {
    // Замовник погрожує штрафом — за день до розвантаження
    add('client_threat_fine', atTerminal.scheduledAt, 1, {});
    // Після розвантаження — м'яко
    add('client_no_fine_actually', unloadingDone.scheduledAt, inc.delivery_to_no_fine, {});
  }

  // R5: Зрив рейсу — замовник скасовує за день до завантаження
  if (scenario === 5) {
    // ВАЖЛИВО: цей інцидент скасовує всі наступні якщо студент НЕ повідомить
    // ПОКИ ЩО — тільки текст пишемо
    const cancelScheduled = new Date(new Date(loadingStartedAt).getTime() - simHoursToMs(12)).toISOString();
    const cancelId = uuidv4();
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id, type, state, scheduled_at, payload_json)
      VALUES (?,?,?,?,?,?,?,'pending',?,?)
    `).run(cancelId, sessionId, studentId, letterId, applicationId || null, scenario,
      'client_cancel_order', cancelScheduled, JSON.stringify({ is_breaking: true }));
  }

  // R6: Розмитнення без простоїв — замінюємо клієнтський запит на повідомлення про затримку
  if (scenario === 6) {
    add('carrier_customs_delay', atTerminal.scheduledAt, 1, { carrier_chat_id: carrierChatId });
    add('client_customs_delay', atTerminal.scheduledAt, 1.5, {});
  }

  // R7: Розмитнення + простої
  if (scenario === 7) {
    add('carrier_customs_delay', atTerminal.scheduledAt, 1, { carrier_chat_id: carrierChatId });
    add('carrier_customs_simple_demand', atTerminal.scheduledAt, inc.arrived_terminal_to_customs_simple, {
      carrier_chat_id: carrierChatId,
      amount: 50,
    });
  }

  // R8: помилка в документах (EXW)
  if (scenario === 8) {
    // Замовник пише про помилку після того як отримав довідку
    add('client_docs_error_exw', askCert.scheduledAt, inc.cert_sent_to_docs_error, {});
  }

  console.log(`[incident-sched] R${scenario}: заплановано інциденти для letter=${letterId.slice(0,8)}`);
}

// ────────────────────────────────────────────────────────────
// Спрацьовування одного інциденту
// ────────────────────────────────────────────────────────────
function fireIncident(incident) {
  const payload = (() => { try { return JSON.parse(incident.payload_json || '{}'); } catch(e) { return {}; } })();
  const text = scenariosLib.pickRandom(scenariosLib.textPoolForType(incident.type));
  if (!text) {
    console.warn(`[incident-fire] немає тексту для типу ${incident.type}`);
    db.prepare(`UPDATE incidents SET state='cancelled', fired_at=datetime('now') WHERE id=?`).run(incident.id);
    return;
  }

  const channel = scenariosLib.channelForType(incident.type);
  const nowIso = new Date().toISOString();

  if (channel === 'carrier') {
    // Пишемо у chat з перевізником
    const carrierChatId = payload.carrier_chat_id;
    if (!carrierChatId) {
      console.warn(`[incident-fire] немає carrier_chat_id для ${incident.id}`);
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=datetime('now') WHERE id=?`).run(incident.id);
      return;
    }
    const chat = db.prepare('SELECT * FROM carrier_chats WHERE id=?').get(carrierChatId);
    if (!chat) {
      console.warn(`[incident-fire] chat ${carrierChatId} не знайдено`);
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=datetime('now') WHERE id=?`).run(incident.id);
      return;
    }
    const msgs = JSON.parse(chat.messages || '[]');
    msgs.push({
      role: 'carrier',
      text,
      time: new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }),
      ts: nowIso,
      read: false,
      from_incident: incident.id,
    });
    db.prepare('UPDATE carrier_chats SET messages=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(msgs), nowIso, carrierChatId);

    // Оновлюємо order_progress.state згідно типу
    updateOrderState(incident);
  } else {
    // Пишемо у email_threads (замовник)
    const letter = db.prepare('SELECT * FROM letters WHERE id=?').get(incident.letter_id);
    if (!letter) {
      console.warn(`[incident-fire] letter ${incident.letter_id} не знайдено`);
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=datetime('now') WHERE id=?`).run(incident.id);
      return;
    }
    let thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?').get(incident.session_id, incident.letter_id);
    if (!thread) {
      // Створюємо новий thread
      const tid = uuidv4();
      db.prepare(`INSERT INTO email_threads (id, session_id, letter_id, messages) VALUES (?,?,?,?)`)
        .run(tid, incident.session_id, incident.letter_id, JSON.stringify([]));
      thread = db.prepare('SELECT * FROM email_threads WHERE id=?').get(tid);
    }
    const msgs = JSON.parse(thread.messages || '[]');
    msgs.push({
      role: 'ai',
      text,
      ts: nowIso,
      from_incident: incident.id,
    });
    db.prepare('UPDATE email_threads SET messages=? WHERE id=?').run(JSON.stringify(msgs), thread.id);

    updateOrderState(incident);
  }

  // Позначаємо інцидент як виконаний
  db.prepare(`UPDATE incidents SET state='triggered', fired_at=? WHERE id=?`).run(nowIso, incident.id);
}

// ────────────────────────────────────────────────────────────
// Оновлення order_progress.state на основі типу інциденту
// ────────────────────────────────────────────────────────────
function updateOrderState(incident) {
  const stateMap = {
    'loaded_ok': { state: 'loaded', timestamp: 'loaded_at' },
    'at_border_clear': { state: 'at_border', timestamp: 'at_border_at' },
    'at_border_need_pd': { state: 'pd_requested', timestamp: 'pd_requested_at' },
    'client_pd_sent': { state: 'pd_sent', timestamp: 'pd_sent_at' },
    'at_terminal': { state: 'at_customs_dst', timestamp: 'at_customs_at' },
    'at_unloading_arrived': { state: 'at_unloading' },
    'at_unloading_wait': { state: 'at_unloading' },
    'unloading_done': { state: 'unloaded', timestamp: 'delivered_at' },
    'client_delivery_confirmed': { state: 'closed' },
  };
  const map = stateMap[incident.type];
  if (!map) return;

  // Знаходимо order_progress для цього letter
  const op = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
    .get(incident.session_id, incident.letter_id);
  if (!op) return;

  if (map.timestamp) {
    db.prepare(`UPDATE order_progress SET state=?, ${map.timestamp}=? WHERE id=?`)
      .run(map.state, new Date().toISOString(), op.id);
  } else {
    db.prepare(`UPDATE order_progress SET state=? WHERE id=?`).run(map.state, op.id);
  }
}

// ────────────────────────────────────────────────────────────
// Cron: перевірити заплановані інциденти і запустити готові
// ────────────────────────────────────────────────────────────
function runDueIncidents(sessionIdFilter) {
  const now = new Date().toISOString();
  let pending;
  if (sessionIdFilter) {
    pending = db.prepare(`
      SELECT * FROM incidents
      WHERE state='pending' AND scheduled_at <= ? AND session_id=?
      ORDER BY scheduled_at ASC
      LIMIT 50
    `).all(now, sessionIdFilter);
  } else {
    pending = db.prepare(`
      SELECT * FROM incidents
      WHERE state='pending' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
      LIMIT 100
    `).all(now);
  }
  if (pending.length === 0) return 0;

  // Перевіряємо що session активна
  for (const inc of pending) {
    const session = db.prepare(`SELECT status FROM sessions WHERE id=?`).get(inc.session_id);
    if (!session || session.status === 'stopped') {
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`).run(now, inc.id);
      continue;
    }
    try {
      fireIncident(inc);
      // Оновлюємо session.version для тригеру polling у браузера
      db.prepare(`UPDATE sessions SET version=? WHERE id=?`).run(new Date().toISOString(), inc.session_id);
    } catch (e) {
      console.error(`[incident-fire] error ${inc.id}:`, e.message);
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`).run(now, inc.id);
    }
  }

  console.log(`[incident-sched] Виконано ${pending.length} інцидентів`);
  return pending.length;
}

// ────────────────────────────────────────────────────────────
// Запуск cron — викликається з index.js
// ────────────────────────────────────────────────────────────
let cronTimer = null;
function startCron(intervalMs = 60 * 1000) { // щохвилини
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = setInterval(() => {
    try { runDueIncidents(); } catch (e) { console.error('[incident-cron]', e.message); }
  }, intervalMs);
  console.log(`[incident-sched] Cron запущено: інтервал ${intervalMs}ms`);
}

function stopCron() {
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = null;
}

// ────────────────────────────────────────────────────────────
// Reactive: студент не повідомив замовника про відмову перевізника
// ────────────────────────────────────────────────────────────
function scheduleReactiveIncidentsCarrierRefused({ sessionId, studentId, letterId, applicationId, scenarioId, loadDateIso }) {
  // Якщо студент не повідомить замовника за 6 год сим — замовник пише "де авто?"
  // Це інцидент який скасовується якщо студент таки повідомить.
  const id = uuidv4();
  const scheduledAt = nowPlus(simHoursToMs(6));
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id, type, state, scheduled_at, payload_json)
    VALUES (?,?,?,?,?,?,?,'pending',?,?)
  `).run(id, sessionId, studentId, letterId, applicationId || null, scenarioId || null,
    'client_where_is_truck', scheduledAt, JSON.stringify({ reactive: true, reason: 'carrier_refused_not_informed' }));
  console.log(`[incident-sched] Reactive: 'де авто?' заплановано через 6 год сим`);
}

// Студент повідомив замовника — скасовуємо реактивний "де авто?"
function cancelReactiveIncidents({ sessionId, letterId, types }) {
  const placeholders = types.map(() => '?').join(',');
  const result = db.prepare(`
    UPDATE incidents SET state='cancelled', fired_at=datetime('now')
    WHERE state='pending' AND session_id=? AND letter_id=? AND type IN (${placeholders})
  `).run(sessionId, letterId, ...types);
  if (result.changes > 0) {
    console.log(`[incident-sched] Скасовано ${result.changes} реактивних інцидентів`);
  }
}

// ────────────────────────────────────────────────────────────
// Resume points (накопичуємо одразу)
// ────────────────────────────────────────────────────────────
function addResumePoint({ sessionId, studentId, letterId, applicationId, type, impact, context }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO resume_points (id, session_id, student_id, letter_id, application_id, type, impact, context_json)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(id, sessionId, studentId, letterId || null, applicationId || null, type, impact, JSON.stringify(context || {}));
}

module.exports = {
  scheduleInitialIncidents,
  scheduleReactiveIncidentsCarrierRefused,
  cancelReactiveIncidents,
  runDueIncidents,
  startCron,
  stopCron,
  addResumePoint,
  SIM_HOUR_MS_REAL,
};
