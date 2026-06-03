// server/utils/document-checker.js — Деплой 25c
// Детермінована перевірка документів (без AI) + пули шаблонних фраз
// для відповіді замовника/перевізника через cron.

// ── Перевірка ДОВІДКИ (spravka) ──────────────────────────────
// payload: { before, after, fee, rate_freight, rate_carrier, notes,
//            freight_eur, carrier_freight_eur }
// letter:  { dirs, dist_to_border, dist_after_border, incoterms }
function checkSpravka(payload, letter) {
  const beforeUAH = parseFloat(payload.before) || 0;
  const afterUAH  = parseFloat(payload.after) || 0;
  const feeUAH    = parseFloat(payload.fee) || 0;
  const rateFr    = parseFloat(payload.rate_freight) || 0;
  const freightEur = parseFloat(payload.freight_eur) || 0;
  const carrierEur = parseFloat(payload.carrier_freight_eur) || 0;
  const notes = payload.notes || '';

  const errors = [];

  // Розрахунок очікуваних значень
  const freightUAH = freightEur * rateFr;
  const expectedFeeUAH = (freightEur - carrierEur) * rateFr;
  const totalKm = (letter.dist_to_border || 0) + (letter.dist_after_border || 0);
  const sumWithoutFee = freightUAH - expectedFeeUAH;
  const expectedPerKm = totalKm > 0 ? sumWithoutFee / totalKm : 0;
  const expectedBefore = expectedPerKm * (letter.dist_to_border || 0);
  const expectedAfter = freightUAH - expectedBefore - expectedFeeUAH;

  // 1. Сума рядків = фрахт замовника в грн
  const enteredTotal = beforeUAH + afterUAH + feeUAH;
  if (Math.abs(enteredTotal - freightUAH) > 1) {
    errors.push({ type: 'sum', msg: 'не сходиться сума' });
  }
  // 2. До кордону ±10%
  const beforePercent = expectedBefore > 0 ? Math.abs(beforeUAH - expectedBefore) / expectedBefore * 100 : 0;
  if (beforePercent > 10) errors.push({ type: 'before', msg: 'невірна сума до кордону' });
  // 3. Після кордону ±10%
  const afterPercent = expectedAfter > 0 ? Math.abs(afterUAH - expectedAfter) / expectedAfter * 100 : 0;
  if (afterPercent > 10) errors.push({ type: 'after', msg: 'невірна сума після кордону' });
  // 4. EXW — у примітках має бути рядок про навантажувальні роботи
  const isEXW = (letter.incoterms || '').toUpperCase().includes('EXW');
  if (isEXW && !/навантаж/i.test(notes)) {
    errors.push({ type: 'exw', msg: 'не вказано навантажувальні роботи (EXW)' });
  }
  // 5. Страхування — у примітках має бути згадка (нова перевірка 25c)
  if (!/страхуванн/i.test(notes)) {
    errors.push({ type: 'insurance', msg: 'не вказано що страхування не проводилось' });
  }

  return { ok: errors.length === 0, errors, expected: { before: expectedBefore, after: expectedAfter, fee: expectedFeeUAH } };
}

// ── Перевірка РАХУНКУ / АКТУ (rakhunok/akt) ───────────────────
// Перевіряємо що студент дозаповнив пропуски (gap-поля).
// payload: { fields: {...}, expected: {...} }
function checkDoc(payload) {
  const norm = (s) => String(s || '').trim().replace(/\s+/g, '').toLowerCase();
  const fields = payload.fields || {};
  const expected = payload.expected || {};
  const errors = [];
  for (const key of Object.keys(expected)) {
    const exp = norm(expected[key]);
    if (exp && norm(fields[key]) !== exp) errors.push({ type: key, msg: 'невірні/відсутні дані' });
  }
  return { ok: errors.length === 0, errors };
}

// ── Головна точка: перевірити будь-який документ ──────────────
function checkDocument(docType, payload, letter) {
  if (docType === 'spravka') return checkSpravka(payload, letter || {});
  if (docType === 'rakhunok' || docType === 'akt') return checkDoc(payload);
  // application: вважаємо коректною (зміст заявки не валідуємо формулами тут)
  return { ok: true, errors: [] };
}

// ── Пули шаблонних фраз (детерміновані, без AI) ───────────────
// Канал: замовник (довідка/рахунок/акт), перевізник (заявка).
const PHRASES = {
  // ── ЗАМОВНИК ──
  client_accepted: [
    'Дякую, все вірно, прийняв',
    'Все ок, дякую',
  ],
  // помилки довідки за типом
  spravka_sum: [
    'Зверніть увагу, є помилка у довідці — не сходиться сума',
    'У вас помилка в розбивці, переробіть будь ласка',
  ],
  spravka_exw: [
    'Допишіть навантажувальні роботи і пришліть виправлену',
  ],
  spravka_insurance: [
    'Допишіть "страхування не проводилось", чекаю нову',
  ],
  // помилки рахунку/акту
  doc_missing: [
    'В документі не вистачає даних (номера авто / дата...), виправте будь ласка',
  ],
  // ── ПЕРЕВІЗНИК (заявка) ──
  carrier_accepted: [
    'Заявку отримав, дякую',
  ],
  carrier_error: [
    'В заявці не вірні дані, переробіть будь ласка',
  ],
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Будує текст відповіді за результатом перевірки.
// docType: 'application'|'spravka'|'rakhunok'|'akt'; result: {ok, errors}
function buildReplyText(docType, result) {
  if (docType === 'application') {
    return result.ok ? pick(PHRASES.carrier_accepted) : pick(PHRASES.carrier_error);
  }
  // довідка/рахунок/акт — від замовника
  if (result.ok) return pick(PHRASES.client_accepted);

  if (docType === 'spravka') {
    const types = (result.errors || []).map(e => e.type);
    // пріоритет: страхування → EXW → сума/before/after
    if (types.includes('insurance')) return pick(PHRASES.spravka_insurance);
    if (types.includes('exw')) return pick(PHRASES.spravka_exw);
    return pick(PHRASES.spravka_sum);
  }
  // рахунок / акт
  return pick(PHRASES.doc_missing);
}

module.exports = { checkDocument, checkSpravka, checkDoc, buildReplyText };
