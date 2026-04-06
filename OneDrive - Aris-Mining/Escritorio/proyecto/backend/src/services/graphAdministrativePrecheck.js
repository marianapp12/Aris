import { getGraphClient } from '../config/graphClient.js';
import {
  pickFirstAvailableSamAndUpn,
  NO_UPN_CANDIDATES_EXHAUSTED,
  escapeODataSingleQuote,
} from './graphUpnCandidatePicker.js';
import { pickFirstAvailableSamAndUpnForAdQueue } from './adLdapSamAccountPick.js';
import {
  AdministrativePrecheckError,
  PRECHECK_CODES,
} from './administrativePrecheckErrors.js';

export { AdministrativePrecheckError, PRECHECK_CODES } from './administrativePrecheckErrors.js';

export { escapeODataSingleQuote };

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} employeeId
 * @returns {Promise<object|undefined>} primer usuario encontrado o undefined
 */
export async function findUserByEmployeeId(graphClient, employeeId) {
  const escaped = escapeODataSingleQuote(employeeId.trim());
  const path = `/users?$filter=employeeId eq '${escaped}'&$select=id,userPrincipalName,employeeId&$top=2`;
  const response = await graphClient.api(path).get();
  const list = response?.value;
  if (!list || list.length === 0) return undefined;
  return list[0];
}

/**
 * @returns {Promise<object|undefined>} usuario si hay exactamente uno; undefined si ninguno.
 * @throws {AdministrativePrecheckError} si hay más de un usuario con la misma cédula en Graph.
 */
export async function getExistingUserByEmployeeIdOrThrowIfAmbiguous(graphClient, employeeId) {
  const escaped = escapeODataSingleQuote(employeeId.trim());
  const path = `/users?$filter=employeeId eq '${escaped}'&$select=id,userPrincipalName,employeeId&$top=2`;
  const response = await graphClient.api(path).get();
  const list = response?.value || [];
  if (list.length > 1) {
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.EMPLOYEE_ID_AMBIGUOUS,
      'Hay más de un usuario con esta cédula / ID en Microsoft 365; corrija el directorio antes de continuar.',
      409
    );
  }
  return list[0] || undefined;
}

/**
 * Alta administrativa nueva: la cédula no debe existir ya en Graph (employeeId).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} employeeId
 * @throws {AdministrativePrecheckError} EMPLOYEE_ID_IN_USE | EMPLOYEE_ID_AMBIGUOUS
 */
export async function assertEmployeeIdAvailableForNewAdministrativeUser(graphClient, employeeId) {
  const existing = await getExistingUserByEmployeeIdOrThrowIfAmbiguous(graphClient, employeeId);
  if (!existing) return;
  const upn = existing.userPrincipalName?.trim();
  const upnHint = upn
    ? ` Cuenta existente: ${upn}.`
    : ' Ya existe una cuenta con este id. de empleado en el directorio.';
  throw new AdministrativePrecheckError(
    PRECHECK_CODES.EMPLOYEE_ID_IN_USE,
    `La cédula / ID ingresada ya está registrada en Microsoft 365 (campo id. de empleado). No puede darse de alta otra persona con el mismo documento.${upnHint}`,
    409
  );
}

export { isUpnOrMailNicknameTaken } from './graphUpnCandidatePicker.js';

/**
 * Operativos / vistas que siguen consultando Graph para UPN (Microsoft 365).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string }} params
 */
export async function pickAvailableSamAndUpn(graphClient, params) {
  try {
    return await pickFirstAvailableSamAndUpn(graphClient, params);
  } catch (err) {
    if (err?.code === NO_UPN_CANDIDATES_EXHAUSTED) {
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.NO_UPN_AVAILABLE,
        'No quedó disponible ningún nombre de cuenta (UPN / alias de correo) con las variantes permitidas: todas están ocupadas en Microsoft 365. Es colisión de nombre de cuenta técnico, no duplicidad de la cédula / id. de empleado. Pruebe otro orden de nombres o solicite a TI liberar un alias.',
        422
      );
    }
    throw err;
  }
}

/**
 * Propuesta de sAM/UPN para cola AD: misma secuencia que operativos, disponibilidad contra AD (LDAP).
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string }} params
 */
export async function runAdministrativeGraphPrecheck(params) {
  try {
    return await pickFirstAvailableSamAndUpnForAdQueue({
      givenName: params.givenName,
      surname1: params.surname1,
      surname2: params.surname2,
      emailDomain: params.emailDomain,
    });
  } catch (err) {
    if (err instanceof AdministrativePrecheckError) throw err;
    const msg = err?.message || String(err);
    console.error('[AD cola] prechequeo sAM/UPN:', msg);
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.GRAPH_UNAVAILABLE,
      `No se pudo resolver nombre de cuenta para la cola AD: ${msg}`,
      503
    );
  }
}
