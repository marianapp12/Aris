/** Mensaje amigable si el error original expone rutas UNC (el archivo puede existir igual). */
export const PUBLIC_SMB_OR_UNC_HINT =
  'No se pudo acceder a la carpeta de cola o al recurso de red (SMB). Compruebe AD_QUEUE_UNC, VPN, permisos y que la cuenta del proceso Node tenga el mismo acceso que en el Explorador de archivos.';

export function isUncFilesystemNoiseMessage(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  if (t.includes('no se encuentra la ruta') || t.includes('porque no existe')) return true;
  if (t.includes('sistema no puede encontrar el archivo')) return true;
  if (t.includes('cannot find the path') || t.includes('the system cannot find the path')) return true;
  if (t.includes('the system cannot find the file specified')) return true;
  if (t.includes('pendiente-') && t.includes('.json')) return true;
  if (/\\\\[\w.-]+\\/.test(t) && (t.includes('scripts') || t.includes('pending') || t.includes('pendiente')))
    return true;
  return false;
}

/** Mensaje API sin rutas UNC cuando el catch mezcla red/archivo con Graph/LDAP. */
export function formatPrecheckOrMixedFailureDetail(err) {
  const raw = err != null && typeof err === 'object' && 'message' in err && err.message != null
    ? String(err.message)
    : String(err ?? '');
  if (isUncFilesystemNoiseMessage(raw)) {
    return PUBLIC_SMB_OR_UNC_HINT;
  }
  return raw.length > 500 ? `${raw.slice(0, 497)}…` : raw;
}
