/** Object ID desde .env: trim, BOM y comillas. */
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

export function isLikelyEntraObjectId(value) {
  return UUID_LIKE.test(String(value || '').trim());
}

export function maskObjectIdForLog(id) {
  const s = String(id || '');
  if (s.length < 9) return '(valor corto)';
  return `${s.slice(0, 8)}…`;
}
