/**
 * Normaliza Object ID leídos de process.env (trim, BOM, comillas envolventes).
 * @param {string | undefined} raw
 * @returns {string}
 */
export function sanitizeGroupObjectIdEnv(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1).trim();
  }
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isLikelyEntraObjectId(value) {
  return UUID_LIKE.test(String(value || '').trim());
}

/**
 * @param {string} id
 * @returns {string}
 */
export function maskObjectIdForLog(id) {
  const s = String(id || '');
  if (s.length < 9) return '(valor corto)';
  return `${s.slice(0, 8)}…`;
}
