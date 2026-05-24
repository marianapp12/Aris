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
import { isAdministrativeAccountReservedInMemory } from './operationalPersonRegistry.js';

/**
 * Cola activa (pendiente/procesando): siempre bloquea el UPN/sAM aunque aún no esté en Graph/LDAP.
 * @param {OperationalAvailabilityContext} ctx
 * @param {string} sam
 * @param {string} userPrincipalName
 */
async function isSamOrUpnBlockedInActiveQueue(ctx, sam, userPrincipalName) {
  if (!ctx?.pendingUnc) return false;
  return isSamOrUpnReservedInPendingQueue(ctx.pendingUnc, sam, userPrincipalName);
}
import {
  bindLdapSamLookupSession,
  isSamAccountNameTakenInLdap,
  unbindLdapSamLookupSession,
} from './adLdapSamLookup.js';
import { buildPersonDisplayName } from '../utils/personDisplayName.js';
import { buildPersonMatch } from '../utils/personMatchBuild.js';

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
 * @param {{ samKeys: Set<string>, upnKeys: Set<string> }} index
 * @param {object} data
 */
function addRecordToSamUpnIndex(index, data) {
  if (!data || typeof data !== 'object') return;
  const sam =
    data.samAccountName != null ? String(data.samAccountName).trim().toLowerCase() : '';
  const upn =
    data.userPrincipalName != null ? String(data.userPrincipalName).trim().toLowerCase() : '';
  const email = data.email != null ? String(data.email).trim().toLowerCase() : '';
  if (sam) index.samKeys.add(sam);
  if (upn) index.upnKeys.add(upn);
  if (email) index.upnKeys.add(email);
}

/** @param {object} data */
function personMatchFromQueueJson(data) {
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

function createEmptyQueueIndex() {
  return {
    samKeys: new Set(),
    upnKeys: new Set(),
    pendingByDisplayName: new Map(),
    pendingByEmployeeId: new Map(),
    processedByEmployeeId: new Map(),
    /** Resultados previos en cola AD (resultado-*.json administrativo). */
    adminHistoricalByDisplayName: new Map(),
    /** Altas operativas M365 (espejo SMB / resultado-operativo-m365). */
    operationalHistoricalByDisplayName: new Map(),
  };
}

/**
 * @param {ReturnType<typeof createEmptyQueueIndex>} index
 * @param {object} data
 * @param {'pending' | 'processed' | 'historicalAdmin' | 'historicalOperational'} scope
 */
function addRecordToPersonLookupIndex(index, data, scope) {
  const match = personMatchFromQueueJson(data);
  if (!match) return;

  const dn = match.displayName.trim().toLowerCase();
  if (dn && scope === 'pending' && !index.pendingByDisplayName.has(dn)) {
    index.pendingByDisplayName.set(dn, match);
  }
  if (
    dn &&
    scope === 'historicalAdmin' &&
    !index.adminHistoricalByDisplayName.has(dn)
  ) {
    index.adminHistoricalByDisplayName.set(dn, match);
  }
  if (
    dn &&
    scope === 'historicalOperational' &&
    !index.operationalHistoricalByDisplayName.has(dn)
  ) {
    index.operationalHistoricalByDisplayName.set(dn, match);
  }

  const eid =
    data?.employeeId != null
      ? String(data.employeeId).trim()
      : data?.cedula != null
        ? String(data.cedula).trim()
        : '';
  if (!eid) return;

  if (scope === 'pending' && !index.pendingByEmployeeId.has(eid)) {
    index.pendingByEmployeeId.set(eid, match);
  }
  if (scope === 'processed' && !index.processedByEmployeeId.has(eid)) {
    index.processedByEmployeeId.set(eid, match);
  }
}

/**
 * Indexa todos los JSON de un directorio (una pasada por carpeta; reutilizable entre candidatos UPN).
 * @param {string} dir
 * @param {RegExp} fileRe
 * @param {(data: object, fileName?: string) => boolean} acceptRecord
 * @param {ReturnType<typeof createEmptyQueueIndex>} index
 * @param {'pending' | 'processed' | 'historicalAdmin' | 'historicalOperational' | null} [personScope]
 */
async function indexDirSamUpn(dir, fileRe, acceptRecord, index, personScope = null) {
  const root = String(dir || '').trim().replace(/[/\\]+$/g, '');
  if (!root) return;

  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    const code = e?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    console.warn(`[Operational] No se pudo leer carpeta '${root}':`, e?.message || e);
    return;
  }

  const names = dirents.filter((d) => d.isFile() && fileRe.test(d.name)).map((d) => d.name);
  await Promise.all(
    names.map(async (name) => {
      try {
        const raw = await fs.readFile(joinAdQueueFilePath(root, name), 'utf8');
        const data = JSON.parse(raw);
        if (!acceptRecord(data, name)) return;
        addRecordToSamUpnIndex(index, data);
        if (personScope) addRecordToPersonLookupIndex(index, data, personScope);
      } catch {
        /* omitir */
      }
    })
  );
}

/** @type {{ samKeys: Set<string>, upnKeys: Set<string> } | null} */
let cachedQueueSamUpnIndex = null;
let cacheBuiltAt = 0;
/** @type {{ pendingUnc: string, resultsPath: string, processedPath: string } | null} */
let cachedQueuePaths = null;
/** @type {Promise<{ samKeys: Set<string>, upnKeys: Set<string> }> | null} */
let indexBuildPromise = null;

function getQueueSamUpnIndexTtlMs() {
  const n = Number(process.env.QUEUE_SAM_UPN_INDEX_TTL_MS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 5 * 60 * 1000;
}

function isQueueSamUpnIndexCacheStale() {
  if (!cachedQueueSamUpnIndex) return true;
  return Date.now() - cacheBuiltAt > getQueueSamUpnIndexTtlMs();
}

/**
 * Lee pending/resultados/procesados una sola vez y arma sets de sAM/UPN ocupados.
 * @param {{ pendingUnc: string, resultsPath: string, processedPath: string }} paths
 */
async function buildQueueSamUpnIndexFromPaths(paths) {
  const index = createEmptyQueueIndex();
  const always = () => true;
  const { pendingUnc, resultsPath, processedPath } = paths;

  if (pendingUnc) {
    await indexDirSamUpn(pendingUnc, PENDIENTE_JSON_RE, always, index, 'pending');
    await indexDirSamUpn(pendingUnc, PROCESANDO_JSON_RE, always, index, 'pending');
    if (isOperationalM365SmbMirrorEnabled()) {
      await indexDirSamUpn(pendingUnc, RESERVADO_M365_JSON_RE, always, index, 'pending');
    }
  }

  if (resultsPath) {
    if (isOperationalM365SmbMirrorEnabled()) {
      const acceptOperationalM365Mirror = (data) => {
        if (String(data?.source ?? '').trim() === 'operationalM365') return true;
        const status = String(data?.status ?? '').trim().toLowerCase();
        return status === 'success';
      };
      await indexDirSamUpn(
        resultsPath,
        RESULTADO_OPERATIVO_M365_RE,
        acceptOperationalM365Mirror,
        index,
        'historicalOperational'
      );
    }
    const acceptResultado = (data, fileName = '') => {
      if (
        RESULTADO_OPERATIVO_M365_RE.test(fileName) ||
        String(data?.source ?? '').trim() === 'operationalM365'
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
    await indexDirSamUpn(resultsPath, RESULTADO_JSON_RE, acceptResultado, index, 'historicalAdmin');
  }

  if (processedPath) {
    const acceptProcesado = (data) =>
      Boolean(data?.samAccountName) ||
      Boolean(data?.userPrincipalName) ||
      Boolean(data?.employeeId) ||
      Boolean(data?.cedula);
    await indexDirSamUpn(
      processedPath,
      PROCESADO_EMPLOYEE_JSON_RE,
      acceptProcesado,
      index,
      'processed'
    );
  }

  return index;
}

/**
 * @param {unknown} index
 * @returns {index is ReturnType<typeof createEmptyQueueIndex>}
 */
function isFullQueueSamUpnIndex(index) {
  return (
    index != null &&
    typeof index === 'object' &&
    index.samKeys instanceof Set &&
    index.upnKeys instanceof Set &&
    index.pendingByDisplayName instanceof Map &&
    index.pendingByEmployeeId instanceof Map &&
    index.processedByEmployeeId instanceof Map &&
    index.adminHistoricalByDisplayName instanceof Map &&
    index.operationalHistoricalByDisplayName instanceof Map
  );
}

export function invalidateQueueSamUpnIndexCache() {
  cachedQueueSamUpnIndex = null;
  cachedQueuePaths = null;
  cacheBuiltAt = 0;
  indexBuildPromise = null;
}

/**
 * Índice SMB compartido entre peticiones (evita re-leer UNC en cada alta operativa).
 * @returns {Promise<ReturnType<typeof createEmptyQueueIndex>>}
 */
function configuredQueuePathsChanged(paths) {
  if (!cachedQueuePaths) return true;
  return (
    cachedQueuePaths.pendingUnc !== paths.pendingUnc ||
    cachedQueuePaths.resultsPath !== paths.resultsPath ||
    cachedQueuePaths.processedPath !== paths.processedPath
  );
}

export async function getSharedQueueSamUpnIndex() {
  const paths = getConfiguredQueuePaths();

  if (configuredQueuePathsChanged(paths)) {
    invalidateQueueSamUpnIndexCache();
  }

  if (!isQueueSamUpnIndexCacheStale() && cachedQueueSamUpnIndex) {
    if (isFullQueueSamUpnIndex(cachedQueueSamUpnIndex)) {
      return cachedQueueSamUpnIndex;
    }
    console.warn(
      '[Operational] Índice cola SMB en memoria incompleto (formato antiguo); se reconstruye.'
    );
    invalidateQueueSamUpnIndexCache();
  }

  if (!indexBuildPromise) {
    indexBuildPromise = buildQueueSamUpnIndexFromPaths(paths)
      .then((index) => {
        cachedQueueSamUpnIndex = index;
        cachedQueuePaths = { ...paths };
        cacheBuiltAt = Date.now();
        return index;
      })
      .finally(() => {
        indexBuildPromise = null;
      });
  }

  return indexBuildPromise;
}

/**
 * Precalienta el índice al arrancar el servidor (primera alta no espera el escaneo SMB).
 * @returns {Promise<{ samCount: number, upnCount: number }>}
 */
export async function warmQueueSamUpnIndex() {
  const index = await getSharedQueueSamUpnIndex();
  if (!isFullQueueSamUpnIndex(index)) {
    return { samCount: 0, upnCount: 0, displayNameCount: 0, employeeIdCount: 0 };
  }
  return {
    samCount: index.samKeys.size,
    upnCount: index.upnKeys.size,
    displayNameCount: index.pendingByDisplayName.size,
    employeeIdCount:
      index.pendingByEmployeeId.size + index.processedByEmployeeId.size,
  };
}

/** Resultado vacío cuando no hay índice de personas en cola. */
export function emptyQueuePersonLookupResult() {
  return {
    queuePendingByName: null,
    queuePendingByEmployeeId: null,
    queueProcessedByEmployeeId: null,
    adminQueueHistoricalByName: null,
    queueHistoricalByName: null,
  };
}

/**
 * Búsqueda O(1) en índice SMB (prechequeo modal de duplicados).
 * @param {{ displayName: string, employeeId?: string }} params
 */
export async function lookupPersonInQueueIndex(params) {
  const displayName = String(params.displayName || '').trim();
  const employeeId = params.employeeId ? String(params.employeeId).trim() : '';

  let index;
  try {
    index = await getSharedQueueSamUpnIndex();
  } catch (err) {
    console.warn(
      '[Operational] No se pudo construir índice cola SMB (prechequeo duplicados):',
      err?.message || err
    );
    return emptyQueuePersonLookupResult();
  }

  if (!isFullQueueSamUpnIndex(index)) {
    console.warn('[Operational] Índice cola SMB inválido; se omite prechequeo en carpetas.');
    return emptyQueuePersonLookupResult();
  }

  const nameKey = displayName.toLowerCase();
  const pendingByName = nameKey ? index.pendingByDisplayName.get(nameKey) || null : null;
  const adminHistoricalByName = nameKey
    ? index.adminHistoricalByDisplayName.get(nameKey) || null
    : null;
  const operationalHistoricalByName = nameKey
    ? index.operationalHistoricalByDisplayName.get(nameKey) || null
    : null;
  const pendingByEmployeeId = employeeId
    ? index.pendingByEmployeeId.get(employeeId) || null
    : null;
  const processedByEmployeeId = employeeId
    ? index.processedByEmployeeId.get(employeeId) || null
    : null;

  return {
    queuePendingByName: pendingByName,
    queuePendingByEmployeeId: pendingByEmployeeId,
    queueProcessedByEmployeeId: processedByEmployeeId,
    adminQueueHistoricalByName: adminHistoricalByName,
    queueHistoricalByName: operationalHistoricalByName,
  };
}

/** Solo pruebas: invalida caché entre tests. */
export function resetQueueSamUpnIndexCacheForTests() {
  invalidateQueueSamUpnIndexCache();
}

function getConfiguredQueuePaths() {
  return {
    pendingUnc: getAdQueueConfig().uncPath || '',
    resultsPath: getAdQueueResultsPath(),
    processedPath: getAdQueueProcessedPath(),
  };
}

/**
 * @param {OperationalAvailabilityContext} ctx
 */
function ctxUsesConfiguredQueuePaths(ctx) {
  const cfg = getConfiguredQueuePaths();
  return (
    String(ctx?.pendingUnc || '') === cfg.pendingUnc &&
    String(ctx?.resultsPath || '') === cfg.resultsPath &&
    String(ctx?.processedPath || '') === cfg.processedPath
  );
}

/**
 * @param {OperationalAvailabilityContext} ctx
 * @returns {Promise<{ samKeys: Set<string>, upnKeys: Set<string> }>}
 */
async function getOrBuildQueueSamUpnIndex(ctx) {
  if (ctx.queueSamUpnIndex) return ctx.queueSamUpnIndex;

  if (ctxUsesConfiguredQueuePaths(ctx)) {
    const index = await getSharedQueueSamUpnIndex();
    ctx.queueSamUpnIndex = index;
    return index;
  }

  const index = await buildQueueSamUpnIndexFromPaths({
    pendingUnc: ctx.pendingUnc,
    resultsPath: ctx.resultsPath,
    processedPath: ctx.processedPath,
  });
  ctx.queueSamUpnIndex = index;
  return index;
}

/**
 * @param {{ samKeys: Set<string>, upnKeys: Set<string> }} index
 * @param {string} sam
 * @param {string} userPrincipalName
 */
function isSamOrUpnInQueueIndex(index, sam, userPrincipalName) {
  if (!isFullQueueSamUpnIndex(index)) return false;
  const { samKey, upnKey } = normalizeSamUpnKeys(sam, userPrincipalName);
  if (samKey && index.samKeys.has(samKey)) return true;
  if (upnKey && index.upnKeys.has(upnKey)) return true;
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

  const index = await getOrBuildQueueSamUpnIndex(ctx);
  return isSamOrUpnInQueueIndex(index, sam, userPrincipalName);
}

/**
 * @typedef {object} OperationalAvailabilityContext
 * @property {string} pendingUnc
 * @property {string} resultsPath
 * @property {string} processedPath
 * @property {{ client: import('ldapts').Client, searchBase: string } | null} ldapSession
 * @property {boolean} skipAdPrecheck
 * @property {{ samKeys: Set<string>, upnKeys: Set<string> } | null} [queueSamUpnIndex]
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
/**
 * Si el candidato solo aparece en espejos SMB/memoria pero ya no en M365/LDAP, no bloquear (p. ej. usuario borrado en Entra).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {OperationalAvailabilityContext} ctx
 * @param {string} sam
 * @param {string} userPrincipalName
 */
async function isAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName) {
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

export async function isProvisioningAccountTaken(
  graphClient,
  ctx,
  sam,
  userPrincipalName,
  options = {}
) {
  if (
    isOperationalAccountReservedInMemory(sam, userPrincipalName) ||
    isAdministrativeAccountReservedInMemory(sam, userPrincipalName)
  ) {
    return true;
  }

  if (await isSamOrUpnBlockedInActiveQueue(ctx, sam, userPrincipalName)) {
    return true;
  }

  const reservedSams =
    options.reservedSams ?? (await listOperationalM365ReservedSamAccountNames());
  if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
    if (await isAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName)) {
      return true;
    }
  }

  if (!ctx.skipAdPrecheck) {
    if (await isSamOrUpnReservedInQueueFolders(ctx, sam, userPrincipalName)) {
      if (await isAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName)) {
        return true;
      }
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
async function isAdministrativeAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName) {
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

export async function isAdministrativeAccountTaken(
  graphClient,
  ctx,
  sam,
  userPrincipalName,
  options = {}
) {
  if (
    isOperationalAccountReservedInMemory(sam, userPrincipalName) ||
    isAdministrativeAccountReservedInMemory(sam, userPrincipalName)
  ) {
    return true;
  }

  if (await isSamOrUpnBlockedInActiveQueue(ctx, sam, userPrincipalName)) {
    return true;
  }

  const reservedSams =
    options.reservedSams ?? (await listOperationalM365ReservedSamAccountNames());
  if (isCandidateSamBlockedByOperationalM365(sam, reservedSams)) {
    if (await isAdministrativeAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName)) {
      return true;
    }
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
    if (await isAdministrativeAccountLiveInDirectory(graphClient, ctx, sam, userPrincipalName)) {
      return true;
    }
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
