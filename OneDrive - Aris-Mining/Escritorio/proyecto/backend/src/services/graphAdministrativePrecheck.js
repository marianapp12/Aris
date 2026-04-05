import { getGraphClient } from '../config/graphClient.js';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';

export const PRECHECK_CODES = {
  EMPLOYEE_ID_IN_USE: 'EMPLOYEE_ID_IN_USE',
  GRAPH_UNAVAILABLE: 'GRAPH_UNAVAILABLE',
  NO_UPN_AVAILABLE: 'NO_UPN_AVAILABLE',
};

export class AdministrativePrecheckError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} httpStatus
   */
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'AdministrativePrecheckError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function escapeODataSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

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
 * Misma secuencia de candidatos que operativos (Graph); primer sam/UPN libre en el inquilino.
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string }} params
 */
export async function pickAvailableSamAndUpn(graphClient, params) {
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
  throw new AdministrativePrecheckError(
    PRECHECK_CODES.NO_UPN_AVAILABLE,
    'No se pudo generar un nombre de usuario único (correo/UPN) tras agotar las variantes permitidas',
    422
  );
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} employeeId
 */
export async function assertEmployeeIdAvailable(graphClient, employeeId) {
  const existing = await findUserByEmployeeId(graphClient, employeeId);
  if (existing) {
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.EMPLOYEE_ID_IN_USE,
      'Ya existe un usuario con esta cédula / ID en el directorio (Microsoft 365).',
      409
    );
  }
}

/**
 * Prechequeo completo para cola AD: ID libre + sam/UPN libre.
 * @param {{ givenName: string, surname1: string, surname2?: string, employeeId: string, emailDomain: string }} params
 */
export async function runAdministrativeGraphPrecheck(params) {
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
    await assertEmployeeIdAvailable(graphClient, params.employeeId);
    return await pickAvailableSamAndUpn(graphClient, {
      givenName: params.givenName,
      surname1: params.surname1,
      surname2: params.surname2,
      emailDomain: params.emailDomain,
    });
  } catch (err) {
    if (err instanceof AdministrativePrecheckError) throw err;
    const msg = err?.message || String(err);
    console.error('[Graph prechequeo administrativo]', msg);
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.GRAPH_UNAVAILABLE,
      `No se pudo validar contra Microsoft Graph: ${msg}`,
      503
    );
  }
}
