// Нормалізація offset-ів листів під 8 сим-днів сесії.
// Завантаження: start +2…+4; доставка: завантаження +3…+5, не пізніше start +7.

const DELIV_MAX_OFFSET = 7;

function normalizeLetterOffsets(index) {
  const i = Number(index) || 0;
  const load_day_offset = 2 + (i % 3);
  const gap = 3 + (i % 3);
  const deliv_day_offset = Math.min(DELIV_MAX_OFFSET, load_day_offset + gap);
  return { load_day_offset, deliv_day_offset };
}

module.exports = { normalizeLetterOffsets, DELIV_MAX_OFFSET };
