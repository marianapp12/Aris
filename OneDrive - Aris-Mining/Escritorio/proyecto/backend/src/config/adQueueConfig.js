/**
 * Cola SMB para creación de usuarios AD: el backend escribe JSON en una ruta UNC;
 * un script PowerShell en el servidor (Programador de tareas) procesa los archivos.
 */

export function getAdQueueConfig() {
  const unc = process.env.AD_QUEUE_UNC?.trim() || '';
  const emailDomain = process.env.AD_QUEUE_EMAIL_DOMAIN?.trim() || '';
  const schemaVersion = Number(process.env.AD_QUEUE_SCHEMA_VERSION);
  const skip = process.env.AD_QUEUE_SKIP_GRAPH_PRECHECK;
  return {
    uncPath: unc,
    emailDomain,
    /** Si true, no consulta Microsoft Graph antes de encolar (solo para pruebas; no recomendado en producción). */
    skipGraphPrecheck: skip === 'true' || skip === '1',
    ouDn: process.env.AD_QUEUE_OU_DN?.trim() || undefined,
    /** Empresa (atributo Company en AD); va en el JSON como `empresa`. */
    company: process.env.AD_QUEUE_COMPANY?.trim() || undefined,
    /** Solo metadatos para el script del servidor; no usar contraseña en claro salvo política explícita. */
    initialPasswordHint: process.env.AD_QUEUE_INITIAL_PASSWORD?.trim() || undefined,
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
  };
}

/**
 * @throws {Error} si falta configuración obligatoria
 */
export function assertAdQueueConfigured() {
  const c = getAdQueueConfig();
  if (!c.uncPath) {
    throw new Error('Falta la variable de entorno AD_QUEUE_UNC (ruta UNC de la cola, ej. \\\\10.10.11.9\\scripts\\pending)');
  }
  if (!c.emailDomain) {
    throw new Error('Falta la variable de entorno AD_QUEUE_EMAIL_DOMAIN (dominio del UPN/correo, sin @)');
  }
  return c;
}
