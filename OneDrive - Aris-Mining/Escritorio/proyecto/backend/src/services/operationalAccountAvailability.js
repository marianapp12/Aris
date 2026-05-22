import fs from 'fs/promises';
import {
  getAdLdapPrecheckConfig,
  getAdQueueConfig,
  getAdQueueProcessedPath,
  getAdQueueResultsPath,
  getAdminGraphPrecheckRetryOptions,
  isOperationalM365SmbMirrorEnabled,
  joinAdQueueFilePath,
} from '../config/adQueueConfig.js';
import { isUpnOrMailNicknameTaken } from './graphUpnTakenCheck.js';
import {
  isOperationalAccountReservedInMemory,
  isCandidateSamBlockedByOperationalM365,
  listOperationalM365ReservedSamAccountNames,
} from './operationalUpnRegistry.js';
import {
  bindLdapSamLookupSession,
  isSamAccountNameTakenInLdap,
  unbindLdapSamLookupSession,
} from './adLdapSamLookup.js';

export const OPERATIONAL_AD_LDAP_UNAVAILABLE = 'OPERATIONAL_AD_LDAP_UNAVAILABLE';

const PENDIENTE_JSON_RE = /^pendiente-.+\.json$/i;
const PROCESANDO_JSON_RE = /^procesando-.+\.json$/i;
const RESULTADO_JSON_RE = /^resultado-.+\.json$/i;
/** Espejo Node tras alta operativa M365 (mismo patrón que operationalUpnRegistry / Process-AdUserQueue.ps1). */
const RESULTADO_OPERATIVO_M365_RE = /^resultado-operativo-m365-.+\.json$/i;
const PROCESADO_EMPLOYEE_JSON_RE = /^procesado-employeeId-.+\.json$/i;
/** Marcadores de operativo M365 en pending; Process-AdUserQueue.ps1 solo procesa pendiente-{uuid}.json */
const RESERVADO_M365_JSON_RE = /^\.reservado-m365-.+\.json$/i;

function isOperationalSkipAdPrecheck() {
  const v = process.env.OPERATIONAL_SKIP_AD_PRECHECK;
  return v === 'true' || v === '1';
}

/**
 * @param {string} sam
 * @param {string} userPrincipalName
 */
function normalizeSamUpnKeys(sam, userPrincipalName) {
  return {
    samKey: String(sam || '').trim().toLowerCase(),
    upnKey: String(userPrincipalName || '').trim().toLowerCase(),
  };
}

/**
 * @param {string} samKey
 * @param {string} upnKey
 * @param {object} data
 */
function jsonRecordMatchesSamOrUpn(samKey, upnKey, data) {
  if (!data || typeof data !== 'object') return false;
  const queuedSam =
    data.samAccountName != null ? String(data.samAccountName).trim().toLowerCase() : '';
  const queuedUpn =
    data.userPrincipalName != null ? String(data.userPrincipalName).trim().toLowerCase() : '';
  const queuedEmail =
    data.email != null ? String(data.email).trim().toLowerCase() : '';
  if (samKey && queuedSam === samKey) return true;
  if (upnKey && (queuedUpn === upnKey || queuedEmail === upnKey)) return true;
  return false;
}

/**
 * Escanea un directorio; `acceptRecord` filtra por status u otros campos.
 * @param {string} dir
 * @param {RegExp} fileRe
 * @param {string} sam
 * @param {string} userPrincipalName
 * @param {(data: object) => boolean} acceptRecord
 */
async function scanDirSamUpn(dir, fileRe, sam, userPrincipalName, acceptRecord) {
  const root = String(dir || '').trim().replace(/[/\\]+$/g, '');
  if (!root) return false;

  const { samKey, upnKey } = normalizeSamUpnKeys(sam, userPrincipalName);
  if (!samKey && !upnKey) return false;

  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    const code = e?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    console.warn(`[Operational] No se pudo leer carpeta '${root}':`, e?.message || e);
    return false;
  }

  const names = dirents.filter((d) => d.isFile() && fileRe.test(d.name)).map((d) => d.name);
  for (const name of names) {
    try {
      const raw = await fs.readFile(joinAdQueueFilePath(root, name), 'utf8');
      const data = JSON.parse(raw);
      if (!acceptRecord(data, name)) continue;
      if (jsonRecordMatchesSamOrUpn(samKey, upnKey, data)) return true;
    } catch {
      /* omitir */
    }
  }
  return false;
}

/**
 * @param {string} queueUnc
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export async function isSamOrUpnReservedInPendingQueue(queueUnc, sam, userPrincipalName) {
  const always = () => true;
  if (await scanDirSamUpn(queueUnc, PENDIENTE_JSON_RE, sam, userPrincipalName, always)) {
    return true;
  }
  return scanDirSamUpn(queueUnc, PROCESANDO_JSON_RE, sam, userPrincipalName, always);
}

/**
 * @param {OperationalAvailabilityContext} ctx
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export async function isSamOrUpnReservedInQueueFolders(ctx, sam, userPrincipalName) {
  if (!ctx?.pendingUnc && !ctx?.resultsPath && !ctx?.processedPath) {
    return false;
  }

  const always = () => true;
  if (ctx.pendingUnc) {
    if (await scanDirSamUpn(ctx.pendingUnc, PENDIENTE_JSON_RE, sam, userPrincipalName, always)) {
      return true;
    }
    if (await scanDirSamUpn(ctx.pendingUnc, PROCESANDO_JSON_RE, sam, userPrincipalName, always)) {
      return true;
    }
    if (isOperationalM365SmbMirrorEnabled()) {
      if (
        await scanDirSamUpn(ctx.pendingUnc, RESERVADO_M365_JSON_RE, sam, userPrincipalName, always)
      ) {
        return true;
      }
    }
  }

  if (ctx.resultsPath) {
    if (isOperationalM365SmbMirrorEnabled()) {
      const acceptOperationalM365Mirror = (data) => {
        if (String(data?.source ?? '').trim() === 'operationalM365') return true;
        const status = String(data?.status ?? '').trim().toLowerCase();
        return status === 'success';
      };
      if (
        await scanDirSamUpn(
          ctx.resultsPath,
          RESULTADO_OPERATIVO_M365_RE,
          sam,
          userPrincipalName,
          acceptOperationalM365Mirror
        )
      ) {
        return true;
      }
    }
    const acceptResultado = (data, fileName = '') => {
      if (
        !isOperationalM365SmbMirrorEnabled() &&
        (RESULTADO_OPERATIVO_M365_RE.test(fileName) ||
          String(data?.source ?? '').trim() === 'operationalM365')
      ) {
        return false;
      }
      const status = String(data?.status ?? '').trim().toLowerCase();
      if (status === 'success') return true;
      if (status === 'error' && (data.samAccountName || data.userPrincipalName || data.email)) {
        return true;
      }
      return false;
    };
    if (
      await scanDirSamUpn(ctx.resultsPath, RESULTADO_JSON_RE, sam, userPrincipalName, acceptResultado)
    ) {
      return true;
    }
  }

  if (ctx.processedPath) {
    const acceptProcesado = (data) =>
      Boolean(data?.samAccountName) || Boolean(data?.userPrincipalName);
    if (
      await scanDirSamUpn(
        ctx.processedPath,
        PROCESADO_EMPLOYEE_JSON_RE,
        sam,
        userPrincipalName,
        acceptProcesado
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * @typedef {object} OperationalAvailabilityContext
 * @property {string} pendingUnc
 * @property {string} resultsPath
 * @property {string} processedPath
 * @property {{ client: import('ldapts').Client, searchBase: string } | null} ldapSession
 * @property {boolean} skipAdPrecheck
 */

/**
 * Cola administrativa: siempre escanea carpetas SMB; LDAP opcional (sin fallar el alta si no conecta).
 * @returns {Promise<OperationalAvailabilityContext>}
 */
export async function createAdministrativeAvailabilityContext() {
  const queueUnc = getAdQueueConfig().uncPath || '';
  const resultsPath = getAdQueueResultsPath();
  const processedPath = getAdQueueProcessedPath();

  const base = {
    pendingUnc: queueUnc,
    resultsPath,
    processedPath,
    ldapSession: null,
    skipAdPrecheck: false,
  };

  const ldapConfig = getAdLdapPrecheckConfig();
  if (!ldapConfig.enabled) {
    return base;
  }

  try {
    const ldapSession = await bindLdapSamLookupSession();
    return { ...base, ldapSession };
  } catch (err) {
    console.warn(
      '[AD cola] LDAP no disponible para prechequeo administrativo; se omitirá consulta AD:',
      err?.message || err
    );
    return base;
  }
}

/**
 * @returns {Promise<OperationalAvailabilityContext>}
 * @throws {Error} statusCode 503 si LDAP está configurado pero no conecta
 */
export async function createOperationalAvailabilityContext() {
  const skipAdPrecheck = isOperationalSkipAdPrecheck();
  const queueUnc = getAdQueueConfig().uncPath || '';
  const resultsPath = getAdQueueResultsPath();
  const processedPath = getAdQueueProcessedPath();

  const base = {
    pendingUnc: queueUnc,
    resultsPath,
    processedPath,
    ldapSession: null,
    skipAdPrecheck,
  };

  if (skipAdPrecheck) {
    return base;
  }

  const ldapConfig = getAdLdapPrecheckConfig();
  if (!ldapConfig.enabled) {
    return base;
  }

  try {
    const ldapSession = await bindLdapSamLookupSession();
    return { ...base, ldapSession, skipAdPrecheck: false };
  } catch (err) {
    const msg = err?.message || String(err);
    const error = new Error(
      `No se pudo consultar Active Directory (LDAP) antes del alta operativa: ${msg}`
    );
    error.code = OPERATIONAL_AD_LDAP_UNAVAILABLE;
    error.statusCode = 503;
    throw error;
  }
}

/**
 * @param {OperationalAvailabilityContext | null | undefined} ctx
 */
export async function closeOperationalAvailabilityContext(ctx) {
  if (!ctx?.ldapSession) return;
  await unbindLdapSamLookupSession(ctx.ldapSession);
}

/**
 * Alta operativa M365: carpetas SMB → Microsoft Graph → LDAP (opcional).
 * Graph no se omite con OPERATIONAL_SKIP_AD_PRECHECK (solo carpetas/LDAP).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {OperationalAvailabilityContext} ctx
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export async function isProvisioningAccountTaken(
  graphClient,
  ctx,
  sam,
  userPrincipalName,
  options = {}
) {
  const reservedSams =
    options.reservedSams ?? (await listOperationalM365ReservedSamAccountNames());
  if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
    return true;
  }

  if (!ctx.skipAdPrecheck) {
    if (await isSamOrUpnReservedInQueueFolders(ctx, sam, userPrincipalName)) {
      return true;
    }
  }

  if (await isUpnOrMailNicknameTaken(graphClient, userPrincipalName, sam)) {
    return true;
  }

  if (!ctx.skipAdPrecheck && ctx.ldapSession) {
    if (
      await isSamAccountNameTakenInLdap(
        ctx.ldapSession.client,
        ctx.ldapSession.searchBase,
        sam
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Cola administrativa: Microsoft Graph (UPN/correo) → carpetas SMB → LDAP (opcional).
 * @param {import('@microsoft/microsoft-graph-client').Client | null | undefined} graphClient
 * @param {OperationalAvailabilityContext} ctx
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export async function isAdministrativeAccountTaken(
  graphClient,
  ctx,
  sam,
  userPrincipalName,
  options = {}
) {
  const reservedSams =
    options.reservedSams ?? (await listOperationalM365ReservedSamAccountNames());
  if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
    return true;
  }

  if (graphClient) {
    if (
      await isUpnOrMailNicknameTaken(
        graphClient,
        userPrincipalName,
        sam,
        getAdminGraphPrecheckRetryOptions()
      )
    ) {
      return true;
    }
  }

  if (await isSamOrUpnReservedInQueueFolders(ctx, sam, userPrincipalName)) {
    return true;
  }

  if (ctx.ldapSession) {
    if (
      await isSamAccountNameTakenInLdap(
        ctx.ldapSession.client,
        ctx.ldapSession.searchBase,
        sam
      )
    ) {
      return true;
    }
  }

  return false;
}

/** @deprecated Alias operativo; usar isProvisioningAccountTaken */
export const isOperationalAccountTaken = isProvisioningAccountTaken;
