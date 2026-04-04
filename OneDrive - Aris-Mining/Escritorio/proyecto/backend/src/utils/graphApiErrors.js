/**
 * Resumen legible de errores típicos de Microsoft Graph / @microsoft/microsoft-graph-client.
 * @param {unknown} err
 */
export function summarizeGraphError(err) {
  if (!err || typeof err !== 'object') {
    return { statusLabel: '?', summary: String(err), code: '' };
  }

  const e = /** @type {Record<string, unknown>} */ (err);
  const status =
    typeof e.statusCode === 'number'
      ? e.statusCode
      : typeof e.status === 'number'
        ? e.status
        : '?';

  const code = typeof e.code === 'string' ? e.code : '';
  const body = e.body;
  let graphDetail = '';
  if (body && typeof body === 'object' && body !== null && 'error' in body) {
    const ge = /** @type {Record<string, unknown>} */ (body).error;
    if (ge && typeof ge === 'object' && ge !== null) {
      const o = /** @type {Record<string, unknown>} */ (ge);
      const gm = typeof o.message === 'string' ? o.message : '';
      const gc = typeof o.code === 'string' ? o.code : '';
      graphDetail = [gc, gm].filter(Boolean).join(': ');
    }
  }

  const msg = typeof e.message === 'string' ? e.message : String(err);
  const summary = graphDetail || msg;

  return { statusLabel: String(status), summary, code };
}

/**
 * Log en una línea (estilo [LDAP]) para errores de Graph en consola.
 * @param {string} context - ej. "crear usuario operativo"
 * @param {unknown} err
 */
export function logGraphApiError(context, err) {
  const { statusLabel, summary, code } = summarizeGraphError(err);
  const codePart = code ? ` ${code}` : '';
  console.error(`[GRAPH] ${context} | HTTP ${statusLabel}${codePart} — ${summary}`);

  if (process.env.NODE_ENV !== 'development' || !err || typeof err !== 'object' || !('stack' in err)) {
    return;
  }
  const stackStr = String(/** @type {{ stack?: string }} */ (err).stack);
  const frames = stackStr
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('at '));
  if (frames.length > 0) {
    console.error(`[GRAPH] ${context} | ubicación (dev): ${frames[0]}`);
  }
}
