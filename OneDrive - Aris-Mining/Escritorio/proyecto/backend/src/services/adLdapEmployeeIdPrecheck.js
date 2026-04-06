import { Client } from 'ldapts';
import { getAdLdapPrecheckConfig } from '../config/adQueueConfig.js';
import { AdministrativePrecheckError, PRECHECK_CODES } from './administrativePrecheckErrors.js';

/** RFC 4515 escape for assertion value in filter. */
export function escapeLdapFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

function firstAttr(entry, ...names) {
  for (const n of names) {
    const raw = entry[n] ?? entry[n.toLowerCase()];
    if (Array.isArray(raw) && raw.length > 0) {
      const v = raw[0];
      if (Buffer.isBuffer(v)) return v.toString('utf8');
      if (v != null && String(v).trim()) return String(v).trim();
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}

/**
 * Si AD_LDAP_* está configurado, comprueba que ningún objeto en AD tenga employeeID = cédula.
 * No hace nada si la configuración LDAP no está completa.
 *
 * @param {string} employeeId
 * @throws {AdministrativePrecheckError}
 */
export async function assertEmployeeIdNotTakenInActiveDirectoryLdap(employeeId) {
  const config = getAdLdapPrecheckConfig();
  if (!config.enabled) return;

  const id = String(employeeId).trim();
  if (!id) return;

  const client = new Client({
    url: config.url,
    tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized },
    timeout: config.timeoutMs,
    connectTimeout: config.connectTimeoutMs,
  });

  try {
    await client.bind(config.bindDn, config.bindPassword);
    const filter = `(employeeID=${escapeLdapFilterValue(id)})`;
    const { searchEntries } = await client.search(config.searchBase, {
      filter,
      scope: 'sub',
      sizeLimit: 2,
      attributes: ['sAMAccountName', 'userPrincipalName'],
    });

    if (!searchEntries.length) return;

    if (searchEntries.length > 1) {
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.EMPLOYEE_ID_AMBIGUOUS,
        'Hay más de un objeto en Active Directory con la misma cédula / employeeID; corrija el directorio antes de continuar.',
        409
      );
    }

    const first = searchEntries[0];
    const sam = firstAttr(first, 'sAMAccountName', 'samaccountname');
    const upn = firstAttr(first, 'userPrincipalName', 'userprincipalname');
    const hint = sam
      ? ` Cuenta AD existente (sAMAccountName): ${sam}.`
      : upn
        ? ` Cuenta existente: ${upn}.`
        : '';

    throw new AdministrativePrecheckError(
      PRECHECK_CODES.EMPLOYEE_ID_IN_USE_AD,
      `La cédula / ID ya está registrada en Active Directory (atributo employeeID). No puede crearse otro usuario con el mismo documento.${hint}`,
      409
    );
  } catch (err) {
    if (err instanceof AdministrativePrecheckError) throw err;
    const msg = err?.message || String(err);
    console.warn(
      '[AD-LDAP] No se pudo validar employeeID en AD; se omite este paso (siguen Graph, procesados y cola). Corrija AD_LDAP_* o conectividad al DC:',
      msg
    );
    return;
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}
