/**
 * Comprueba si ya existe una persona con el mismo nombre (y opcionalmente cédula) en:
 * Microsoft 365, carpetas de cola SMB y LDAP (si AD_LDAP_* está en .env).
 */
import { Client } from 'ldapts';
import { getGraphClient } from '../config/graphClient.js';
import { getAdLdapPrecheckConfig } from '../config/adQueueConfig.js';
import { escapeODataSingleQuote } from './graphAdministrativePrecheck.js';
import { escapeLdapFilterValue } from './adLdapEmployeeIdPrecheck.js';
import {
  buildPersonDisplayName,
  buildPersonFullSurname,
} from '../utils/personDisplayName.js';
import { buildPersonMatch } from '../utils/personMatchBuild.js';
import { findPersonInQueueFolders } from './personQueueFolderCheck.js';
import { findRecentPersonByDisplayName } from './operationalPersonRegistry.js';
import { findUserByEmployeeId } from './graphAdministrativePrecheck.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @typedef {import('../utils/personMatchBuild.js').PersonDirectoryMatch} PersonDirectoryMatch */

export { buildPersonMatch };

const GRAPH_USER_SELECT =
  'displayName,userPrincipalName,mail,employeeId,jobTitle,department,city,postalCode,givenName,surname';

/**
 * @param {object} user - usuario Graph ($select ampliado)
 * @returns {PersonDirectoryMatch | undefined}
 */
export function normalizePersonMatchFromGraph(user) {
  const dn = String(user?.displayName || '').trim();
  if (!dn) return undefined;

  const upn = String(user?.userPrincipalName || '').trim();
  const mail = String(user?.mail || '').trim();
  const email = mail || upn || undefined;

  return buildPersonMatch({
    displayName: dn,
    userPrincipalName: upn || undefined,
    email,
    department: user?.department,
    jobTitle: user?.jobTitle,
    sede: user?.city,
    employeeId: user?.employeeId,
    postalCode: user?.postalCode,
  });
}

/**
 * @param {Record<string, unknown>} entry - entrada LDAP
 * @param {(name: string) => string} attr - lector de atributos
 * @param {string} fallbackDisplayName
 * @returns {PersonDirectoryMatch | undefined}
 */
export function normalizePersonMatchFromLdap(entry, attr, fallbackDisplayName) {
  const dn = attr('displayName') || fallbackDisplayName;
  if (!dn.trim()) return undefined;

  const upn = attr('userPrincipalName');
  const mail = attr('mail');
  const email = mail || upn || undefined;

  return buildPersonMatch({
    displayName: dn.trim(),
    userPrincipalName: upn || undefined,
    samAccountName: attr('sAMAccountName') || undefined,
    email,
    department: attr('department'),
    jobTitle: attr('title'),
    sede: attr('l'),
    employeeId: attr('employeeID'),
    postalCode: attr('postalCode'),
  });
}

/**
 * Un solo $filter Graph (evita dos idas y vueltas a la API).
 * @param {string} displayName
 * @param {string} givenName
 * @param {string} fullSurname
 */
export function buildGraphPersonLookupFilter(displayName, givenName, fullSurname) {
  const dnEsc = escapeODataSingleQuote(displayName);
  if (!fullSurname) {
    return `displayName eq '${dnEsc}'`;
  }
  const gnEsc = escapeODataSingleQuote(givenName.trim());
  const snEsc = escapeODataSingleQuote(fullSurname);
  return `(displayName eq '${dnEsc}' or (givenName eq '${gnEsc}' and surname eq '${snEsc}'))`;
}

/**
 * Coincidencia estricta en Graph (evita abrir modal por el primer resultado OData irrelevante).
 * @param {object[]} users
 * @param {string} displayName
 * @param {string} givenName
 * @param {string} fullSurname
 * @returns {PersonDirectoryMatch | undefined}
 */
export function pickStrictGraphPersonMatch(users, displayName, givenName, fullSurname) {
  const dnTarget = displayName.trim().toLowerCase();
  const gnTarget = givenName.trim().toLowerCase();
  const snTarget = fullSurname.trim().toLowerCase();

  for (const u of users || []) {
    const dn = String(u?.displayName || '').trim().toLowerCase();
    if (dn && dn === dnTarget) {
      return normalizePersonMatchFromGraph(u);
    }
    if (snTarget) {
      const gn = String(u?.givenName || '').trim().toLowerCase();
      const sn = String(u?.surname || '').trim().toLowerCase();
      if (gn === gnTarget && sn === snTarget) {
        return normalizePersonMatchFromGraph(u);
      }
    }
  }
  return undefined;
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} displayName
 * @param {string} givenName
 * @param {string} fullSurname
 * @returns {Promise<PersonDirectoryMatch | undefined>}
 */
export async function findPersonInMicrosoft365(
  graphClient,
  displayName,
  givenName,
  fullSurname
) {
  const filter = buildGraphPersonLookupFilter(displayName, givenName, fullSurname);
  const response = await graphClient
    .api(`/users?$filter=${filter}&$select=${GRAPH_USER_SELECT}&$top=3`)
    .get();

  return pickStrictGraphPersonMatch(response?.value, displayName, givenName, fullSurname);
}

/**
 * Graph puede tardar unos segundos en indexar un usuario recién creado.
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} displayName
 * @param {string} givenName
 * @param {string} fullSurname
 */
export async function findPersonInMicrosoft365WithRetry(
  graphClient,
  displayName,
  givenName,
  fullSurname
) {
  const attempts = Math.min(
    Math.max(Number(process.env.CHECK_EXISTING_PERSON_GRAPH_RETRIES) || 3, 1),
    5
  );
  const delayMs = Math.min(
    Math.max(Number(process.env.CHECK_EXISTING_PERSON_GRAPH_RETRY_MS) || 450, 100),
    3000
  );

  for (let i = 0; i < attempts; i++) {
    const match = await findPersonInMicrosoft365(
      graphClient,
      displayName,
      givenName,
      fullSurname
    );
    if (match) return match;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return undefined;
}

/**
 * @param {string} displayName
 * @returns {Promise<PersonDirectoryMatch | undefined>}
 */
export async function findPersonInActiveDirectoryLdap(displayName) {
  const config = getAdLdapPrecheckConfig();
  if (!config.enabled) return undefined;

  const dn = displayName.trim();
  if (!dn) return undefined;

  const client = new Client({
    url: config.url,
    tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized },
    timeout: config.timeoutMs,
    connectTimeout: config.connectTimeoutMs,
  });

  try {
    await client.bind(config.bindDn, config.bindPassword);
    const esc = escapeLdapFilterValue(dn);
    const filter = `(|(displayName=${esc})(cn=${esc}))`;
    const { searchEntries } = await client.search(config.searchBase, {
      filter,
      scope: 'sub',
      sizeLimit: 2,
      attributes: [
        'displayName',
        'userPrincipalName',
        'mail',
        'sAMAccountName',
        'employeeID',
        'title',
        'department',
        'l',
        'postalCode',
      ],
    });

    if (!searchEntries.length) return undefined;

    const first = searchEntries[0];
    const attr = (name) => {
      const raw = first[name] ?? first[name.toLowerCase()];
      if (Array.isArray(raw) && raw.length > 0) {
        const v = raw[0];
        if (Buffer.isBuffer(v)) return v.toString('utf8');
        return String(v).trim();
      }
      if (typeof raw === 'string') return raw.trim();
      return '';
    };

    return normalizePersonMatchFromLdap(first, attr, dn);
  } catch (err) {
    console.warn(
      '[AD-LDAP] No se pudo buscar persona por nombre en AD; se omite este paso:',
      err?.message || err
    );
    return undefined;
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} employeeId
 * @returns {Promise<PersonDirectoryMatch | undefined>}
 */
export async function findPersonByEmployeeIdInMicrosoft365(graphClient, employeeId) {
  const id = String(employeeId || '').trim();
  if (!id) return undefined;

  const escaped = escapeODataSingleQuote(id);
  const response = await graphClient
    .api(`/users?$filter=employeeId eq '${escaped}'&$select=${GRAPH_USER_SELECT}&$top=2`)
    .get();
  const list = response?.value || [];
  if (list.length > 1) {
    console.warn('[Graph] Más de un usuario con la misma cédula en M365 (prechequeo modal).');
  }
  const first = list[0];
  return first ? normalizePersonMatchFromGraph(first) : undefined;
}

/**
 * @param {string[]} parts
 * @returns {string[]}
 */
function uniqueFoundIn(parts) {
  return [...new Set(parts.filter(Boolean))];
}

/**
 * Comprueba duplicados por nombre (M365, LDAP opcional, carpetas SMB) y por cédula si se envía.
 * @param {{ givenName: string, surname1: string, surname2?: string, employeeId?: string }} params
 */
export async function checkExistingPersonByName(params) {
  const givenName = String(params.givenName).trim();
  const surname1 = String(params.surname1).trim();
  const surname2 = (params.surname2 && String(params.surname2).trim()) || '';
  const employeeId = params.employeeId ? String(params.employeeId).trim() : '';

  const empty = {
    exists: false,
    displayName: '',
    foundIn: [],
    microsoft365: null,
    activeDirectory: null,
    queuePending: null,
    queueProcessed: null,
    queueHistorical: null,
    employeeIdDuplicate: null,
    verificationWarnings: [],
  };

  if (!givenName || !surname1) {
    return empty;
  }

  const displayName = buildPersonDisplayName(givenName, surname1, surname2);
  const fullSurname = buildPersonFullSurname(surname1, surname2);

  const recentSession = findRecentPersonByDisplayName(displayName);
  if (recentSession) {
    return {
      exists: true,
      displayName,
      foundIn: ['queueHistorical'],
      microsoft365: null,
      activeDirectory: null,
      queuePending: null,
      queueProcessed: null,
      queueHistorical: recentSession,
      employeeIdDuplicate: null,
      verificationWarnings: [],
    };
  }

  const skipLdapIfGraph =
    process.env.CHECK_EXISTING_PERSON_SKIP_LDAP_IF_GRAPH_MATCH !== 'false';

  const graphByName = async () => {
    try {
      const graphClient = getGraphClient();
      const match = await findPersonInMicrosoft365WithRetry(
        graphClient,
        displayName,
        givenName,
        fullSurname
      );
      return { failed: false, match };
    } catch (err) {
      console.warn(
        '[Graph] No se pudo consultar duplicado por nombre:',
        err?.message || err
      );
      return { failed: true, match: undefined };
    }
  };

  const graphByEmployeeId = async () => {
    if (!employeeId) return { failed: false, match: undefined };
    try {
      const graphClient = getGraphClient();
      const match = await findPersonByEmployeeIdInMicrosoft365(graphClient, employeeId);
      return { failed: false, match };
    } catch (err) {
      console.warn(
        '[Graph] No se pudo consultar duplicado por cédula en M365:',
        err?.message || err
      );
      return { failed: true, match: undefined };
    }
  };

  const ldapLookup = () => findPersonInActiveDirectoryLdap(displayName);

  const emptyQueueResult = {
    queuePendingByName: null,
    queuePendingByEmployeeId: null,
    queueProcessedByEmployeeId: null,
    queueHistoricalByName: null,
  };

  const queueLookup = async () => {
    try {
      return await findPersonInQueueFolders({
        displayName,
        employeeId: employeeId || undefined,
      });
    } catch (err) {
      console.warn(
        '[AD-Queue] No se pudo consultar cola SMB en prechequeo de duplicados:',
        err?.message || err
      );
      return { ...emptyQueueResult, queueCheckFailed: true };
    }
  };

  const [nameGraphResult, idGraphResult, queueResult] = await Promise.all([
    graphByName(),
    graphByEmployeeId(),
    queueLookup(),
  ]);

  const verificationWarnings = [];
  if (nameGraphResult.failed) {
    verificationWarnings.push(
      'No se pudo consultar Microsoft 365 por nombre; revise antes de continuar.'
    );
  }
  if (employeeId && idGraphResult.failed) {
    verificationWarnings.push(
      'No se pudo consultar Microsoft 365 por cédula; revise antes de continuar.'
    );
  }
  if (queueResult.queueCheckFailed) {
    verificationWarnings.push(
      'No se pudo consultar la cola de Active Directory; revise antes de continuar.'
    );
  }

  let adResult;
  const ldapEnabled = getAdLdapPrecheckConfig().enabled;
  if (ldapEnabled) {
    if (skipLdapIfGraph && nameGraphResult.match) {
      adResult = undefined;
    } else {
      adResult = await ldapLookup();
    }
  }

  const microsoft365 = nameGraphResult.match || null;
  const activeDirectory = adResult || null;

  const queuePending =
    queueResult.queuePendingByName || queueResult.queuePendingByEmployeeId || null;
  const queueProcessed = queueResult.queueProcessedByEmployeeId || null;
  const queueHistorical = queueResult.queueHistoricalByName || null;

  const employeeIdDuplicate =
    employeeId &&
    (idGraphResult.match || queueResult.queuePendingByEmployeeId || queueProcessed)
      ? {
          microsoft365: idGraphResult.match || null,
          queuePending: queueResult.queuePendingByEmployeeId || null,
          queueProcessed: queueProcessed,
        }
      : null;

  const foundIn = uniqueFoundIn([
    microsoft365 ? 'microsoft365' : '',
    activeDirectory ? 'activeDirectory' : '',
    queuePending ? 'queuePending' : '',
    queueProcessed ? 'queueProcessed' : '',
    queueHistorical ? 'queueHistorical' : '',
    employeeIdDuplicate?.microsoft365 ? 'employeeIdMicrosoft365' : '',
    employeeIdDuplicate?.queuePending ? 'employeeIdQueuePending' : '',
    employeeIdDuplicate?.queueProcessed ? 'employeeIdQueueProcessed' : '',
  ]);

  const exists = foundIn.length > 0;

  return {
    exists,
    displayName,
    foundIn,
    microsoft365,
    activeDirectory,
    queuePending,
    queueProcessed,
    queueHistorical,
    employeeIdDuplicate,
    verificationWarnings,
  };
}
