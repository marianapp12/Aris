import { getTenantUpnDomains } from '../config/adQueueConfig.js';

export function escapeODataSingleQuote(value) {
  return String(value).replace(/'/g, "''");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} mailNickname
 */
async function isMailNicknameTakenInGraph(graphClient, mailNickname) {
  const nick = String(mailNickname || '').trim();
  if (!nick) return false;
  const nickEsc = escapeODataSingleQuote(nick);
  const r = await graphClient
    .api(`/users?$filter=mailNickname eq '${nickEsc}'&$select=id&$top=1`)
    .get();
  return Boolean(r?.value?.length);
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} userPrincipalName
 */
async function isUpnTakenInGraph(graphClient, userPrincipalName) {
  const upn = String(userPrincipalName || '').trim();
  if (!upn || !upn.includes('@')) return false;
  const upnEsc = escapeODataSingleQuote(upn);
  const r = await graphClient
    .api(`/users?$filter=userPrincipalName eq '${upnEsc}'&$select=id&$top=1`)
    .get();
  return Boolean(r?.value?.length);
}

/**
 * Correo SMTP principal (atributo mail en Entra), alineado con UPN en altas cloud-only.
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} mailAddress
 */
async function isPrimaryMailTakenInGraph(graphClient, mailAddress) {
  const mail = String(mailAddress || '').trim();
  if (!mail || !mail.includes('@')) return false;
  const mailEsc = escapeODataSingleQuote(mail);
  const r = await graphClient
    .api(`/users?$filter=mail eq '${mailEsc}'&$select=id&$top=1`)
    .get();
  return Boolean(r?.value?.length);
}

/**
 * Alias UPN con el mismo prefijo local (p. ej. operativo recién creado).
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} sam
 */
async function isUpnPrefixTakenInGraph(graphClient, sam) {
  const local = String(sam || '').trim();
  if (!local) return false;
  const prefixEsc = escapeODataSingleQuote(`${local}@`);
  const r = await graphClient
    .api(
      `/users?$filter=startswith(userPrincipalName,'${prefixEsc}')&$select=id,userPrincipalName&$top=1`
    )
    .get();
  return Boolean(r?.value?.length);
}

/**
 * mailNickname primero; UPN y mail (SMTP principal) del candidato y de cada dominio de tenant.
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} userPrincipalName
 * @param {string} mailNickname
 */
async function isAccountTakenInGraphOnce(graphClient, userPrincipalName, mailNickname) {
  const sam = String(mailNickname || '').trim();
  if (!sam) return false;

  if (await isMailNicknameTakenInGraph(graphClient, sam)) {
    return true;
  }

  if (await isUpnPrefixTakenInGraph(graphClient, sam)) {
    return true;
  }

  const upnsToCheck = new Set();
  const primary = String(userPrincipalName || '').trim();
  if (primary) upnsToCheck.add(primary);

  for (const domain of getTenantUpnDomains()) {
    upnsToCheck.add(`${sam}@${domain}`);
  }

  for (const upn of upnsToCheck) {
    if (await isUpnTakenInGraph(graphClient, upn)) {
      return true;
    }
    if (await isPrimaryMailTakenInGraph(graphClient, upn)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {import('@microsoft/microsoft-graph-client').Client} graphClient
 * @param {string} userPrincipalName
 * @param {string} mailNickname sAM / local part
 * @param {{ retry?: boolean, retryAttempts?: number, retryDelayMs?: number }} [options]
 *   retry — varias pasadas (p. ej. admin tras alta operativa en M365) por replicación Graph.
 */
export async function isUpnOrMailNicknameTaken(
  graphClient,
  userPrincipalName,
  mailNickname,
  options = {}
) {
  const maxAttempts = options.retry ? (options.retryAttempts ?? 3) : 1;
  const delayMs = options.retryDelayMs ?? 800;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (await isAccountTakenInGraphOnce(graphClient, userPrincipalName, mailNickname)) {
        return true;
      }
      if (!options.retry || attempt >= maxAttempts) {
        return false;
      }
      await sleep(delayMs);
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(delayMs);
        continue;
      }
      console.warn(
        '[Graph] Prechequeo UPN/correo falló; se trata como ocupado (fail-safe):',
        err?.message || err
      );
      return true;
    }
  }

  return false;
}
