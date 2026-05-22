import {
  createAdministrativeAvailabilityContext,
  closeOperationalAvailabilityContext,
  isAdministrativeAccountTaken,
} from './operationalAccountAvailability.js';
import {
  isCandidateSamBlockedByOperationalM365,
  listOperationalM365ReservedSamAccountNames,
} from './operationalUpnRegistry.js';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';
import {
  AdministrativePrecheckError,
  PRECHECK_CODES,
} from './administrativePrecheckErrors.js';

/**
 * Usuarios administrativos (cola AD): iterateLocalPartCandidates + prechequeo
 * Microsoft Graph (UPN/correo) → carpetas SMB → LDAP (opcional).
 * La cédula (persona) se valida aparte en enqueueAdUserRequest.
 *
 * @param {{
 *   graphClient?: import('@microsoft/microsoft-graph-client').Client | null,
 *   givenName: string,
 *   surname1: string,
 *   surname2?: string,
 *   emailDomain: string,
 * }} params
 * @returns {Promise<{ samAccountName: string, userPrincipalName: string }>}
 */
export async function pickFirstAvailableSamAndUpnForAdQueue(params) {
  const { graphClient, givenName, surname1, surname2, emailDomain } = params;
  const domain = String(emailDomain || '').trim();
  if (!domain) {
    throw new Error('Falta emailDomain (AD_QUEUE_EMAIL_DOMAIN)');
  }

  const g = givenName.trim();
  const s1 = surname1.trim();
  const s2 = surname2?.trim() || '';

  const availabilityCtx = await createAdministrativeAvailabilityContext();

  try {
    let firstRejectedUpn = null;
    for (const localPartRaw of iterateLocalPartCandidates(g, s1, s2 || undefined)) {
      const reservedSams = await listOperationalM365ReservedSamAccountNames();
      const sam = truncateForSamAccountName(localPartRaw);
      const userPrincipalName = `${sam}@${domain}`;
      if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
        if (!firstRejectedUpn) firstRejectedUpn = userPrincipalName;
        continue;
      }
      const taken = await isAdministrativeAccountTaken(
        graphClient ?? null,
        availabilityCtx,
        sam,
        userPrincipalName,
        { reservedSams }
      );
      if (!taken) {
        if (firstRejectedUpn) {
          console.log(
            `[AD cola] UPN administrativo: primer candidato ocupado (${firstRejectedUpn}); elegido ${userPrincipalName}`
          );
        } else {
          console.log(`[AD cola] UPN administrativo elegido: ${userPrincipalName} (sam=${sam})`);
        }
        return { samAccountName: sam, userPrincipalName };
      }
      if (!firstRejectedUpn) {
        firstRejectedUpn = userPrincipalName;
      }
    }

    throw new AdministrativePrecheckError(
      PRECHECK_CODES.NO_UPN_AVAILABLE,
      'No quedó disponible ningún sAMAccountName / UPN libre (carpetas de cola, Microsoft 365 y Active Directory). Es colisión de nombre de cuenta técnico, no duplicidad de la cédula / id. de empleado.',
      422
    );
  } finally {
    await closeOperationalAvailabilityContext(availabilityCtx);
  }
}
