import {
  iterateLocalPartCandidates,
  iterateOperationalLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';
import {
  closeOperationalAvailabilityContext,
  createOperationalAvailabilityContext,
  isOperationalAccountTaken,
} from './operationalAccountAvailability.js';
import {
  isCandidateSamBlockedByOperationalM365,
  listOperationalM365ReservedSamAccountNames,
} from './operationalUpnRegistry.js';
import {
  escapeODataSingleQuote,
  isUpnOrMailNicknameTaken,
} from './graphUpnTakenCheck.js';

export { escapeODataSingleQuote, isUpnOrMailNicknameTaken } from './graphUpnTakenCheck.js';

export const NO_UPN_CANDIDATES_EXHAUSTED = 'NO_UPN_CANDIDATES_EXHAUSTED';

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
  if (!graphClient) {
    throw new Error('Se requiere cliente Microsoft Graph para prechequear UPN/correo en altas operativas');
  }
  const { givenName, surname1, surname2, emailDomain, bulkReservedUpnLower } = params;
  const s2 = surname2?.trim() || '';
  const availabilityCtx = await createOperationalAvailabilityContext();
  const reservedSams = await listOperationalM365ReservedSamAccountNames();

  try {
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
      if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
        continue;
      }
      const taken = await isOperationalAccountTaken(
        graphClient,
        availabilityCtx,
        sam,
        userPrincipalName,
        { reservedSams }
      );
      if (!taken) {
        bulkReservedUpnLower?.add(upnKey);
        return { samAccountName: sam, userPrincipalName };
      }
    }
    const err = new Error('Se agotaron las variantes de nombre de cuenta (UPN / mailNickname).');
    err.code = NO_UPN_CANDIDATES_EXHAUSTED;
    throw err;
  } finally {
    await closeOperationalAvailabilityContext(availabilityCtx);
  }
}
