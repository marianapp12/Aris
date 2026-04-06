import { Client } from 'ldapts';
import { getAdLdapPrecheckConfig } from '../config/adQueueConfig.js';
import { escapeLdapFilterValue } from './adLdapEmployeeIdPrecheck.js';
import {
  iterateLocalPartCandidates,
  truncateForSamAccountName,
} from '../utils/adUsernameHelpers.js';
import {
  AdministrativePrecheckError,
  PRECHECK_CODES,
} from './administrativePrecheckErrors.js';

/**
 * @param {import('ldapts').Client} client
 * @param {string} searchBase
 * @param {string} sam
 */
async function isSamAccountNameTakenInLdap(client, searchBase, sam) {
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
 * Misma secuencia de candidatos que operativos (iterateLocalPartCandidates + truncado 20).
 * Con AD_LDAP_* configurado, el primer sAM libre en AD; si no, primer candidato (el script PS reintenta).
 *
 * @param {{ givenName: string, surname1: string, surname2?: string, emailDomain: string }} params
 * @returns {Promise<{ samAccountName: string, userPrincipalName: string }>}
 */
export async function pickFirstAvailableSamAndUpnForAdQueue(params) {
  const { givenName, surname1, surname2, emailDomain } = params;
  const domain = String(emailDomain || '').trim();
  if (!domain) {
    throw new Error('Falta emailDomain (AD_QUEUE_EMAIL_DOMAIN)');
  }

  const g = givenName.trim();
  const s1 = surname1.trim();
  const s2 = surname2?.trim() || '';

  const firstLocal = iterateLocalPartCandidates(g, s1, s2 || undefined).next().value;
  if (!firstLocal) {
    throw new Error('No se pudo generar candidato de nombre de cuenta');
  }
  const firstSam = truncateForSamAccountName(firstLocal);

  const config = getAdLdapPrecheckConfig();
  if (!config.enabled) {
    return {
      samAccountName: firstSam,
      userPrincipalName: `${firstSam}@${domain}`,
    };
  }

  const client = new Client({
    url: config.url,
    tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized },
    timeout: config.timeoutMs,
    connectTimeout: config.connectTimeoutMs,
  });

  try {
    await client.bind(config.bindDn, config.bindPassword);
    for (const localPartRaw of iterateLocalPartCandidates(g, s1, s2 || undefined)) {
      const sam = truncateForSamAccountName(localPartRaw);
      const taken = await isSamAccountNameTakenInLdap(client, config.searchBase, sam);
      if (!taken) {
        return { samAccountName: sam, userPrincipalName: `${sam}@${domain}` };
      }
    }
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.NO_UPN_AVAILABLE,
      'No quedó disponible ningún sAMAccountName libre en Active Directory con las variantes permitidas (misma lógica que operativos en M365). Es colisión de nombre de cuenta técnico, no duplicidad de la cédula / id. de empleado.',
      422
    );
  } catch (err) {
    if (err instanceof AdministrativePrecheckError) throw err;
    const msg = err?.message || String(err);
    console.warn(
      '[AD-LDAP] No se pudo consultar sAMAccountName en AD; se usa el primer candidato y Process-AdUserQueue.ps1 resolverá colisiones:',
      msg
    );
    return {
      samAccountName: firstSam,
      userPrincipalName: `${firstSam}@${domain}`,
    };
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}
