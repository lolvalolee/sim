// Спільний матчинг маршруту/міст до листа (біржа, fallback без letter_id).
// Кирилиця/латиниця, аліаси міст з seed-даних.

const CITY_ALIASES = {
  'айзенах': ['eisenach', 'aizenakh'],
  'eisenach': ['айзенах'],
  'житомир': ['zhytomyr', 'zhytomyr'],
  'вінер нойштадт': ['wiener neustadt', 'wienerneustadt'],
  'wiener neustadt': ['вінер нойштадт', 'вінернойштадт'],
  'брюссель': ['brussel', 'brussels', 'bruxelles'],
  'brussels': ['брюссель', 'bruxelles'],
  'клевань': ['klevan', 'клеван'],
  'сараєво': ['sarajevo', 'sarayevo'],
  'шяуляй': ['siauliai', 'šiauliai', 'shyaulyay'],
  'утрехт': ['utrecht'],
  'варшава': ['warsaw', 'warszawa'],
  'warsaw': ['варшава', 'warszawa'],
  'київ': ['kyiv', 'kiev', 'kiyv'],
  'kyiv': ['київ', 'kiev'],
  'львів': ['lviv', 'lvov', 'lemberg'],
  'одеса': ['odesa', 'odessa'],
  'дубно': ['dubno'],
  'аліканте': ['alicante'],
  'білефельд': ['bielefeld'],
  'тлумач': ['tlumach', 'тлумач'],
};

const STOP_WORDS = new Set([
  'про', 'рейс', 'вантаж', 'маршрут', 'можете', 'взяти', 'перевезти', 'доброго', 'день',
  'який', 'яка', 'ціна', 'авто', 'тент', 'реф', 'для', 'будь', 'ласка', 'можу', 'скільки',
  'коли', 'адреса', 'вага', 'route', 'from', 'to', 'de', 'ua', 'pl', 'it', 'fr', 'nl', 'sk',
  'lt', 'es', 'at', 'be', 'cz', 'hu', 'ro', 'bg', 'hr', 'si', 'fi', 'se', 'dk', 'gb', 'tr',
]);

function normToken(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^\p{L}\p{N}\s\-']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandAliases(token) {
  const t = normToken(token);
  if (!t || t.length < 3) return [];
  const out = new Set([t]);
  const aliases = CITY_ALIASES[t] || [];
  aliases.forEach(a => out.add(normToken(a)));
  // також шукаємо часткові ключі (вінер нойштадт)
  for (const [key, vals] of Object.entries(CITY_ALIASES)) {
    if (t.includes(key) || key.includes(t)) {
      out.add(key);
      vals.forEach(v => out.add(normToken(v)));
    }
  }
  return [...out];
}

function extractCityTokens(text) {
  if (!text) return [];
  const low = normToken(text);
  const parts = low.split(/[→\-–—,]/).map(p => p.trim()).filter(Boolean);
  const tokens = new Set();
  for (const part of parts) {
    // прибираємо код країни "(DE)" / "DE"
    const cleaned = part.replace(/\([a-z]{2}\)/gi, ' ').replace(/\b[a-z]{2}\b/gi, ' ').trim();
    const words = cleaned.match(/[\p{L}][\p{L}\-']{2,}/gu) || [];
    for (const w of words) {
      if (STOP_WORDS.has(w)) continue;
      expandAliases(w).forEach(a => { if (a.length >= 3) tokens.add(a); });
    }
    // цілий сегмент як фраза (вінер нойштадт)
    if (cleaned.length >= 4 && !STOP_WORDS.has(cleaned)) {
      expandAliases(cleaned).forEach(a => tokens.add(a));
    }
  }
  return [...tokens];
}

function haystackForLetter(letter) {
  const la = normToken(letter.load_address || '');
  const ua = normToken(letter.unload_address || '');
  let dirs = '';
  try { dirs = JSON.parse(letter.dirs || '[]').join(' '); } catch (e) {}
  return normToken(`${la} ${ua} ${dirs}`);
}

function scoreLetterMatch(letter, routeTokens) {
  if (!routeTokens.length) return 0;
  const hay = haystackForLetter(letter);
  let score = 0;
  let fromHit = false;
  let toHit = false;
  const la = normToken(letter.load_address || '');
  const ua = normToken(letter.unload_address || '');

  for (const tok of routeTokens) {
    if (hay.includes(tok)) score++;
    if (la.includes(tok)) fromHit = true;
    if (ua.includes(tok)) toHit = true;
  }
  if (fromHit && toHit) score += 3;
  else if (fromHit || toHit) score += 1;
  return score;
}

function matchLetterByRoute(routeText, letters) {
  if (!routeText || !letters?.length) return null;
  const tokens = extractCityTokens(routeText);
  if (!tokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const letter of letters) {
    const score = scoreLetterMatch(letter, tokens);
    if (score > bestScore) {
      bestScore = score;
      best = letter;
    }
  }
  // Потрібен чіткий збіг: обидва міста або сильний одиночний
  if (bestScore < 2) return null;
  return best;
}

function parseDirs(letter) {
  try { return JSON.parse(letter.dirs || '[]'); } catch (e) { return []; }
}

function freightRefForLetter(db, letter) {
  if (!letter) return 0;
  const v2 = db.prepare('SELECT freight_ref FROM letters_v2 WHERE letter_id=?').get(letter.id);
  if (v2?.freight_ref) return v2.freight_ref;
  return letter.freight_amount
    || (((letter.carrier_range_min || 0) + (letter.carrier_range_max || 0)) / 2)
    || 0;
}

module.exports = {
  CITY_ALIASES,
  extractCityTokens,
  matchLetterByRoute,
  parseDirs,
  freightRefForLetter,
  scoreLetterMatch,
};
