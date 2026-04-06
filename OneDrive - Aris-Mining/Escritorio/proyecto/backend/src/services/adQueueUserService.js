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

function mapWriteError(err) {
  const code = err?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new Error(
      'No se pudo escribir en la cola AD: la ruta no existe o no es accesible. Compruebe AD_QUEUE_UNC y permisos SMB.'
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new Error('No se pudo escribir en la cola AD: permiso denegado en el recurso compartido.');
  }
  if (code === 'ENOSPC') {
    return new Error('No se pudo escribir en la cola AD: espacio insuficiente en el destino.');
  }
  return err;
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

  try {
    await fs.writeFile(targetPath, 'ok\n', 'utf8');
    await fs.unlink(targetPath);
    return {
      ok: true,
      uncPath,
      message: 'Se pudo escribir y eliminar un archivo de prueba en la cola SMB.',
    };
  } catch (e) {
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
  };

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
      const msg = err?.message || String(err);
      console.error('[AD-Queue] prechequeo antes de encolar:', msg);
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.GRAPH_UNAVAILABLE,
        `No se pudo completar el prechequeo antes de encolar (Entra ID / LDAP / cola): ${msg}`,
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
  };

  const meta = {};
  if (config.ouDn) meta.ouDn = config.ouDn;
  if (config.initialPasswordHint) meta.initialPasswordFromQueue = config.initialPasswordHint;
  if (Object.keys(meta).length > 0) {
    payload.queueMetadata = meta;
  }

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
