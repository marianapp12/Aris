import { lookupPersonInQueueIndex } from './operationalAccountAvailability.js';
import { buildPersonMatch } from '../utils/personMatchBuild.js';
import { buildPersonDisplayName } from '../utils/personDisplayName.js';

/**
 * @param {object} data
 * @returns {import('./personNameExistsCheck.js').PersonDirectoryMatch | undefined}
 */
export function normalizePersonMatchFromQueueJson(data) {
  if (!data || typeof data !== 'object') return undefined;

  let displayName = String(data.displayName || '').trim();
  if (!displayName) {
    const given = [data.primerNombre, data.segundoNombre].filter(Boolean).join(' ').trim();
    const s1 = String(data.primerApellido || '').trim();
    const s2 = String(data.segundoApellido || '').trim();
    if (given && s1) {
      displayName = buildPersonDisplayName(given, s1, s2);
    }
  }
  if (!displayName) return undefined;

  return buildPersonMatch({
    displayName,
    userPrincipalName: data.userPrincipalName,
    samAccountName: data.samAccountName,
    email: data.email,
    department: data.departamento,
    jobTitle: data.cargo,
    sede: data.city,
    employeeId: data.employeeId,
    postalCode: data.postalCode,
  });
}

/**
 * @param {object} data
 * @param {string} targetDisplayName
 */
export function queueJsonMatchesDisplayName(data, targetDisplayName) {
  const match = normalizePersonMatchFromQueueJson(data);
  if (!match) return false;
  return match.displayName.toLowerCase() === targetDisplayName.trim().toLowerCase();
}

/**
 * Prechequeo vía índice SMB (misma lectura que warm al arranque).
 * @param {{ displayName: string, employeeId?: string }} params
 */
export async function findPersonInQueueFolders(params) {
  const displayName = String(params.displayName || '').trim();
  const employeeId = params.employeeId ? String(params.employeeId).trim() : '';

  if (!displayName && !employeeId) {
    return {
      queuePendingByName: null,
      queuePendingByEmployeeId: null,
      queueProcessedByEmployeeId: null,
    };
  }

  return lookupPersonInQueueIndex({ displayName, employeeId });
}
