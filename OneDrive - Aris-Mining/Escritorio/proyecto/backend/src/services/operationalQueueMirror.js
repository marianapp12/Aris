import fs from 'fs/promises';
import {
  getAdQueueConfig,
  getAdQueueResultsPath,
  isOperationalM365SmbMirrorEnabled,
  joinAdQueueFilePath,
} from '../config/adQueueConfig.js';
import { invalidateQueueSamUpnIndexCache } from './operationalAccountAvailability.js';
import { registerOperationalAccountInMemory } from './operationalUpnRegistry.js';
import { registerRecentPersonByName } from './operationalPersonRegistry.js';

/**
 * Tras crear un operativo en M365: registro en memoria (misma sesión del backend).
 * Opcionalmente espejos SMB si OPERATIONAL_M365_SMB_MIRROR=true (legacy / Graph muy lento).
 *
 * @param {{ samAccountName: string, userPrincipalName: string, email?: string, givenName?: string, surname1?: string, surname2?: string, displayName?: string }} params
 */
export async function registerOperationalM365AfterCreate(params) {
  const sam = String(params.samAccountName || '').trim();
  const userPrincipalName = String(params.userPrincipalName || '').trim();
  if (!sam || !userPrincipalName) return;

  registerOperationalAccountInMemory({ samAccountName: sam, userPrincipalName });
  if (params.givenName && params.surname1) {
    registerRecentPersonByName({
      givenName: params.givenName,
      surname1: params.surname1,
      surname2: params.surname2,
      samAccountName: sam,
      userPrincipalName,
      email: params.email || userPrincipalName,
      registrySource: 'operationalM365',
    });
  }

  if (!isOperationalM365SmbMirrorEnabled()) {
    console.log(
      `[Operational] Reserva M365 en memoria: ${sam} (${userPrincipalName}); sin archivos en carpetas SMB.`
    );
    return;
  }

  const safeSam = sam.replace(/[^a-zA-Z0-9._-]/gi, '_').slice(0, 40);
  const displayName =
    String(params.displayName || '').trim() ||
    (params.givenName && params.surname1
      ? `${String(params.givenName).trim()} ${[params.surname1, params.surname2]
          .filter(Boolean)
          .join(' ')
          .trim()}`.trim()
      : '');

  const payload = {
    status: 'success',
    source: 'operationalM365',
    displayName: displayName || undefined,
    samAccountName: sam,
    userPrincipalName,
    email: String(params.email || userPrincipalName).trim(),
    mirroredAt: new Date().toISOString(),
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  const resultsPath = getAdQueueResultsPath();
  if (resultsPath) {
    const resultFile = `resultado-operativo-m365-${safeSam}.json`;
    try {
      await fs.writeFile(joinAdQueueFilePath(resultsPath, resultFile), body, 'utf8');
      console.log(`[Operational] Espejo en resultados: ${resultFile} (${userPrincipalName})`);
    } catch (err) {
      console.warn(
        `[Operational] No se pudo escribir en resultados '${resultsPath}':`,
        err?.message || err
      );
    }
  }

  const pendingPath = getAdQueueConfig().uncPath?.trim();
  if (pendingPath) {
    const reserveFile = `.reservado-m365-${safeSam}.json`;
    try {
      await fs.writeFile(joinAdQueueFilePath(pendingPath, reserveFile), body, 'utf8');
      console.log(
        `[Operational] Reserva en pending (PS no procesa este archivo): ${reserveFile}`
      );
    } catch (err) {
      console.warn(
        `[Operational] No se pudo escribir reserva en pending '${pendingPath}':`,
        err?.message || err
      );
    }
  }

  invalidateQueueSamUpnIndexCache();
}

/** @deprecated Usar registerOperationalM365AfterCreate */
export const writeOperationalM365MirrorRecord = registerOperationalM365AfterCreate;
