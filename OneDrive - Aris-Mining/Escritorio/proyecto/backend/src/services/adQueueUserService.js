import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';
import { assertAdQueueConfigured, getAdQueueConfig, getAdQueueProcessedPath } from '../config/adQueueConfig.js';
import { getGraphClient } from '../config/graphClient.js';
import {
  assertEmployeeIdAvailableForNewAdministrativeUser,
  AdministrativePrecheckError,
  PRECHECK_CODES,
} from './graphAdministrativePrecheck.js';
import { pickFirstAvailableSamAndUpnForAdQueue } from './adLdapSamAccountPick.js';
import { assertEmployeeIdNotTakenInActiveDirectoryLdap } from './adLdapEmployeeIdPrecheck.js';
import { assertNoPendingQueueFileWithEmployeeId } from './adQueuePendingEmployeeIdScan.js';
import { assertEmployeeIdNotInProcessedRecords } from './adQueueProcessedEmployeeIdScan.js';
import { normalizeAdministrativePostalCode } from '../utils/administrativeUserValidation.js';
import {
  buildAdministrativeOuDn,
  mapAdministrativeCityInputToBucket,
} from '../utils/administrativeCitySite.js';
import { formatPrecheckOrMixedFailureDetail } from '../utils/adQueueErrorSanitize.js';

function joinQueuePath(queueUnc, fileName) {
  const normalized = queueUnc.replace(/[/\\]+$/g, '');
  if (normalized.startsWith('\\\\')) {
    return `${normalized}\\${fileName}`;
  }
  return path.join(normalized, fileName);
}

function splitGivenName(givenName) {
  const parts = givenName.trim().split(/\s+/).filter(Boolean);
  return {
    primerNombre: parts[0] || '',
    segundoNombre: parts.slice(1).join(' ') || '',
  };
}

function buildDisplayName(givenName, surname1, surname2) {
  const s = [surname1, surname2].filter(Boolean).join(' ');
  return `${givenName.trim()} ${s}`.trim();
}

function firstSamCandidate(givenName, surname1, surname2) {
  const gen = iterateLocalPartCandidates(givenName, surname1, surname2);
  const { value, done } = gen.next();
  if (done || !value) {
    throw new Error('No se pudo generar nombre de usuario para la cola AD');
  }
  return truncateForSamAccountName(value);
}

function getAdQueueConnectionTestTimeoutMs() {
  const n = Number(process.env.AD_QUEUE_CONNECTION_TEST_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 && n <= 120000 ? Math.floor(n) : 8000;
}

/**
 * Añade queueMetadata.ouDn (OU hoja + contenedor; ver AD_QUEUE_OU_LEAF_PREFIX en administrativeCitySite.js) y contraseña opcional.
 * @param {object} payload - objeto JSON de cola (`city` = nombre legible en AD; la OU usa el bucket derivado de la ciudad)
 * @param {{ ouDn?: string, initialPasswordHint?: string }} config
 */
function setAdministrativeQueueMetadata(payload, config) {
  const parentDn = config.ouDn?.trim();
  if (!parentDn) {
    throw new Error(
      'Falta AD_QUEUE_OU_DN: defina el DN del contenedor LDAP bajo el cual cuelgan las OU por sede (y opcionalmente AD_QUEUE_OU_LEAF_PREFIX para nombres tipo Usuarios-Office365Sync-Medellin).'
    );
  }
  const cityRaw = String(payload.city || '').trim();
  if (!cityRaw) {
    throw new Error('Falta city (sede) para resolver la OU en la cola administrativa.');
  }
  const siteBucket = mapAdministrativeCityInputToBucket(cityRaw);
  if (!siteBucket) {
    throw new Error(
      'Ciudad / sede no válida para la cola administrativa. Use Segovia, Medellín, Bogotá, PSN, Marmato o Lower Mine (o bucket Medellin/Marmato/Segovia; compat. Overmain/Overmine → Segovia).'
    );
  }
  const meta = {
    ouDn: buildAdministrativeOuDn(siteBucket, parentDn),
  };
  if (config.initialPasswordHint) meta.initialPasswordFromQueue = config.initialPasswordHint;
  payload.queueMetadata = meta;
}

/**
 * Convierte errores de fs/red/Windows al escribir en la UNC de cola en mensajes estables para API y UI.
 * En caso genérico adjunta `cause` para que el controlador pueda registrar el error original en consola.
 */
function mapWriteError(err) {
  if (err == null) {
    return new Error('No se pudo escribir en la cola AD: error desconocido.');
  }

  const code = err.code;
  const msg = String(err.message || err || '').toLowerCase();

  const winPathMissing =
    msg.includes('no se encuentra la ruta') ||
    msg.includes('porque no existe') ||
    msg.includes('sistema no puede encontrar el archivo') ||
    msg.includes('cannot find the path') ||
    msg.includes('the system cannot find the path') ||
    msg.includes('the system cannot find the file specified');

  if (code === 'ENOENT' || code === 'ENOTDIR' || winPathMissing) {
    return new Error(
      'No se pudo escribir en la cola AD: la carpeta o el recurso de red no están disponibles, o AD_QUEUE_UNC no coincide con la carpeta «pending». Compruebe la UNC, que exista la carpeta y permisos SMB para la cuenta que ejecuta Node.'
    );
  }

  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') {
    return new Error(
      'Tiempo de espera agotado al acceder a la carpeta de cola. Compruebe red, UNC AD_QUEUE_UNC y permisos SMB.'
    );
  }

  if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') {
    return new Error(
      'No se pudo escribir en la cola AD: permiso denegado o recurso en uso en el recurso compartido.'
    );
  }

  if (code === 'ENOSPC') {
    return new Error('No se pudo escribir en la cola AD: espacio insuficiente en el destino.');
  }

  if (
    code === 'ECONNRESET' ||
    code === 'ENOTCONN' ||
    code === 'EPIPE' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNREFUSED' ||
    code === 'UNKNOWN'
  ) {
    return new Error(
      'No se pudo escribir en la cola AD: falló la conexión con el servidor de archivos (red o SMB). Compruebe conectividad con el host del UNC.'
    );
  }

  if (
    msg.includes('bad netpath') ||
    msg.includes('network path') ||
    msg.includes('ruta de red') ||
    msg.includes('access is denied') ||
    msg.includes('acceso denegado') ||
    msg.includes('logon failure') ||
    msg.includes('credenciales')
  ) {
    return new Error(
      'No se pudo escribir en la cola AD: no hay acceso al recurso de red (UNC). Compruebe VPN, permisos y que la cuenta del proceso Node tenga acceso al mismo recurso que en el Explorador de archivos.'
    );
  }

  const fallback = new Error(
    'No se pudo escribir en la cola AD. Compruebe AD_QUEUE_UNC, conectividad SMB y permisos. Revise los logs del servidor para más detalle.'
  );
  fallback.cause = err;
  return fallback;
}

/**
 * Prueba escritura en AD_QUEUE_UNC (sin exigir AD_QUEUE_EMAIL_DOMAIN).
 * @returns {{ ok: true, uncPath: string, message: string } | { ok: false, code: string, uncPath?: string, message: string }}
 */
export async function testAdQueueUncWrite() {
  const { uncPath: rawUnc } = getAdQueueConfig();
  const uncPath = rawUnc?.trim() || '';
  if (!uncPath) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message:
        'No está configurada AD_QUEUE_UNC en el entorno del servidor (.env). Defina la ruta UNC de la carpeta pendiente y reinicie el backend.',
    };
  }

  const id = randomUUID();
  const targetPath = joinQueuePath(uncPath, `conexion-prueba-${id}.tmp`);
  const timeoutMs = getAdQueueConnectionTestTimeoutMs();

  const probe = async () => {
    await fs.writeFile(targetPath, 'ok\n', 'utf8');
    await fs.unlink(targetPath);
  };

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(
        `Tiempo de espera agotado (${timeoutMs} ms) al acceder a la carpeta de cola. Compruebe red, UNC AD_QUEUE_UNC y permisos SMB.`
      );
      err.code = 'ETIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    await Promise.race([probe(), timeoutPromise]);
    return {
      ok: true,
      uncPath,
      message: 'Se pudo escribir y eliminar un archivo de prueba en la cola SMB.',
    };
  } catch (e) {
    try {
      await fs.unlink(targetPath);
    } catch {
      /* archivo inexistente o aún bloqueado */
    }
    const code = e?.code || 'UNKNOWN';
    const mapped = mapWriteError(e);
    const message =
      mapped instanceof Error ? mapped.message : String(mapped?.message || mapped || e);
    return {
      ok: false,
      code,
      uncPath,
      message,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Cola AD: actualizar perfil de usuario existente en AD (localiza por employeeId / cédula).
 * @param {object} body - validateAdministrativePayload
 * @param {{ userPrincipalName?: string }} [graphHint] - UPN en Graph (solo respuesta al cliente)
 */
export async function enqueueAdUserUpdateByEmployeeIdRequest(body, graphHint = {}) {
  const config = assertAdQueueConfigured();
  const requestId = randomUUID();

  const givenName = body.givenName.trim();
  const surname1 = body.surname1.trim();
  const surname2 = (body.surname2 && String(body.surname2).trim()) || '';
  const employeeId = String(body.employeeId).trim();
  const { primerNombre, segundoNombre } = splitGivenName(givenName);
  const displayName = buildDisplayName(givenName, surname1, surname2 || undefined);

  const payload = {
    queueAction: 'updateByEmployeeId',
    requestId,
    submittedAt: new Date().toISOString(),
    schemaVersion: config.schemaVersion,
    employeeId,
    primerNombre,
    segundoNombre: segundoNombre || undefined,
    primerApellido: surname1,
    segundoApellido: surname2 || undefined,
    displayName,
    cargo: body.jobTitle.trim(),
    departamento: body.department.trim(),
    city: body.city?.trim() || undefined,
    postalCode: normalizeAdministrativePostalCode(body.postalCode),
  };

  setAdministrativeQueueMetadata(payload, config);
  const adOrganizationalUnitDn = payload.queueMetadata?.ouDn;

  const targetPath = joinQueuePath(config.uncPath, `pendiente-${requestId}.json`);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await fs.writeFile(targetPath, json, 'utf8');
  } catch (e) {
    throw mapWriteError(e);
  }

  return {
    requestId,
    queuePath: targetPath,
    displayName,
    employeeId,
    queueAction: 'updateByEmployeeId',
    userPrincipalName: graphHint.userPrincipalName,
    ...(adOrganizationalUnitDn ? { adOrganizationalUnitDn } : {}),
  };
}

/**
 * Escribe un JSON por solicitud en la UNC configurada (evita pérdidas por concurrencia).
 * @param {object} body - mismo shape que validateAdministrativePayload (givenName, surname1, …)
 */
export async function enqueueAdUserRequest(body) {
  const config = assertAdQueueConfigured();
  const requestId = randomUUID();

  const givenName = body.givenName.trim();
  const surname1 = body.surname1.trim();
  const surname2 = (body.surname2 && String(body.surname2).trim()) || '';
  const employeeId = String(body.employeeId).trim();
  const { primerNombre, segundoNombre } = splitGivenName(givenName);
  const processedPath = getAdQueueProcessedPath();

  let samAccountName;
  let userPrincipalName;
  if (!config.skipGraphPrecheck) {
    let graphClient;
    try {
      graphClient = getGraphClient();
    } catch (e) {
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.GRAPH_UNAVAILABLE,
        e?.message || 'No se pudo inicializar Microsoft Graph (revise AZURE_* en .env).',
        503
      );
    }
    try {
      await assertEmployeeIdAvailableForNewAdministrativeUser(graphClient, employeeId);
      await assertEmployeeIdNotInProcessedRecords(processedPath, employeeId);
      await assertNoPendingQueueFileWithEmployeeId(config.uncPath, employeeId);
      await assertEmployeeIdNotTakenInActiveDirectoryLdap(employeeId);
      const picked = await pickFirstAvailableSamAndUpnForAdQueue({
        givenName,
        surname1,
        surname2: surname2 || undefined,
        emailDomain: config.emailDomain,
      });
      samAccountName = picked.samAccountName;
      userPrincipalName = picked.userPrincipalName;
    } catch (err) {
      if (err instanceof AdministrativePrecheckError) throw err;
      const safeDetail = formatPrecheckOrMixedFailureDetail(err);
      console.error('[AD-Queue] prechequeo antes de encolar:', err);
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.GRAPH_UNAVAILABLE,
        `No se pudo completar el prechequeo antes de encolar (Entra ID / LDAP / cola): ${safeDetail}`,
        503
      );
    }
  } else {
    if (config.requireGraphForAdmin) {
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.GRAPH_UNAVAILABLE,
        'Con AD_QUEUE_REQUIRE_GRAPH_FOR_ADMIN activo no se permite omitir el prechequeo Graph (desactive AD_QUEUE_SKIP_GRAPH_PRECHECK o AD_QUEUE_REQUIRE_GRAPH_FOR_ADMIN).',
        503
      );
    }
    await assertEmployeeIdNotInProcessedRecords(processedPath, employeeId);
    await assertNoPendingQueueFileWithEmployeeId(config.uncPath, employeeId);
    await assertEmployeeIdNotTakenInActiveDirectoryLdap(employeeId);
    const pickedSkip = await pickFirstAvailableSamAndUpnForAdQueue({
      givenName,
      surname1,
      surname2: surname2 || undefined,
      emailDomain: config.emailDomain,
    });
    samAccountName = pickedSkip.samAccountName;
    userPrincipalName = pickedSkip.userPrincipalName;
  }

  const email = userPrincipalName;
  const displayName = buildDisplayName(givenName, surname1, surname2 || undefined);

  const payload = {
    queueAction: 'create',
    requestId,
    submittedAt: new Date().toISOString(),
    schemaVersion: config.schemaVersion,
    primerNombre,
    segundoNombre: segundoNombre || undefined,
    primerApellido: surname1,
    segundoApellido: surname2 || undefined,
    cargo: body.jobTitle.trim(),
    departamento: body.department.trim(),
    displayName,
    samAccountName,
    userPrincipalName,
    email,
    ...(config.company ? { empresa: config.company } : {}),
    employeeId,
    city: body.city?.trim() || undefined,
    postalCode: normalizeAdministrativePostalCode(body.postalCode),
  };

  setAdministrativeQueueMetadata(payload, config);
  const adOrganizationalUnitDn = payload.queueMetadata?.ouDn;

  const targetPath = joinQueuePath(config.uncPath, `pendiente-${requestId}.json`);
  const json = `${JSON.stringify(payload, null, 2)}\n`;

  try {
    await assertNoPendingQueueFileWithEmployeeId(config.uncPath, employeeId);
    await fs.writeFile(targetPath, json, 'utf8');
  } catch (e) {
    if (e instanceof AdministrativePrecheckError) throw e;
    throw mapWriteError(e);
  }

  return {
    requestId,
    queuePath: targetPath,
    samAccountName,
    userPrincipalName,
    displayName,
    email,
    queueAction: 'create',
    ...(adOrganizationalUnitDn ? { adOrganizationalUnitDn } : {}),
  };
}

/**
 * Propuesta de sAMAccountName/UPN en Node (primer candidato). La unicidad definitiva la resuelve el script en AD.
 */
export function proposeAdministrativeUsername(givenName, surname1, surname2) {
  const config = getAdQueueConfig();
  if (!config.emailDomain) {
    throw new Error('Falta la variable de entorno AD_QUEUE_EMAIL_DOMAIN');
  }
  const s1 = surname1.trim();
  const s2 = (surname2 && String(surname2).trim()) || '';
  const g = givenName.trim();
  const sam = firstSamCandidate(g, s1, s2 || undefined);
  const userPrincipalName = `${sam}@${config.emailDomain}`;
  return { sAMAccountName: sam, userPrincipalName };
}
