import { Client } from 'ldapts';
import { getAdLdapPrecheckConfig } from '../config/adQueueConfig.js';
import { escapeLdapFilterValue } from './adLdapEmployeeIdPrecheck.js';

/**
 * @param {import('ldapts').Client} client
 * @param {string} searchBase
 * @param {string} sam
 */
export async function isSamAccountNameTakenInLdap(client, searchBase, sam) {
  const filter = `(sAMAccountName=${escapeLdapFilterValue(sam)})`;
  const { searchEntries } = await client.search(searchBase, {
    filter,
    scope: 'sub',
    sizeLimit: 1,
    attributes: ['dn'],
  });
  return searchEntries.length > 0;
}

/**
 * Sesión LDAP reutilizable para varias comprobaciones de sAMAccountName.
 * @returns {Promise<{ client: import('ldapts').Client, searchBase: string } | null>}
 */
export async function bindLdapSamLookupSession() {
  const config = getAdLdapPrecheckConfig();
  if (!config.enabled) return null;

  const client = new Client({
    url: config.url,
    tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized },
    timeout: config.timeoutMs,
    connectTimeout: config.connectTimeoutMs,
  });

  await client.bind(config.bindDn, config.bindPassword);
  return { client, searchBase: config.searchBase };
}

/**
 * @param {{ client: import('ldapts').Client } | null} session
 */
export async function unbindLdapSamLookupSession(session) {
  if (!session?.client) return;
  try {
    await session.client.unbind();
  } catch {
    /* ignore */
  }
}
