import fs from 'fs/promises';
import {
  getAdQueueConfig,
  getAdQueueResultsPath,
  isOperationalM365SmbMirrorEnabled,
  joinAdQueueFilePath,
} from '../config/adQueueConfig.js';

/** UPN/sAM de operativos creados en esta instancia del backend. */
const recentOperationalUpnLower = new Set();
const recentOperationalSamLower = new Set();

const RESERVADO_M365_JSON_RE = /^\.reservado-m365-.+\.json$/i;
const RESULTADO_OPERATIVO_M365_RE = /^resultado-operativo-m365-.+\.json$/i;

/**
 * @param {{ samAccountName: string, userPrincipalName: string }} params
 */
export function registerOperationalAccountInMemory(params) {
  const sam = String(params.samAccountName || '').trim().toLowerCase();
  const upn = String(params.userPrincipalName || '').trim().toLowerCase();
  if (sam) recentOperationalSamLower.add(sam);
  if (upn) recentOperationalUpnLower.add(upn);
}

/**
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export function isOperationalAccountReservedInMemory(sam, userPrincipalName) {
  const samKey = String(sam || '').trim().toLowerCase();
  const upnKey = String(userPrincipalName || '').trim().toLowerCase();
  if (samKey && recentOperationalSamLower.has(samKey)) return true;
  if (upnKey && recentOperationalUpnLower.has(upnKey)) return true;
  return false;
}

/**
 * El candidato es el mismo sAM base que uno reservado (p. ej. reservado usuario.ejemplo bloquea candidato usuario.ejemplo, no usuario.ejemplo.1).
 * @param {string} candidateSam
 * @param {string} reservedSam
 */
export function candidateSamCollidesWithReserved(candidateSam, reservedSam) {
  const cand = String(candidateSam || '').trim().toLowerCase();
  const res = String(reservedSam || '').trim().toLowerCase();
  if (!cand || !res) return false;
  if (cand === res) return true;
  return false;
}

/**
 * @param {string} candidateSam
 * @param {Iterable<string>} reservedSams
 */
export function isCandidateSamBlockedByOperationalM365(candidateSam, reservedSams) {
  for (const reserved of reservedSams) {
    if (candidateSamCollidesWithReserved(candidateSam, reserved)) {
      return true;
    }
  }
  return isOperationalAccountReservedInMemory(candidateSam, '');
}

/**
 * Lista sAM reservados en memoria (sesión actual). Con OPERATIONAL_M365_SMB_MIRROR también lee espejos en SMB.
 * @returns {Promise<string[]>}
 */
export async function listOperationalM365ReservedSamAccountNames() {
  const sams = new Set(recentOperationalSamLower);

  if (!isOperationalM365SmbMirrorEnabled()) {
    return [...sams];
  }

  async function absorbFromDir(dir, fileRe) {
    const root = String(dir || '').trim().replace(/[/\\]+$/g, '');
    if (!root) return;
    let names;
    try {
      const dirents = await fs.readdir(root, { withFileTypes: true });
      names = dirents.filter((d) => d.isFile() && fileRe.test(d.name)).map((d) => d.name);
    } catch {
      return;
    }
    for (const name of names) {
      try {
        const raw = await fs.readFile(joinAdQueueFilePath(root, name), 'utf8');
        const data = JSON.parse(raw);
        const sam = data?.samAccountName != null ? String(data.samAccountName).trim().toLowerCase() : '';
        if (sam) sams.add(sam);
      } catch {
        /* omitir */
      }
    }
  }

  await absorbFromDir(getAdQueueConfig().uncPath, RESERVADO_M365_JSON_RE);
  await absorbFromDir(getAdQueueResultsPath(), RESULTADO_OPERATIVO_M365_RE);

  return [...sams];
}
