// server/routes/student.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const STU = requireAuth(['student']);

// ── GET SESSION (or create new) ───────────────────────────────
router.get('/session', STU, (req, res) => {
  // Знаходимо групу студента і перевіряємо чи стартувала симуляція
  const member = db.prepare('SELECT group_id FROM group_members WHERE student_id=?').get(req.user.id);
  if (!member) return res.status(404).json({ error: 'No group. Contact your lecturer.' });

  const group = db.prepare('SELECT id,start_date,started_at,rates FROM groups WHERE id=?').get(member.group_id);
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  // Якщо група ще не стартувала — повертаємо заглушку (200 OK, не помилка)
  if (!group.started_at) {
    return res.json({
      not_started: true,
      start_date: group.start_date || null,
    });
  }

  let session = db.prepare('SELECT * FROM sessions WHERE student_id=?').get(req.user.id);

  if (!session) {
    // Create new session — start_date і rates беруться з групи
    const assignment = db.prepare('SELECT * FROM assignments WHERE student_id=?').get(req.user.id);
    if (!assignment) return res.status(404).json({ error: 'No assignment. Contact your lecturer.' });

    const startDate = group.start_date;
    const groupRates = group.rates || '[41.5,41.65,41.8,41.7,41.9]';
    const id = uuidv4();

    db.prepare(`INSERT INTO sessions (id,student_id,assignment_id,start_date,rates) VALUES (?,?,?,?,?)`)
      .run(id, req.user.id, assignment.id, startDate, groupRates);

    session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  }

  if (session.status === 'stopped') {
    return res.status(403).json({ error: 'session_stopped', message: 'Вашу сесію зупинив лектор. Зверніться до лектора.' });
  }

  // Перевірка завершення симуляції (5 днів пройшло)
  if ((session.timer_day || 1) > 5) {
    return res.json({
      ended: true,
      profit: session.profit || 0,
      timer_day: session.timer_day,
    });
  }

  // Load assignment letters
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(session.assignment_id);
  const letterIds = JSON.parse(assignment?.letter_ids || '[]');
  const letters = letterIds
    .map(lid => db.prepare('SELECT * FROM letters WHERE id=?').get(lid))
    .filter(Boolean)
    .map(l => ({
      ...l,
      missing: JSON.parse(l.missing),
      dirs: JSON.parse(l.dirs),
    }));

  // Load threads and chats
  const emailThreads = db.prepare('SELECT * FROM email_threads WHERE session_id=?').all(session.id);
  const carrierChats = db.prepare('SELECT * FROM carrier_chats WHERE session_id=?').all(session.id);
  const orderProgress = db.prepare('SELECT * FROM order_progress WHERE session_id=?').all(session.id);

  res.json({
    session: {
      id: session.id,
      status: session.status,
      timer_ms: session.timer_ms,
      timer_day: session.timer_day,
      start_date: session.start_date,
      profit: session.profit,
      rates: JSON.parse(session.rates),
    },
    letters,
    email_threads: emailThreads.map(t => ({ ...t, messages: JSON.parse(t.messages) })),
    carrier_chats: carrierChats.map(c => ({ ...c, messages: JSON.parse(c.messages), deal_status: c.deal_status })),
    order_progress: orderProgress,
  });
});

// ── SAVE STATE (heartbeat every 30s) ─────────────────────────
router.post('/session/save', STU, (req, res) => {
  const { timer_ms, timer_day, profit } = req.body;
  const session = db.prepare('SELECT id,status FROM sessions WHERE student_id=?').get(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  db.prepare('UPDATE sessions SET timer_ms=?, timer_day=?, profit=? WHERE id=?')
    .run(timer_ms || 0, timer_day || 1, profit || 0, session.id);

  res.json({ ok: true });
});

// ── EMAIL THREAD ──────────────────────────────────────────────
router.get('/threads/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  let thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?')
                 .get(session.id, req.params.letterId);
  if (!thread) return res.json({ messages: [] });
  res.json({ messages: JSON.parse(thread.messages) });
});

router.post('/threads/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { messages } = req.body;
  const existing = db.prepare('SELECT id FROM email_threads WHERE session_id=? AND letter_id=?')
                     .get(session.id, req.params.letterId);
  if (existing) {
    db.prepare("UPDATE email_threads SET messages=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), existing.id);
  } else {
    db.prepare('INSERT INTO email_threads (id,session_id,letter_id,messages) VALUES (?,?,?,?)')
      .run(uuidv4(), session.id, req.params.letterId, JSON.stringify(messages));
  }
  res.json({ ok: true });
});

// ── CARRIER CHAT ──────────────────────────────────────────────
router.get('/chats/:carrierId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });

  const chat = db.prepare('SELECT * FROM carrier_chats WHERE session_id=? AND carrier_id=?')
                 .get(session.id, req.params.carrierId);
  if (!chat) return res.json({ messages: [], deal_status: 'none' });
  res.json({ messages: JSON.parse(chat.messages), deal_status: chat.deal_status });
});

router.post('/chats/:carrierId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { messages, deal_status } = req.body;
  const existing = db.prepare('SELECT id FROM carrier_chats WHERE session_id=? AND carrier_id=?')
                     .get(session.id, req.params.carrierId);
  if (existing) {
    db.prepare("UPDATE carrier_chats SET messages=?, deal_status=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), deal_status || 'none', existing.id);
  } else {
    db.prepare('INSERT INTO carrier_chats (id,session_id,carrier_id,messages,deal_status) VALUES (?,?,?,?,?)')
      .run(uuidv4(), session.id, req.params.carrierId, JSON.stringify(messages), deal_status || 'none');
  }
  res.json({ ok: true });
});

// ── ORDER PROGRESS ────────────────────────────────────────────
router.post('/orders/:letterId', STU, (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { status, client_freight, carrier_id, carrier_freight, carrier_plate, carrier_driver } = req.body;
  const existing = db.prepare('SELECT id FROM order_progress WHERE session_id=? AND letter_id=?')
                     .get(session.id, req.params.letterId);

  if (existing) {
    db.prepare(`UPDATE order_progress SET
      status=COALESCE(?,status), client_freight=COALESCE(?,client_freight),
      carrier_id=COALESCE(?,carrier_id), carrier_freight=COALESCE(?,carrier_freight),
      carrier_plate=COALESCE(?,carrier_plate), carrier_driver=COALESCE(?,carrier_driver),
      updated_at=datetime('now') WHERE id=?`)
      .run(status||null, client_freight||null, carrier_id||null, carrier_freight||null,
           carrier_plate||null, carrier_driver||null, existing.id);
  } else {
    db.prepare(`INSERT INTO order_progress (id,session_id,letter_id,status,client_freight,carrier_id,carrier_freight,carrier_plate,carrier_driver)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uuidv4(), session.id, req.params.letterId, status||'new',
           client_freight||null, carrier_id||null, carrier_freight||null,
           carrier_plate||null, carrier_driver||null);
  }

  // Update profit
  const orders = db.prepare('SELECT client_freight, carrier_freight FROM order_progress WHERE session_id=?').all(session.id);
  const profit = orders.reduce((sum, o) => sum + ((o.client_freight||0) - (o.carrier_freight||0)), 0);
  db.prepare('UPDATE sessions SET profit=? WHERE id=?').run(profit, session.id);

  res.json({ ok: true, profit });
});

// ── AI PROXY ──────────────────────────────────────────────────
const aiLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: parseInt(process.env.MAX_AI_REQUESTS_PER_MINUTE) || 30,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many AI requests. Please wait.' }
});

router.post('/ai', STU, aiLimiter, async (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const { system, messages, max_tokens } = req.body;
  if (!system || !messages) return res.status(400).json({ error: 'system and messages required' });

  // Basic profanity check
  const STOP_WORDS = ['хуй','пизда','блядь','fuck','shit','bitch'];
  const lastMsg = messages[messages.length-1]?.content || '';
  if (STOP_WORDS.some(w => lastMsg.toLowerCase().includes(w))) {
    return res.status(400).json({ error: 'profanity_blocked' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: max_tokens || 800,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: 'AI service unavailable' });
  }
});

function getSession(studentId) {
  return db.prepare('SELECT * FROM sessions WHERE student_id=?').get(studentId);
}

// GET /api/student/carriers — all active carriers
router.get('/carriers', STU, (req, res) => {
  const carriers = db.prepare(
    'SELECT id,name,person,phone,dirs,vehicle_types,reliability,availability,personality,nationality FROM carriers WHERE active=1 AND COALESCE(for_exchange,0)=0 ORDER BY nationality,name'
  ).all();
  res.json(carriers);
});

// ─── CLIENT REQUEST CONFIRMATION (Підтвердити рейс) ───────────────
// Логіка:
//   1. Студент натискає "Підтвердити рейс" у чаті з замовником
//   2. Сервер запитує AI: чи переписка містить домовленості?
//   3. Якщо так → генерується заявка (40/40/10/10 рандом) і додається у тред як повідомлення з attachment
//   4. Якщо ні → AI пише уточнюючу відповідь без attachment
//   5. Поле order_progress.application_sent блокує повторне натискання
const appBuilder = require('../utils/application-builder');
const confirmPrompt = require('../utils/confirm-prompt');

router.post('/orders/:letterId/confirm', STU, async (req, res) => {
  const session = getSession(req.user.id);
  if (!session) return res.status(404).json({ error: 'No session' });
  if (session.status === 'stopped') return res.status(403).json({ error: 'session_stopped' });

  const letterId = req.params.letterId;

  // Завантажуємо лист
  const letter = db.prepare('SELECT * FROM letters WHERE id=?').get(letterId);
  if (!letter) return res.status(404).json({ error: 'Letter not found' });

  // Перевірка: чи заявка вже надіслана? (блокування повторного натискання)
  const op = db.prepare('SELECT * FROM order_progress WHERE session_id=? AND letter_id=?').get(session.id, letterId);
  if (op && op.application_sent) {
    return res.status(409).json({ error: 'already_confirmed', message: 'Заявку вже отримано від замовника.' });
  }

  // Замовник з БД
  const client = letter.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(letter.client_id) : null;

  // Завантажуємо тред email
  const thread = db.prepare('SELECT * FROM email_threads WHERE session_id=? AND letter_id=?').get(session.id, letterId);
  const messages = thread ? JSON.parse(thread.messages || '[]') : [];

  // Якщо немає взагалі жодного повідомлення від студента — відмовляємо
  const studentMsgs = messages.filter(m => m.role === 'student' || m.role === 'user');
  if (studentMsgs.length === 0) {
    return res.status(400).json({ error: 'no_conversation', message: 'Спочатку напишіть замовнику і обговоріть умови.' });
  }

  // ─── Виклик AI для перевірки контексту ───
  const lang = letter.lang || 'uk';
  const systemPrompt = confirmPrompt.buildConfirmCheckSystemPrompt(letter, client, lang);

  // Будуємо історію для AI з тих повідомлень що вже є в треді
  const aiMessages = messages.filter(m => !m.loading).map(m => ({
    role: (m.role === 'student' || m.role === 'user') ? 'user' : 'assistant',
    content: m.text || m.content || '',
  }));
  // Додаємо системне повідомлення про натискання Confirm
  aiMessages.push({
    role: 'user',
    content: '[Студент натиснув кнопку "Підтвердити рейс". Проаналізуй переписку і дай рішення у форматі JSON.]'
  });

  let aiDecision;
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 800,
        system: systemPrompt,
        messages: aiMessages,
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error('AI confirm error:', txt);
      return res.status(502).json({ error: 'ai_error', details: txt.slice(0,200) });
    }
    const data = await aiRes.json();
    const aiText = (data.content && data.content[0] && data.content[0].text) || '';

    // Витягуємо JSON з відповіді (на випадок якщо AI обернув його у markdown)
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON in AI response:', aiText);
      return res.status(502).json({ error: 'ai_no_json' });
    }
    aiDecision = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Confirm AI failed:', e);
    return res.status(502).json({ error: 'ai_unavailable', details: String(e).slice(0,200) });
  }

  const decision = aiDecision.decision || 'reject';
  const replyText = aiDecision.reply_message || 'Дякую, давайте обговоримо детальніше.';
  const agreedPrice = aiDecision.agreed_price_eur || null;

  // Додаємо нове повідомлення від замовника у тред
  const now = new Date().toISOString();
  const newMsg = {
    role: 'client',
    text: replyText,
    timestamp: now,
  };

  // ─── Якщо APPROVE — генеруємо заявку ───
  if (decision === 'approve') {
    const variant = appBuilder.pickVariant();
    const vehicleScenario = appBuilder.pickVehicleScenario();

    // Будуємо повні дані заявки
    let applicationData = appBuilder.buildApplicationData({
      letter,
      client,
      messages,
      simulationDate: session.start_date,
      vehicleScenario,
    });
    // Якщо AI знайшов ціну а в attempt не була визначена — підставляємо
    if (agreedPrice && !applicationData.freight.amount_eur) {
      applicationData.freight.amount_eur = agreedPrice;
    }

    // Якщо incomplete — застосовуємо пропуски
    let missingFields = [];
    if (variant === 'incomplete_attachment' || variant === 'incomplete_text') {
      missingFields = appBuilder.pickMissingFields();
      applicationData = appBuilder.applyMissingFields(applicationData, missingFields);
    }

    // Додаємо attachment до повідомлення
    newMsg.attachment = {
      type: 'application',
      variant,
      data: applicationData,
      missing_fields: missingFields,
    };

    // Якщо variant text/incomplete_text — текст заявки в content повідомлення
    if (variant === 'text' || variant === 'incomplete_text') {
      newMsg.text = replyText + '\n\n' + renderApplicationAsText(applicationData, missingFields);
    }
  }

  // Зберігаємо в email_threads
  messages.push(newMsg);

  if (thread) {
    db.prepare("UPDATE email_threads SET messages=?, updated_at=datetime('now') WHERE id=?")
      .run(JSON.stringify(messages), thread.id);
  } else {
    db.prepare('INSERT INTO email_threads (id,session_id,letter_id,messages) VALUES (?,?,?,?)')
      .run(uuidv4(), session.id, letterId, JSON.stringify(messages));
  }

  // ─── Якщо APPROVE — зберігаємо стан в order_progress ───
  if (decision === 'approve') {
    const attachment = newMsg.attachment;
    const opExists = db.prepare('SELECT id FROM order_progress WHERE session_id=? AND letter_id=?').get(session.id, letterId);

    if (opExists) {
      db.prepare(`UPDATE order_progress SET
        application_sent=1, application_data=?, application_variant=?,
        application_missing=?, application_sent_at=?,
        vehicle_asked_by_client=?, confirm_blocked=1,
        client_freight=COALESCE(client_freight, ?),
        status=CASE WHEN status='new' THEN 'work' ELSE status END
        WHERE id=?`)
        .run(
          JSON.stringify(attachment.data),
          attachment.variant,
          JSON.stringify(attachment.missing_fields || []),
          new Date().toISOString(),
          (appBuilder.pickVehicleScenario === undefined || attachment.data.vehicle_data) ? 1 : 0,
          agreedPrice,
          opExists.id
        );
    } else {
      db.prepare(`INSERT INTO order_progress
        (id,session_id,letter_id,status,client_freight,application_sent,application_data,application_variant,application_missing,application_sent_at,confirm_blocked)
        VALUES (?,?,?,?,?,1,?,?,?,?,1)`)
        .run(uuidv4(), session.id, letterId, 'work',
             agreedPrice,
             JSON.stringify(attachment.data),
             attachment.variant,
             JSON.stringify(attachment.missing_fields || []),
             new Date().toISOString());
    }
  }

  res.json({
    decision,
    message: newMsg,
    application_sent: decision === 'approve',
  });
});

// Рендер заявки як текст для варіанта 'text' / 'incomplete_text'
function renderApplicationAsText(d, missing){
  const isMissing = (field) => missing && missing.includes(field);
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('ЗАЯВКА НА ПЕРЕВЕЗЕННЯ № ' + d.order_number);
  lines.push('Дата: ' + (d.order_date || ''));
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (d.client) {
    lines.push('');
    lines.push('Замовник: ' + d.client.company);
    lines.push('Адреса: ' + d.client.address);
    if (d.client.vat_id) lines.push(d.client.vat_id);
    if (d.client.phone) lines.push('Тел.: ' + d.client.phone);
  }

  lines.push('');
  lines.push('━━ ТРАНСПОРТНИЙ ЗАСІБ ━━');
  lines.push('Тип ТЗ: ' + d.vehicle);

  lines.push('');
  lines.push('━━ ВАНТАЖ ━━');
  lines.push('Опис: ' + (d.cargo.description || '—'));
  if (d.cargo.weight_kg && !isMissing('weight')) lines.push('Вага: ' + d.cargo.weight_kg + ' кг');
  if (d.cargo.volume_m3 && !isMissing('pallets')) lines.push('Об\'єм: ' + d.cargo.volume_m3 + ' м³');
  if (d.cargo.pallets && !isMissing('pallets')) lines.push('Палет: ' + d.cargo.pallets + ' EPAL');

  lines.push('');
  lines.push('━━ ЗАВАНТАЖЕННЯ ━━');
  if (d.loading.date && !isMissing('load_date')) lines.push('Дата: ' + d.loading.date + (d.loading.time_window ? ', ' + d.loading.time_window : ''));
  lines.push('Адреса: ' + (d.loading.address || '—'));
  if (d.loading.contact_name) lines.push('Контакт: ' + d.loading.contact_name + (d.loading.contact_phone ? ', ' + d.loading.contact_phone : ''));

  lines.push('');
  lines.push('━━ МИТНИЦЯ ━━');
  if (d.customs_out) lines.push('Замитнення: ' + d.customs_out);
  if (d.customs_in) lines.push('Розмитнення: ' + d.customs_in);

  lines.push('');
  lines.push('━━ РОЗВАНТАЖЕННЯ ━━');
  lines.push('Адреса: ' + (d.unloading.address || '—'));
  if (d.unloading.contact_name) lines.push('Контакт: ' + d.unloading.contact_name + (d.unloading.contact_phone ? ', ' + d.unloading.contact_phone : ''));

  lines.push('');
  lines.push('━━ ФРАХТ ━━');
  if (d.freight.amount_eur) lines.push('Сума: €' + d.freight.amount_eur);
  if (d.freight.payment_terms) lines.push('Умови оплати: ' + d.freight.payment_terms);

  if (d.vehicle_data) {
    lines.push('');
    lines.push('━━ АВТО / ВОДІЙ ━━');
    lines.push('ТЗ: ' + d.vehicle_data.plate);
    lines.push('Водій: ' + d.vehicle_data.driver_name);
    lines.push('Тел.: ' + d.vehicle_data.driver_phone);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

module.exports = router;
