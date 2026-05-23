/**
 * Filas que el usuario eligió omitir en el modal de duplicados (carga masiva).
 * @param {unknown} raw — JSON string o array enviado en multipart como omitRows
 */
export function parseOmitRowsSet(raw) {
  if (raw == null || raw === '') return new Set();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 1)
    );
  } catch {
    return new Set();
  }
}
