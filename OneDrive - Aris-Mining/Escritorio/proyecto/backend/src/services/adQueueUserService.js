import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';
import { assertAdQueueConfigured, getAdQueueConfig } from '../config/adQueueConfig.js';
import { runAdministrativeGraphPrecheck } from './graphAdministrativePrecheck.js';

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

  let samAccountName;
  let userPrincipalName;
  if (!config.skipGraphPrecheck) {
    const picked = await runAdministrativeGraphPrecheck({
      givenName,
      surname1,
      surname2: surname2 || undefined,
      employeeId,
      emailDomain: config.emailDomain,
    });
    samAccountName = picked.samAccountName;
    userPrincipalName = picked.userPrincipalName;
  } else {
    samAccountName = firstSamCandidate(givenName, surname1, surname2 || undefined);
    userPrincipalName = `${samAccountName}@${config.emailDomain}`;
  }

  const email = userPrincipalName;
  const displayName = buildDisplayName(givenName, surname1, surname2 || undefined);

  const payload = {
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
    await fs.writeFile(targetPath, json, 'utf8');
  } catch (e) {
    throw mapWriteError(e);
  }

  return {
    requestId,
    queuePath: targetPath,
    samAccountName,
    userPrincipalName,
    displayName,
    email,
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
