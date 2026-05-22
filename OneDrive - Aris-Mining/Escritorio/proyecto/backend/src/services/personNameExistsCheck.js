import { Client } from 'ldapts';
import { getGraphClient } from '../config/graphClient.js';
import { getAdLdapPrecheckConfig } from '../config/adQueueConfig.js';
import { escapeODataSingleQuote } from './graphAdministrativePrecheck.js';
import { escapeLdapFilterValue } from './adLdapEmployeeIdPrecheck.js';
import {
  buildPersonDisplayName,
  buildPersonFullSurname,
} from '../utils/personDisplayName.js';

/**
 * @typedef {{ displayName: string, userPrincipalName?: string, employeeId?: string }} PersonDirectoryMatch
 */

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
  const select = 'displayName,userPrincipalName,employeeId,givenName,surname';
  const seenIds = new Set();

  /** @type {PersonDirectoryMatch[]} */
  const matches = [];

  const pushFromList = (list) => {
    for (const u of list || []) {
      const id = u?.id;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      const dn = String(u?.displayName || '').trim();
      if (!dn) continue;
      matches.push({
        displayName: dn,
        userPrincipalName: u?.userPrincipalName?.trim() || undefined,
        employeeId: u?.employeeId?.trim() || undefined,
      });
    }
  };

  const dnEsc = escapeODataSingleQuote(displayName);
  const byDisplay = await graphClient
    .api(`/users?$filter=displayName eq '${dnEsc}'&$select=${select}&$top=3`)
    .get();
  pushFromList(byDisplay?.value);

  if (fullSurname) {
    const gnEsc = escapeODataSingleQuote(givenName.trim());
    const snEsc = escapeODataSingleQuote(fullSurname);
    const byParts = await graphClient
      .api(
        `/users?$filter=givenName eq '${gnEsc}' and surname eq '${snEsc}'&$select=${select}&$top=3`
      )
      .get();
    pushFromList(byParts?.value);
  }

  const normalizedTarget = displayName.toLowerCase();
  const exact = matches.find((m) => m.displayName.toLowerCase() === normalizedTarget);
  if (exact) return exact;

  const byPartsOnly = matches.find((m) => {
    const gn = String(m.displayName || '').toLowerCase();
    return gn.startsWith(givenName.trim().toLowerCase());
  });
  return byPartsOnly || matches[0];
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
      attributes: ['displayName', 'userPrincipalName', 'sAMAccountName', 'employeeID'],
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

    const sam = attr('sAMAccountName');
    const upn = attr('userPrincipalName');
    return {
      displayName: attr('displayName') || dn,
      userPrincipalName: upn || undefined,
      employeeId: attr('employeeID') || undefined,
      samAccountName: sam || undefined,
    };
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
 * Comprueba si ya existe alguien con el mismo nombre para mostrar y apellidos (M365 y/o AD).
 * @param {{ givenName: string, surname1: string, surname2?: string }} params
 */
export async function checkExistingPersonByName(params) {
  const givenName = String(params.givenName).trim();
  const surname1 = String(params.surname1).trim();
  const surname2 = (params.surname2 && String(params.surname2).trim()) || '';

  if (!givenName || !surname1) {
    return {
      exists: false,
      displayName: '',
      microsoft365: null,
      activeDirectory: null,
    };
  }

  const displayName = buildPersonDisplayName(givenName, surname1, surname2);
  const fullSurname = buildPersonFullSurname(surname1, surname2);

  let microsoft365 = null;
  try {
    const graphClient = getGraphClient();
    const m365 = await findPersonInMicrosoft365(
      graphClient,
      displayName,
      givenName,
      fullSurname
    );
    if (m365) microsoft365 = m365;
  } catch (err) {
    console.warn(
      '[Graph] No se pudo consultar duplicado por nombre; se continúa sin aviso M365:',
      err?.message || err
    );
  }

  const ad = await findPersonInActiveDirectoryLdap(displayName);
  const activeDirectory = ad || null;

  return {
    exists: Boolean(microsoft365 || activeDirectory),
    displayName,
    microsoft365,
    activeDirectory,
  };
}
