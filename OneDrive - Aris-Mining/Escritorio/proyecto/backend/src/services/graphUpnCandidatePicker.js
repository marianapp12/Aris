import {
  iterateLocalPartCandidates,
  iterateOperationalLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';

export const NO_UPN_CANDIDATES_EXHAUSTED = 'NO_UPN_CANDIDATES_EXHAUSTED';

export function escapeODataSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} userPrincipalName
 * @param {string} mailNickname sAM / local part
 */
export async function isUpnOrMailNicknameTaken(graphClient, userPrincipalName, mailNickname) {
  const upnEsc = escapeODataSingleQuote(userPrincipalName);
  const r1 = await graphClient
    .api(`/users?$filter=userPrincipalName eq '${upnEsc}'&$select=id&$top=1`)
    .get();
  if (r1?.value?.length) return true;
  const nickEsc = escapeODataSingleQuote(mailNickname);
  const r2 = await graphClient
    .api(`/users?$filter=mailNickname eq '${nickEsc}'&$select=id&$top=1`)
    .get();
  return Boolean(r2?.value?.length);
}

/**
 * Prechequeo Graph administrativo / compatibilidad: `iterateLocalPartCandidates` (oleada numérica escalonada).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string }} params
 * @returns {Promise<{ samAccountName: string, userPrincipalName: string }>}
 * @throws {Error} code === NO_UPN_CANDIDATES_EXHAUSTED si se agotan candidatos
 */
export async function pickFirstAvailableSamAndUpn(graphClient, params) {
  const { givenName, surname1, surname2, emailDomain } = params;
  const s2 = surname2?.trim() || '';
  for (const localPartRaw of iterateLocalPartCandidates(
    givenName.trim(),
    surname1.trim(),
    s2 || undefined
  )) {
    const sam = truncateForSamAccountName(localPartRaw);
    const userPrincipalName = `${sam}@${emailDomain}`;
    const taken = await isUpnOrMailNicknameTaken(graphClient, userPrincipalName, sam);
    if (!taken) {
      return { samAccountName: sam, userPrincipalName };
    }
  }
  const err = new Error('Se agotaron las variantes de nombre de cuenta (UPN / mailNickname).');
  err.code = NO_UPN_CANDIDATES_EXHAUSTED;
  throw err;
}

/**
 * Solo alta operativa M365: `iterateOperationalLocalPartCandidates` (mismo sufijo .N en cada pasada a–d).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string, bulkReservedUpnLower?: Set<string> }} params
 *   bulkReservedUpnLower — UPN ya elegidos en el mismo lote (carga masiva); claves en minúsculas.
 * @returns {Promise<{ samAccountName: string, userPrincipalName: string }>}
 * @throws {Error} code === NO_UPN_CANDIDATES_EXHAUSTED si se agotan candidatos
 */
export async function pickFirstAvailableSamAndUpnForOperational(graphClient, params) {
  const { givenName, surname1, surname2, emailDomain, bulkReservedUpnLower } = params;
  const s2 = surname2?.trim() || '';
  for (const localPartRaw of iterateOperationalLocalPartCandidates(
    givenName.trim(),
    surname1.trim(),
    s2 || undefined
  )) {
    const sam = truncateForSamAccountName(localPartRaw);
    const userPrincipalName = `${sam}@${emailDomain}`;
    const upnKey = userPrincipalName.toLowerCase();
    if (bulkReservedUpnLower?.has(upnKey)) {
      continue;
    }
    const taken = await isUpnOrMailNicknameTaken(graphClient, userPrincipalName, sam);
    if (!taken) {
      bulkReservedUpnLower?.add(upnKey);
      return { samAccountName: sam, userPrincipalName };
    }
  }
  const err = new Error('Se agotaron las variantes de nombre de cuenta (UPN / mailNickname).');
  err.code = NO_UPN_CANDIDATES_EXHAUSTED;
  throw err;
}
