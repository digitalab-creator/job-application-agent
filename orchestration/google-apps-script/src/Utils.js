function cleanString_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function joinNotes_(first, second) {
  return [cleanString_(first), cleanString_(second)].filter(Boolean).join(' ');
}

/**
 * Notes cells carry `key=value` tags (source_id, confidence, unreachable...).
 * These two are the only place that format is defined.
 */
function readNoteTag_(notes, key) {
  const match = cleanString_(notes).match(new RegExp(`${key}=([^\\s;,]+)`, 'i'));
  return match ? match[1] : '';
}

function setNoteTag_(notes, key, value) {
  const cleaned = cleanString_(notes).replace(new RegExp(`\\s*${key}=[^\\s;,]+\\s*`, 'ig'), ' ').trim();
  if (value === '' || value === null || value === undefined) return cleaned;
  return joinNotes_(cleaned, `${key}=${value}`);
}

const HTML_ENTITIES = Object.freeze({
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#039': "'",
});

function decodeHtmlEntities_(value) {
  return cleanString_(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const named = HTML_ENTITIES[entity.toLowerCase()];
    if (named !== undefined) return named;
    const numeric = entity.match(/^#(x?)([0-9a-f]+)$/i);
    if (!numeric) return match;
    const code = parseInt(numeric[2], numeric[1] ? 16 : 10);
    return Number.isNaN(code) ? match : String.fromCharCode(code);
  });
}

function stripHtml_(html) {
  return decodeHtmlEntities_(
    cleanString_(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function escapeHtml_(value) {
  return cleanString_(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncate_(value, maxLength) {
  const text = cleanString_(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function clamp_(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function chunk_(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function slug_(value) {
  return cleanString_(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function getDomain_(url) {
  const match = cleanString_(url).match(/^https?:\/\/([^/]+)/i);
  return match ? match[1].replace(/^www\./i, '') : 'unknown-source';
}

function parseBooleanPreference_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumberPreference_(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function daysBetween_(fromDateText, toDate) {
  const text = cleanString_(fromDateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const from = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(from.getTime())) return null;
  const ms = toDate.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
