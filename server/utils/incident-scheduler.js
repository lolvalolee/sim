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
const documentChecker = require('./document-checker');

// Один сим-час = 10 хв реального (день 120хв = 12 сим-год 9:00-21:00)
// Збігається з CFG.dayDuration=120 у simulator.html
const SIM_HOUR_MS_REAL = 10 * 60 * 1000;

// Швидкість фури — км за робочий день (12 сим-год)
const KM_PER_DAY = 650;
const SIM_WORK_HOURS = 12;

function simHoursToMs(hours) {
  return Math.round(hours * SIM_HOUR_MS_REAL);
}

// Переводимо відстань (км) у робочі сим-години їзди
// dist=650км → 12 сим-год (рівно робочий день)
function kmToSimHours(km) {
  if (!km || km <= 0) return 1; // мінімум 1 сим-год
  return (km / KM_PER_DAY) * SIM_WORK_HOURS;
}

// Допоміжне: now+ms у вигляді ISO
function nowPlus(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function parseDmy(dmy) {
  const p = String(dmy || '').split('.');
  if (p.length !== 3) return null;
  const d = new Date(+p[2], +p[1] - 1, +p[0]);
  return Number.isFinite(d.getTime()) ? d : null;
}

function compareDmy(a, b) {
  const da = parseDmy(a);
  const db = parseDmy(b);
  if (!da || !db) return 0;
  const ta = da.getTime();
  const tb = db.getTime();
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

function dmyToSimDay(startDmy, targetDmy) {
  const start = parseDmy(startDmy);
  const target = parseDmy(targetDmy);
  if (!start || !target) return 1;
  start.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((target - start) / 86400000) + 1);
}

/** Розбіжність дат після Confirm: клієнт 27 / перевізник 28 або навпаки */
function scheduleDateMismatchIncidents({
  sessionId, studentId, letterId, clientDate, carrierDate, carrierChatId, scenarioId,
}) {
  if (!sessionId || !letterId || !clientDate || !carrierDate) return;
  if (clientDate === carrierDate) return;

  const cmp = compareDmy(clientDate, carrierDate);
  if (cmp === 0) return;

  const existing = db.prepare(`
    SELECT 1 FROM incidents
    WHERE session_id=? AND letter_id=? AND type IN ('client_date_mismatch','carrier_date_mismatch')
      AND state IN ('pending','triggered')
    LIMIT 1
  `).get(sessionId, letterId);
  if (existing) return;

  const sess = db.prepare('SELECT start_date FROM sessions WHERE id=?').get(sessionId);
  if (!sess?.start_date) return;

  const id = uuidv4();
  const nowIso = new Date().toISOString();

  if (cmp < 0) {
    // Замовник раніше: у день clientDate пише «де машина?»
    const simDay = dmyToSimDay(sess.start_date, clientDate);
    const targetSimHourAbs = (simDay - 1) * 12 + 1; // ~10:00 сим
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, scenario_id, type, state, scheduled_at, payload_json)
      VALUES (?,?,?,?,?,?,'pending',?,?)
    `).run(
      id, sessionId, studentId, letterId, scenarioId || null,
      'client_date_mismatch', nowIso,
      JSON.stringify({
        client_date: clientDate,
        carrier_date: carrierDate,
        target_sim_day: simDay,
        target_sim_hour_abs: targetSimHourAbs,
      })
    );
    console.log(`[incident-sched] date-mismatch: client ${clientDate} < carrier ${carrierDate} → client пише день ${simDay}`);
  } else {
    // Перевізник раніше: у день carrierDate пише «на місці, вантаж не готовий»
    const simDay = dmyToSimDay(sess.start_date, carrierDate);
    const targetSimHourAbs = (simDay - 1) * 12 + 1;
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, scenario_id, type, state, scheduled_at, payload_json)
      VALUES (?,?,?,?,?,?,'pending',?,?)
    `).run(
      uuidv4(), sessionId, studentId, letterId, scenarioId || null,
      'carrier_date_mismatch', nowIso,
      JSON.stringify({
        client_date: clientDate,
        carrier_date: carrierDate,
        carrier_chat_id: carrierChatId || null,
        target_sim_day: simDay,
        target_sim_hour_abs: targetSimHourAbs,
      })
    );
    console.log(`[incident-sched] date-mismatch: carrier ${carrierDate} < client ${clientDate} → carrier пише день ${simDay}`);
  }

  try {
    addResumePoint({
      sessionId, studentId, letterId,
      type: 'date_mismatch_scheduled',
      impact: -1,
      context: { client_date: clientDate, carrier_date: carrierDate },
    });
  } catch (e) {}
}

// ────────────────────────────────────────────────────────────
// Планування початкових інцидентів при підтвердженні угоди
// ────────────────────────────────────────────────────────────
function scheduleInitialIncidents({ sessionId, studentId, letterId, applicationId, scenarioId, carrierChatId, loadDateIso, distToBorder, distAfterBorder }) {
  if (!sessionId || !studentId || !letterId) {
    console.warn('[incident-sched] scheduleInitialIncidents: missing params');
    return;
  }
  const scenario = scenarioId || 1;

  // Інтервали на основі реальних відстаней (з ODS Симулятор_1_1)
  // Якщо відстані не задані — фолбек на старі фіксовані значення
  const hoursToBorder = distToBorder ? kmToSimHours(distToBorder) : 24;
  const hoursAfterBorder = distAfterBorder ? kmToSimHours(distAfterBorder) : 24;

  // Базовий час відліку — або дата завантаження (loadDateIso), або зараз
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

  // A (сим-час): абсолютна сим-година завантаження від старту сесії.
  // 12 сим-год = 1 день. loadSimHourAbs = (loadSimDay-1)*12 (завантаження зранку дня).
  const sess = db.prepare('SELECT start_date FROM sessions WHERE id=?').get(sessionId);
  let loadSimDay = 1;
  try {
    if (sess && sess.start_date && loadDateIso) {
      const [sd, sm, sy] = sess.start_date.split('.').map(Number);
      const startD = new Date(sy, sm - 1, sd);
      const loadD = new Date(loadDateIso);
      if (!isNaN(loadD.getTime())) {
        loadSimDay = Math.max(1, Math.round((loadD - startD) / 86400000) + 1);
      }
    }
  } catch (e) {}
  const loadSimHourAbs = (loadSimDay - 1) * 12; // абсолютна сим-година завантаження

  // Загальна функція додавання інциденту.
  function add(type, baseTime, deltaHours, payload = {}) {
    const id = uuidv4();
    const scheduledAt = new Date(new Date(baseTime).getTime() + simHoursToMs(deltaHours)).toISOString();
    // №3: target по абсолютній сим-годині — рахуємо скільки СИМ-ГОДИН від моменту
    // завантаження до цього етапу (з реального інтервалу scheduledAt − loadingStartedAt).
    // Так етапи рознесені в сим-часі і не вистрілюють усі разом.
    let simHoursFromLoad = 0;
    try {
      const ms = new Date(scheduledAt).getTime() - new Date(loadingStartedAt).getTime();
      simHoursFromLoad = Math.max(0, ms / simHoursToMs(1)); // реальні ms → сим-години
    } catch (e) {}
    const targetSimHourAbs = loadSimHourAbs + simHoursFromLoad;
    const targetSimDay = loadSimDay + Math.floor(simHoursFromLoad / 12);
    const payloadWithTarget = { ...payload, target_sim_day: targetSimDay, target_sim_hour_abs: targetSimHourAbs };
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id, type, state, scheduled_at, payload_json)
      VALUES (?,?,?,?,?,?,?,'pending',?,?)
    `).run(id, sessionId, studentId, letterId, applicationId || null, scenario, type, scheduledAt, JSON.stringify(payloadWithTarget));
    return { id, scheduledAt };
  }

  // ─── ЛАНЦЮЖОК ПОДІЙ ─────────────────────
  // 1) "Завантажились, виїжаємо" — через 2 год сим від loadingStartedAt
  const loaded = add('loaded_ok', loadingStartedAt, inc.loading_started_to_loaded, { carrier_chat_id: carrierChatId });

  // 2) Після завантаження — ЧЕРЕЗ ВІДСТАНЬ ДО КОРДОНУ — "на кордоні"
  let atBorderType = 'at_border_clear'; // R1, R6, R8 — гладке
  if ([2, 3, 5, 7].includes(scenario)) atBorderType = 'at_border_need_pd'; // R2,R3 ПД; R5,R7 теж з ПД
  if ([4].includes(scenario)) atBorderType = 'at_border_clear'; // R4 — гладко, проблема буде на розвантаженні
  if ([6].includes(scenario)) atBorderType = 'at_border_clear'; // R6 — гладко, проблема на терміналі

  const atBorder = add(atBorderType, loaded.scheduledAt, hoursToBorder, {
    carrier_chat_id: carrierChatId,
    next_step: 'arrived_terminal',
  });

  // 3) Після кордону — ЧЕРЕЗ ВІДСТАНЬ ПІСЛЯ КОРДОНУ — "прибули на термінал"
  const atTerminal = add('at_terminal', atBorder.scheduledAt, hoursAfterBorder, {
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
    // Замовник погрожує штрафом — за день до прибуття на термінал
    add('client_threat_fine', atTerminal.scheduledAt, -2, {});
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

  // R6: Розмитнення без простоїв
  // Перевізник пише що термінал затримує + замовник підтверджує
  // ВАЖЛИВО: зсуваємо наступні події (unloading тощо) на +24год сим бо розмитнення затягнулось
  if (scenario === 6) {
    add('carrier_customs_delay', atTerminal.scheduledAt, 1, { carrier_chat_id: carrierChatId });
    add('client_customs_will_delay', atTerminal.scheduledAt, 1.5, {});
    // Зсуваємо at_unloading, unloading_done, client_delivery_confirmed +24год
    const shiftSeconds = Math.round(simHoursToMs(24) / 1000);
    db.prepare(`
      UPDATE incidents SET scheduled_at = datetime(scheduled_at, '+' || ? || ' seconds')
      WHERE letter_id=? AND state='pending'
      AND type IN ('at_unloading_arrived','at_unloading_wait','unloading_done','client_delivery_confirmed')
    `).run(shiftSeconds, letterId);
  }

  // R7: Розмитнення + простої
  // Як R6 + перевізник вимагає €50/добу простою
  if (scenario === 7) {
    add('carrier_customs_delay', atTerminal.scheduledAt, 1, { carrier_chat_id: carrierChatId });
    // Простій-вимога — створюється з demand_amount щоб торг знав суму
    const simpleId = uuidv4();
    const simpleScheduled = new Date(new Date(atTerminal.scheduledAt).getTime()
      + simHoursToMs(inc.arrived_terminal_to_customs_simple)).toISOString();
    db.prepare(`
      INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id,
                              type, state, scheduled_at, payload_json, demand_amount)
      VALUES (?,?,?,?,?,?,?,'pending',?,?,?)
    `).run(simpleId, sessionId, studentId, letterId, applicationId || null, scenario,
      'carrier_customs_simple_demand', simpleScheduled,
      JSON.stringify({ carrier_chat_id: carrierChatId, amount: 50 }), 50);
    // Зсуваємо наступні події +48год сим (2 доби простою)
    const shiftSeconds = Math.round(simHoursToMs(48) / 1000);
    db.prepare(`
      UPDATE incidents SET scheduled_at = datetime(scheduled_at, '+' || ? || ' seconds')
      WHERE letter_id=? AND state='pending'
      AND type IN ('at_unloading_arrived','at_unloading_wait','unloading_done','client_delivery_confirmed')
    `).run(shiftSeconds, letterId);
  }

  // R3: Затримка ПД + простій — додаємо demand_amount до раніше створеного інциденту
  if (scenario === 3) {
    db.prepare(`
      UPDATE incidents SET demand_amount=50
      WHERE session_id=? AND letter_id=? AND type='carrier_simple_demand' AND state='pending'
    `).run(sessionId, letterId);
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
  let text = scenariosLib.pickRandom(scenariosLib.textPoolForType(incident.type));
  if (!text) {
    console.warn(`[incident-fire] немає тексту для типу ${incident.type}`);
    db.prepare(`UPDATE incidents SET state='cancelled', fired_at=datetime('now') WHERE id=?`).run(incident.id);
    return;
  }

  // Деплой 24b: замовник присилає ПД з РЕАЛЬНИМ номером (letters.pd_number)
  if (incident.type === 'client_pd_sent') {
    const l = db.prepare('SELECT pd_number FROM letters WHERE id=?').get(incident.letter_id);
    if (l?.pd_number) text = `${text}\nПД: ${l.pd_number}`;
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

  // Реактивне планування для R5 — якщо замовник скасував, плануємо
  // інцидент "де заявка?" від перевізника на день завантаження
  if (incident.type === 'client_cancel_order') {
    const op = db.prepare(`SELECT carrier_id FROM order_progress WHERE session_id=? AND letter_id=?`)
      .get(incident.session_id, incident.letter_id);
    if (op?.carrier_id) {
      const chat = db.prepare(`SELECT id FROM carrier_chats WHERE session_id=? AND carrier_id=?`)
        .get(incident.session_id, op.carrier_id);
      if (chat) {
        scheduleReactiveIfNotInformed({
          sessionId: incident.session_id,
          studentId: incident.student_id,
          letterId: incident.letter_id,
          scenarioId: incident.scenario_id,
          carrierChatId: chat.id,
        });
      }
    }
  }

  // Реактивне нагадування ПД: перевізник попросив ПД → якщо студент
  // не переслав за 4 сим-год → перевізник нагадує з тиском.
  // Нагадування скасується коли настане стан pd_sent (updateOrderState).
  if (incident.type === 'at_border_need_pd') {
    const payload = (() => { try { return JSON.parse(incident.payload_json||'{}'); } catch(e){ return {}; } })();
    scheduleReminder({
      sessionId: incident.session_id,
      studentId: incident.student_id,
      letterId: incident.letter_id,
      scenarioId: incident.scenario_id,
      type: 'carrier_pd_reminder',
      delayHours: 4,
      payload: { carrier_chat_id: payload.carrier_chat_id, reactive: true },
    });
  }

  // Реактивне нагадування про документи: замовник вказав помилку EXW →
  // якщо студент не виправив за 4 сим-год → нагадування.
  // Скасується коли студент надішле виправлену довідку (handleCertificateSubmission).
  if (incident.type === 'client_docs_error_exw') {
    scheduleReminder({
      sessionId: incident.session_id,
      studentId: incident.student_id,
      letterId: incident.letter_id,
      scenarioId: incident.scenario_id,
      type: 'client_docs_reminder',
      delayHours: 4,
      payload: { reactive: true },
    });
  }
}

// ────────────────────────────────────────────────────────────
// Реактивне нагадування — планує інцидент-нагадування через delayHours
// ────────────────────────────────────────────────────────────
function scheduleReminder({ sessionId, studentId, letterId, scenarioId, type, delayHours, payload }) {
  // Перевіряємо що такого нагадування ще не заплановано
  const existing = db.prepare(`
    SELECT COUNT(*) as cnt FROM incidents
    WHERE session_id=? AND letter_id=? AND type=? AND state='pending'
  `).get(sessionId, letterId, type);
  if (existing.cnt > 0) return;

  const id = uuidv4();
  const scheduledAt = nowPlus(simHoursToMs(delayHours));
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, scenario_id, type, state, scheduled_at, payload_json)
    VALUES (?,?,?,?,?,?,'pending',?,?)
  `).run(id, sessionId, studentId, letterId, scenarioId || null, type, scheduledAt, JSON.stringify(payload || {}));
  console.log(`[incident-sched] Reactive reminder '${type}' через ${delayHours} сим-год`);
}

// ────────────────────────────────────────────────────────────
// Оновлення order_progress.state на основі типу інциденту
// ────────────────────────────────────────────────────────────
function updateOrderState(incident) {
  const stateMap = {
    'loaded_ok': { state: 'loaded', timestamp: 'loaded_at' },
    'at_border_clear': { state: 'at_border', timestamp: 'at_border_at' },
    'at_border_need_pd': { state: 'pd_requested', timestamp: 'pd_requested_at' },
    // Деплой 24b: 'client_pd_sent' БІЛЬШЕ НЕ перемикає стан — pd_sent ставиться
    // тільки коли студент переслав ПРАВИЛЬНИЙ номер перевізнику (handlePdDetection)
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

  // Коли ПД надіслано — скасовуємо реактивне нагадування про ПД
  if (incident.type === 'client_pd_sent') {
    const r = db.prepare(`
      UPDATE incidents SET state='cancelled', fired_at=datetime('now')
      WHERE session_id=? AND letter_id=? AND type='carrier_pd_reminder' AND state='pending'
    `).run(incident.session_id, incident.letter_id);
    if (r.changes > 0) console.log(`[incident-sched] Скасовано ПД-нагадування (студент переслав ПД)`);
  }

  // Деплой 24a Баг 1: коли машина завантажилась (loaded_ok) — більше не нагадуємо
  // про заявку (перевізник вже завантажився, формальна заявка може бути постфактум)
  if (incident.type === 'loaded_ok') {
    const r = db.prepare(`
      UPDATE incidents SET state='cancelled', fired_at=datetime('now')
      WHERE session_id=? AND letter_id=? AND type='carrier_asks_where_address' AND state='pending'
    `).run(incident.session_id, incident.letter_id);
    if (r.changes > 0) console.log(`[incident-sched] Скасовано нагадування про заявку (вже loaded)`);
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

  // Перевіряємо що session активна (Деплой 24a баг 7: пропускаємо сесії на паузі)
  let firedCount = 0;
  for (const inc of pending) {
    const session = db.prepare(`SELECT status, paused, timer_day, timer_ms, start_date FROM sessions WHERE id=?`).get(inc.session_id);
    if (!session || session.status === 'stopped') {
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`).run(now, inc.id);
      continue;
    }
    // Якщо сесія на паузі — пропускаємо, не запускаємо інцидент
    if (session.paused) {
      continue;
    }
    // ── A (сим-час): подія не настає раніше за свою сим-годину ──
    // Кожен етап має target_sim_hour_abs (абсолютна сим-година від старту, коли має
    // статись). Поточна сим-година сесії = (timer_day-1)*12 + година в дні.
    // Якщо студент ще не дійшов — НЕ стріляємо. Це рознесло етапи рейсу в часі
    // (раніше всі вистрілювали разом, бо звіряли лише день).
    let payload = {}; try { payload = JSON.parse(inc.payload_json || '{}'); } catch(e){}
    const SIM_HOUR_MS_REAL = 10 * 60 * 1000; // 1 сим-год = 10 хв реальних
    const DAY_MIN_REAL = 120; // 120 хв реальних = 1 сим-день = 12 сим-год
    const curDay = session.timer_day || 1;
    const hourInDay = Math.min(12, Math.floor((session.timer_ms || 0) % (DAY_MIN_REAL*60*1000) / SIM_HOUR_MS_REAL));
    const curSimHourAbs = (curDay - 1) * 12 + hourInDay;
    if (payload.target_sim_hour_abs != null) {
      if (curSimHourAbs < payload.target_sim_hour_abs) {
        continue; // студент ще не дійшов до сим-години події — чекаємо
      }
    } else if (payload.target_sim_day != null) {
      if (curDay < payload.target_sim_day) continue; // fallback для старих інцидентів
    }

    // Не «завантажились» раніше дати завантаження перевізника
    if (inc.type === 'loaded_ok') {
      const op = db.prepare('SELECT carrier_agreed_date FROM order_progress WHERE session_id=? AND letter_id=?')
        .get(inc.session_id, inc.letter_id);
      const loadDmy = op?.carrier_agreed_date;
      if (loadDmy && session.start_date) {
        const loadDay = dmyToSimDay(session.start_date, loadDmy);
        if (curDay < loadDay) continue;
      }
    }

    try {
      fireIncident(inc);
      firedCount++;
      // version НЕ чіпаємо: студент дізнається про подію через пошту/чат (лічильник+звук).
      // version смикає ТІЛЬКИ лектор (рестарт/стоп/дата). Інакше фронт хибно показує
      // "лектор оновив сесію" і робить зайвий reload → розсинхрон.
    } catch (e) {
      console.error(`[incident-fire] error ${inc.id}:`, e.message);
      db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`).run(now, inc.id);
    }
  }

  if (firedCount) console.log(`[incident-sched] Виконано ${firedCount} інцидентів`);
  return firedCount;
}

// ════════════════════════════════════════════════════════════
// ДЕПЛОЙ 25c — перевірка документів через cron (детермінована)
// Бере order_documents зі status='sent' і check_due_at<=now,
// викликає checker, пише шаблонну фразу в чат/тред, оновлює status.
// ════════════════════════════════════════════════════════════
function runDueDocumentChecks(sessionIdFilter) {
  const now = new Date().toISOString();
  let docs;
  if (sessionIdFilter) {
    docs = db.prepare(`
      SELECT * FROM order_documents
      WHERE status='sent' AND check_due_at <= ? AND session_id=?
      ORDER BY check_due_at ASC LIMIT 50
    `).all(now, sessionIdFilter);
  } else {
    docs = db.prepare(`
      SELECT * FROM order_documents
      WHERE status='sent' AND check_due_at <= ?
      ORDER BY check_due_at ASC LIMIT 100
    `).all(now);
  }
  if (docs.length === 0) return 0;

  let processed = 0;
  for (const doc of docs) {
    const session = db.prepare(`SELECT status, paused, student_id FROM sessions WHERE id=?`).get(doc.session_id);
    if (!session || session.status === 'stopped') {
      // сесію скинуто/зупинено — позначаємо документ як перевірений без дії
      db.prepare(`UPDATE order_documents SET status='accepted', checked_at=? WHERE id=?`).run(now, doc.id);
      continue;
    }
    if (session.paused) continue; // на паузі — чекаємо

    try {
      const letter = db.prepare('SELECT dirs, dist_to_border, dist_after_border, incoterms FROM letters WHERE id=?').get(doc.letter_id);
      let payload = {}; try { payload = JSON.parse(doc.payload_json || '{}'); } catch (e) {}
      const result = documentChecker.checkDocument(doc.doc_type, payload, letter || {});
      const text = documentChecker.buildReplyText(doc.doc_type, result);
      const nowIso = new Date().toISOString();
      const timeStr = new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });

      if (doc.doc_type === 'application') {
        // Заявку перевіряє ПЕРЕВІЗНИК → пишемо в carrier_chats
        if (doc.carrier_id) {
          const chat = db.prepare(`SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?`)
            .get(doc.session_id, doc.carrier_id);
          if (chat) {
            const msgs = JSON.parse(chat.messages || '[]');
            msgs.push({ role: 'carrier', text, time: timeStr, ts: nowIso, read: false, from_doc: doc.id });
            db.prepare('UPDATE carrier_chats SET messages=?, updated_at=? WHERE id=?')
              .run(JSON.stringify(msgs), nowIso, chat.id);
          }
        }
      } else {
        // Довідку/рахунок/акт перевіряє ЗАМОВНИК → пишемо в email_threads
        let thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?')
          .get(doc.session_id, doc.letter_id);
        if (!thread) {
          const tid = uuidv4();
          db.prepare(`INSERT INTO email_threads (id, session_id, letter_id, messages) VALUES (?,?,?,?)`)
            .run(tid, doc.session_id, doc.letter_id, JSON.stringify([]));
          thread = db.prepare('SELECT * FROM email_threads WHERE id=?').get(tid);
        }
        const msgs = JSON.parse(thread.messages || '[]');
        msgs.push({ role: 'ai', text, ts: nowIso, from_doc: doc.id });
        db.prepare('UPDATE email_threads SET messages=? WHERE id=?').run(JSON.stringify(msgs), thread.id);
      }

      // Оновлюємо статус документа
      db.prepare(`UPDATE order_documents SET status=?, errors_json=?, checked_at=? WHERE id=?`)
        .run(result.ok ? 'accepted' : 'error', JSON.stringify(result.errors || []), nowIso, doc.id);

      // Резюме (impact): прийнято +1, помилка -1
      try {
        addResumePoint({
          sessionId: doc.session_id, studentId: session.student_id, letterId: doc.letter_id,
          type: `doc_${doc.doc_type}_${result.ok ? 'ok' : 'err'}`,
          impact: result.ok ? 1 : -1,
          context: { doc_id: doc.id, errors: result.errors },
        });
      } catch (e) {}

      // Тригер polling браузера
      /* version НЕ чіпаємо: подія доставляється через пошту/чат, version смикає тільки лектор */
      processed++;
    } catch (e) {
      console.error(`[doc-check] error ${doc.id}:`, e.message);
      // щоб не зациклити — позначаємо accepted (не блокуємо студента)
      db.prepare(`UPDATE order_documents SET status='accepted', checked_at=? WHERE id=?`).run(now, doc.id);
    }
  }
  if (processed) console.log(`[doc-check] Перевірено ${processed} документів`);
  return processed;
}

// ────────────────────────────────────────────────────────────
// Запуск cron — викликається з index.js
// ────────────────────────────────────────────────────────────
let cronTimer = null;
function startCron(intervalMs = 60 * 1000) { // щохвилини
  if (cronTimer) clearInterval(cronTimer);
  cronTimer = setInterval(() => {
    try { runDueIncidents(); } catch (e) { console.error('[incident-cron]', e.message); }
    try { runDueDocumentChecks(); } catch (e) { console.error('[doc-check-cron]', e.message); }
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

// ────────────────────────────────────────────────────────────
// ТОРГ ПРОСТОЯМИ
// ────────────────────────────────────────────────────────────

// Знаходимо активний інцидент простою для рейсу студента
function findActiveSimpleIncident({ sessionId, letterId }) {
  return db.prepare(`
    SELECT * FROM incidents
    WHERE session_id=? AND letter_id=? AND state='triggered'
    AND type IN ('carrier_simple_demand','carrier_customs_simple_demand',
                 'carrier_simple_demand_round2','carrier_simple_demand_firm','carrier_simple_demand_compromise')
    ORDER BY scheduled_at DESC
    LIMIT 1
  `).get(sessionId, letterId);
}

// Студент пробує домовитись з перевізником про менший простій
// Викликається при натисканні кнопки у модалці
function studentNegotiateCarrier({ sessionId, letterId, action, payload }) {
  const incident = findActiveSimpleIncident({ sessionId, letterId });
  if (!incident) return { ok: false, error: 'no_active_simple' };

  const round = (incident.negotiation_round || 0) + 1;
  let newType = null;
  let resumeImpact = 0;
  let resumeType = null;

  if (action === 'try_drop') {
    // Спробувати відмовити в простоях повністю (тиснути)
    // 50% — перевізник погоджується, 50% — наполягає
    const success = Math.random() < 0.5;
    newType = success ? 'carrier_simple_demand_dropped' : 'carrier_simple_demand_firm';
    if (success) {
      resumeType = 'simple_avoided';
      resumeImpact = 2;
    }
  } else if (action === 'try_lower') {
    // Спробувати скинути ціну
    // 70% — перевізник зменшує
    const success = Math.random() < 0.7;
    newType = success ? 'carrier_simple_demand_compromise' : 'carrier_simple_demand_round2';
    if (success) {
      resumeType = 'simple_compromise';
      resumeImpact = 1;
    }
  }

  if (!newType) return { ok: false, error: 'unknown_action' };

  // Створюємо НОВИЙ інцидент-відповідь від перевізника (триггериться відразу)
  const newId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id,
                            type, state, scheduled_at, payload_json, negotiation_round)
    VALUES (?,?,?,?,?,?,?,'pending',?,?,?)
  `).run(newId, incident.session_id, incident.student_id, incident.letter_id, incident.application_id,
         incident.scenario_id, newType, now,
         JSON.stringify({ ...JSON.parse(incident.payload_json || '{}'), parent_incident: incident.id }),
         round);

  // Записуємо resume_point якщо потрібно
  if (resumeType) {
    addResumePoint({
      sessionId: incident.session_id,
      studentId: incident.student_id,
      letterId: incident.letter_id,
      applicationId: incident.application_id,
      type: resumeType,
      impact: resumeImpact,
      context: { round, action },
    });
  }

  // Виконуємо одразу — щоб студент побачив відповідь негайно
  const newInc = db.prepare(`SELECT * FROM incidents WHERE id=?`).get(newId);
  fireIncident(newInc);

  // Оновлюємо session.version
  /* version НЕ чіпаємо: подія доставляється через пошту/чат, version смикає тільки лектор */

  return { ok: true, round, new_type: newType };
}

// Студент пробує домовитись з замовником про оплату простоїв
function studentNegotiateClient({ sessionId, letterId, amount }) {
  const incident = findActiveSimpleIncident({ sessionId, letterId });
  if (!incident) return { ok: false, error: 'no_active_simple' };

  // 60% — замовник відмовляється повністю
  // 30% — часткова згода
  // 10% — повна згода
  const roll = Math.random();
  let clientType, clientDecision;
  if (roll < 0.6) {
    clientType = 'client_simple_refuse';
    clientDecision = 'refused';
  } else if (roll < 0.9) {
    clientType = 'client_simple_partial';
    clientDecision = 'partial';
  } else {
    clientType = 'client_simple_agree';
    clientDecision = 'agreed';
  }

  // Створюємо інцидент-відповідь від замовника
  const newId = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, application_id, scenario_id,
                            type, state, scheduled_at, payload_json, client_decision)
    VALUES (?,?,?,?,?,?,?,'pending',?,?,?)
  `).run(newId, incident.session_id, incident.student_id, incident.letter_id, incident.application_id,
         incident.scenario_id, clientType, now,
         JSON.stringify({ parent_incident: incident.id, requested: amount }),
         clientDecision);

  // Оновлюємо вихідний інцидент
  db.prepare(`UPDATE incidents SET client_decision=? WHERE id=?`).run(clientDecision, incident.id);

  // Виконуємо одразу
  const newInc = db.prepare(`SELECT * FROM incidents WHERE id=?`).get(newId);
  fireIncident(newInc);

  // Resume point
  addResumePoint({
    sessionId: incident.session_id,
    studentId: incident.student_id,
    letterId: incident.letter_id,
    applicationId: incident.application_id,
    type: 'informed_client_about_simple',
    impact: 1,
    context: { decision: clientDecision, amount },
  });

  /* version НЕ чіпаємо: подія доставляється через пошту/чат, version смикає тільки лектор */

  return { ok: true, client_decision: clientDecision, client_type: clientType };
}

// Студент приймає рішення у модалці "Простої"
function studentResolveSimple({ sessionId, letterId, decision, amount }) {
  // decision: 'student_pays', 'client_pays', 'carrier_dropped'
  const incident = findActiveSimpleIncident({ sessionId, letterId });
  if (!incident) return { ok: false, error: 'no_active_simple' };

  const op = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?')
    .get(sessionId, letterId);

  let resumeImpact = 0;
  let resumeType = '';
  const finalAmount = amount || incident.demand_amount || 50;

  if (decision === 'student_pays') {
    // Студент платить простій сам — зменшується маржа
    if (op) {
      db.prepare(`UPDATE order_progress SET simple_paid_by_student = COALESCE(simple_paid_by_student,0) + ? WHERE id=?`)
        .run(finalAmount, op.id);
    }
    resumeType = 'simple_paid_self';
    resumeImpact = -1;
  } else if (decision === 'client_pays') {
    if (op) {
      db.prepare(`UPDATE order_progress SET simple_paid_by_client = COALESCE(simple_paid_by_client,0) + ? WHERE id=?`)
        .run(finalAmount, op.id);
    }
    resumeType = 'simple_paid_by_client';
    resumeImpact = 2;
  } else if (decision === 'carrier_dropped') {
    resumeType = 'simple_avoided';
    resumeImpact = 2;
  }

  // Закриваємо інцидент
  db.prepare(`UPDATE incidents SET state='resolved', student_decision=?, margin_delta=?, fired_at=datetime('now') WHERE id=?`)
    .run(decision, decision === 'student_pays' ? -finalAmount : 0, incident.id);

  if (resumeType) {
    addResumePoint({
      sessionId,
      studentId: incident.student_id,
      letterId,
      applicationId: incident.application_id,
      type: resumeType,
      impact: resumeImpact,
      context: { decision, amount: finalAmount },
    });
  }

  /* version НЕ чіпаємо: подія доставляється через пошту/чат, version смикає тільки лектор */

  return { ok: true, decision, amount: finalAmount };
}

// Перевірка чи потрібна автомодалка простоїв
// (2+ безуспішних раундів негоціації)
function shouldAutoOpenSimpleModal({ sessionId, letterId }) {
  const incident = findActiveSimpleIncident({ sessionId, letterId });
  if (!incident) return false;
  // 2 невдалі раунди = модалка
  return (incident.negotiation_round || 0) >= 2;
}

// ────────────────────────────────────────────────────────────
// ДОВІДКА ПРО ТРАНСПОРТНІ ВИТРАТИ (R8 — EXW перевірка)
// ────────────────────────────────────────────────────────────
function handleCertificateSubmission({ sessionId, studentId, letterId, notes, isEXW, hasLoadingNote }) {
  // Знаходимо активний інцидент client_docs_error_exw (запланований для R8)
  const pendingError = db.prepare(`
    SELECT * FROM incidents
    WHERE session_id=? AND letter_id=? AND type='client_docs_error_exw'
    AND state='pending' LIMIT 1
  `).get(sessionId, letterId);

  // Чи студент уже подавав довідку раніше (повторна подача = виправлення)
  const previousAttempt = db.prepare(`
    SELECT * FROM resume_points
    WHERE session_id=? AND letter_id=? AND type IN ('cert_submitted_exw_ok','cert_submitted_exw_missing','cert_resubmitted_exw_ok')
    ORDER BY created_at DESC LIMIT 1
  `).get(sessionId, letterId);

  const now = new Date().toISOString();

  if (isEXW) {
    if (hasLoadingNote) {
      // Все правильно
      if (previousAttempt && previousAttempt.type === 'cert_submitted_exw_missing') {
        // Виправлення після помилки
        addResumePoint({
          sessionId, studentId, letterId,
          type: 'cert_resubmitted_exw_ok',
          impact: 1,
          context: { notes_excerpt: (notes || '').slice(0, 100) },
        });
        // Скасовуємо інцидент-помилку якщо ще не спрацював
        if (pendingError) {
          db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`)
            .run(now, pendingError.id);
        }
        // Скасовуємо реактивне нагадування про документи
        db.prepare(`
          UPDATE incidents SET state='cancelled', fired_at=?
          WHERE session_id=? AND letter_id=? AND type='client_docs_reminder' AND state='pending'
        `).run(now, sessionId, letterId);
        // Створюємо інцидент "ок"
        scheduleClientDocsOkAfterFix({ sessionId, studentId, letterId });
        return { ok: true, status: 'fixed', message: 'Довідка прийнята' };
      } else {
        // Студент сам врахував EXW з першої подачі
        addResumePoint({
          sessionId, studentId, letterId,
          type: 'cert_submitted_exw_ok',
          impact: 2,
          context: { notes_excerpt: (notes || '').slice(0, 100) },
        });
        // Скасовуємо інцидент-помилку (зайвий бо студент усе зробив правильно)
        if (pendingError) {
          db.prepare(`UPDATE incidents SET state='cancelled', fired_at=? WHERE id=?`)
            .run(now, pendingError.id);
        }
        return { ok: true, status: 'ok', message: 'Довідка ок' };
      }
    } else {
      // EXW але без згадки про навантажувальні
      if (!previousAttempt || previousAttempt.type !== 'cert_submitted_exw_missing') {
        // Перша спроба з помилкою
        addResumePoint({
          sessionId, studentId, letterId,
          type: 'cert_submitted_exw_missing',
          impact: -1,
          context: { notes_excerpt: (notes || '').slice(0, 100) },
        });
      } else {
        // Повторна помилка
        addResumePoint({
          sessionId, studentId, letterId,
          type: 'cert_repeated_error_exw',
          impact: -2,
          context: { notes_excerpt: (notes || '').slice(0, 100) },
        });
      }
      // Тригеримо інцидент відразу (замовник пише про помилку)
      if (pendingError) {
        fireIncident(pendingError);
      }
      return { ok: true, status: 'has_error', message: 'Довідка надіслана. Замовник перевіряє...' };
    }
  } else {
    // Не EXW — просто фіксуємо що довідка надіслана
    addResumePoint({
      sessionId, studentId, letterId,
      type: 'cert_submitted_ok',
      impact: 0,
      context: {},
    });
    return { ok: true, status: 'ok', message: 'Довідка ок' };
  }
}

// Запланувати інцидент "замовник підтверджує що довідка ок" після виправлення EXW
function scheduleClientDocsOkAfterFix({ sessionId, studentId, letterId }) {
  const id = uuidv4();
  // Через ~30 хв сим
  const scheduledAt = nowPlus(simHoursToMs(0.5));
  const letter = db.prepare('SELECT scenario_id FROM letters WHERE id=?').get(letterId);
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, scenario_id, type, state, scheduled_at, payload_json)
    VALUES (?,?,?,?,?,?,'pending',?,?)
  `).run(id, sessionId, studentId, letterId, letter?.scenario_id || null,
    'client_docs_ok_after_fix', scheduledAt, JSON.stringify({}));
}

// ────────────────────────────────────────────────────────────
// СКАСУВАННЯ РЕЙСУ (R5 — зрив)
// ────────────────────────────────────────────────────────────

// Студент натиснув кнопку "Скасувати рейс і повідомити перевізника" у пошті
function studentCancelTrip({ sessionId, studentId, letterId }) {
  // Знайти перевізника з угодою для цього рейсу
  const op = db.prepare(`
    SELECT carrier_id FROM order_progress WHERE session_id=? AND letter_id=?
  `).get(sessionId, letterId);
  const carrierId = op?.carrier_id;
  if (!carrierId) {
    return { ok: false, error: 'no_carrier' };
  }

  // Знайти чат з цим перевізником
  const chat = db.prepare(`
    SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?
  `).get(sessionId, carrierId);

  const cancelTexts = [
    'Замовник щойно скасував вантаж. На жаль, рейс не відбудеться.',
    'Перепрошуємо — замовник скасував. Виходимо з рейсу.',
    'Маємо скасувати — замовник зняв замовлення.',
  ];
  const text = cancelTexts[Math.floor(Math.random() * cancelTexts.length)];
  const nowIso = new Date().toISOString();

  if (chat) {
    const msgs = JSON.parse(chat.messages || '[]');
    msgs.push({
      role: 'student',
      text,
      time: new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' }),
      ts: nowIso,
      isSystem: true,
    });
    db.prepare('UPDATE carrier_chats SET messages=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(msgs), nowIso, chat.id);
  }

  // Скасовуємо ВСІ ЩЕ НЕВИКОНАНІ інциденти для цього рейсу
  const result = db.prepare(`
    UPDATE incidents SET state='cancelled', fired_at=?
    WHERE session_id=? AND letter_id=? AND state='pending'
  `).run(nowIso, sessionId, letterId);

  // Update order_progress state
  db.prepare(`UPDATE order_progress SET state='cancelled_by_client' WHERE session_id=? AND letter_id=?`)
    .run(sessionId, letterId);

  // Resume point +2 — студент діяв правильно
  addResumePoint({
    sessionId, studentId, letterId,
    type: 'informed_carrier_about_cancel',
    impact: 2,
    context: { cancelled_incidents: result.changes },
  });

  /* version НЕ чіпаємо: подія доставляється через пошту/чат, version смикає тільки лектор */

  return { ok: true, message: 'Перевізника повідомлено', cancelled_incidents: result.changes };
}

// При спрацюванні client_cancel_order — створюємо реактивний інцидент:
// "якщо студент не повідомив перевізника за 6 год сим — перевізник пише 'де заявка'"
function scheduleReactiveIfNotInformed({ sessionId, studentId, letterId, scenarioId, carrierChatId, loadDateIso }) {
  // Через 6 год сим — інцидент від перевізника "де адреса?"
  const id = uuidv4();
  const scheduledAt = nowPlus(simHoursToMs(6));
  db.prepare(`
    INSERT INTO incidents (id, session_id, student_id, letter_id, scenario_id, type, state, scheduled_at, payload_json)
    VALUES (?,?,?,?,?,?,'pending',?,?)
  `).run(id, sessionId, studentId, letterId, scenarioId || null,
    'carrier_asks_where_address', scheduledAt,
    JSON.stringify({ carrier_chat_id: carrierChatId, reactive: true }));
  console.log(`[incident-sched] Reactive: 'де заявка?' заплановано для R5`);
}

module.exports = {
  scheduleInitialIncidents,
  scheduleDateMismatchIncidents,
  scheduleReactiveIncidentsCarrierRefused,
  scheduleReactiveIfNotInformed,
  cancelReactiveIncidents,
  runDueIncidents,
  runDueDocumentChecks,
  startCron,
  stopCron,
  addResumePoint,
  findActiveSimpleIncident,
  studentNegotiateCarrier,
  studentNegotiateClient,
  studentResolveSimple,
  shouldAutoOpenSimpleModal,
  handleCertificateSubmission,
  studentCancelTrip,
  SIM_HOUR_MS_REAL,
};
