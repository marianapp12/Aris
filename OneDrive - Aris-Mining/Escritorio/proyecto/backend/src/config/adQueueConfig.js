/**
 * Cola SMB para creación de usuarios AD: el backend escribe JSON en una ruta UNC;
 * un script PowerShell en el servidor (Programador de tareas) procesa los archivos.
 */

import path from 'path';

/**
 * Une ruta de cola (UNC o local) con un nombre de archivo.
 * @param {string} queueRoot
 * @param {string} fileName
 */
export function joinAdQueueFilePath(queueRoot, fileName) {
  const normalized = String(queueRoot).replace(/[/\\]+$/g, '');
  if (normalized.startsWith('\\\\')) {
    return `${normalized}\\${fileName}`;
  }
  return path.join(normalized, fileName);
}

export function getAdQueueConfig() {
  const unc = process.env.AD_QUEUE_UNC?.trim() || '';
  const emailDomain = process.env.AD_QUEUE_EMAIL_DOMAIN?.trim() || '';
  const schemaVersion = Number(process.env.AD_QUEUE_SCHEMA_VERSION);
  const skip = process.env.AD_QUEUE_SKIP_GRAPH_PRECHECK;
  const requireGraph = process.env.AD_QUEUE_REQUIRE_GRAPH_FOR_ADMIN;
  return {
    uncPath: unc,
    emailDomain,
    /** Si true, no consulta Microsoft Graph antes de encolar (solo para pruebas; no recomendado en producción).
     * No desactiva el prechequeo LDAP de cédula (AD_LDAP_*), si está configurado.
     * Con AD_QUEUE_REQUIRE_GRAPH_FOR_ADMIN=true el encolado fallará si también está skip activo. */
    skipGraphPrecheck: skip === 'true' || skip === '1',
    requireGraphForAdmin: requireGraph === 'true' || requireGraph === '1',
    /** Contenedor LDAP bajo el cual cuelgan las OU por sede (ver administrativeCitySite.js y AD_QUEUE_OU_LEAF_PREFIX). */
    ouDn: process.env.AD_QUEUE_OU_DN?.trim() || undefined,
    /** Empresa (atributo Company en AD); va en el JSON como `empresa`. */
    company: process.env.AD_QUEUE_COMPANY?.trim() || undefined,
    /** Solo metadatos para el script del servidor; no usar contraseña en claro salvo política explícita. */
    initialPasswordHint: process.env.AD_QUEUE_INITIAL_PASSWORD?.trim() || undefined,
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
  };
}

/** Directorio padre común de pending / procesados / resultados / error (alineado con Process-AdUserQueue.ps1). */
export function getScriptsRootFromQueueUnc(unc) {
  if (!unc?.trim()) return '';
  const normalized = String(unc).replace(/[/\\]+$/g, '');
  const lower = normalized.toLowerCase();
  if (lower.endsWith('\\pending') || lower.endsWith('/pending')) {
    return normalized.replace(/[/\\]pending$/i, '');
  }
  return normalized.startsWith('\\\\') ? path.win32.dirname(normalized) : path.dirname(normalized);
}

/**
 * Carpeta donde el script PowerShell escribe resultado-{requestId}.json (lectura desde Node).
 * Por defecto: hermana de `pending` → `resultados` (ej. \\srv\scripts\pending → \\srv\scripts\resultados).
 * Use AD_QUEUE_RESULTS_UNC si aún usa la ruta antigua pending\resultados.
 */
export function getAdQueueResultsPath() {
  const explicit = process.env.AD_QUEUE_RESULTS_UNC?.trim();
  if (explicit) {
    return explicit.replace(/[/\\]+$/g, '');
  }
  const unc = process.env.AD_QUEUE_UNC?.trim() || '';
  if (!unc) {
    return '';
  }
  const parent = getScriptsRootFromQueueUnc(unc);
  if (!parent || parent === '.') {
    return '';
  }
  return parent.startsWith('\\\\') ? `${parent}\\resultados` : path.join(parent, 'resultados');
}

/**
 * Carpeta donde el script PS escribe un JSON por cédula tras crear el usuario en AD (prechequeo sin esperar a Entra ID).
 * Por defecto: misma raíz que pending → `procesados`.
 */
export function getAdQueueProcessedPath() {
  const explicit = process.env.AD_QUEUE_PROCESSED_UNC?.trim();
  if (explicit) {
    return explicit.replace(/[/\\]+$/g, '');
  }
  const unc = process.env.AD_QUEUE_UNC?.trim() || '';
  if (!unc) {
    return '';
  }
  const parent = getScriptsRootFromQueueUnc(unc);
  if (!parent || parent === '.') {
    return '';
  }
  return parent.startsWith('\\\\') ? `${parent}\\procesados` : path.join(parent, 'procesados');
}

/**
 * Si > 0, un registro en procesados más antiguo no bloquea y se elimina el JSON al validar.
 * 0 = sin caducidad por tiempo (recomendado; la limpieza principal es Graph vía AD_PROCESSED_GRAPH_*).
 */
export function getAdQueueProcessedTtlHours() {
  const n = Number(process.env.AD_QUEUE_PROCESSED_TTL_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

/**
 * Prechequeo opcional de cédula (employeeID) contra AD vía LDAP.
 * Activo solo si están definidas URL, bind DN, contraseña y base de búsqueda.
 */
export function getAdLdapPrecheckConfig() {
  const url = process.env.AD_LDAP_URL?.trim() || '';
  const bindDn = process.env.AD_LDAP_BIND_DN?.trim() || '';
  const bindPassword = process.env.AD_LDAP_BIND_PASSWORD ?? '';
  const searchBase = process.env.AD_LDAP_SEARCH_BASE?.trim() || '';
  const tlsEnv = process.env.AD_LDAP_TLS_REJECT_UNAUTHORIZED;
  const timeoutMs = Number(process.env.AD_LDAP_TIMEOUT_MS);
  const connectTimeoutMs = Number(process.env.AD_LDAP_CONNECT_TIMEOUT_MS);
  const enabled = Boolean(url && bindDn && bindPassword !== '' && searchBase);
  return {
    enabled,
    url,
    bindDn,
    bindPassword: String(bindPassword),
    searchBase,
    tlsRejectUnauthorized: tlsEnv !== 'false' && tlsEnv !== '0',
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
    connectTimeoutMs: Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0 ? connectTimeoutMs : 8000,
  };
}
