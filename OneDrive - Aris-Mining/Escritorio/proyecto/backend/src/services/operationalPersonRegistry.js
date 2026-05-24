import { buildPersonDisplayName } from '../utils/personDisplayName.js';
import { buildPersonMatch } from '../utils/personMatchBuild.js';

/** @typedef {'administrativeQueue' | 'operationalM365'} PersonRegistrySource */

/** displayName en minúsculas → coincidencia reciente en esta instancia del backend. */
const recentAdminByDisplayNameLower = new Map();
const recentOperationalByDisplayNameLower = new Map();
/** sAM/UPN administrativos encolados en esta sesión (antes de que el índice SMB se refresque). */
const recentAdminSamLower = new Set();
const recentAdminUpnLower = new Set();

/**
 * Registra una persona recién creada/encolada para detectar duplicados antes de que Graph indexe.
 * @param {{
 *   givenName: string,
 *   surname1: string,
 *   surname2?: string,
 *   userPrincipalName?: string,
 *   samAccountName?: string,
 *   email?: string,
 *   registrySource?: PersonRegistrySource,
 * }} params
 */
export function registerRecentPersonByName(params) {
  const givenName = String(params.givenName || '').trim();
  const surname1 = String(params.surname1 || '').trim();
  const surname2 = params.surname2 ? String(params.surname2).trim() : '';
  if (!givenName || !surname1) return;

  const displayName = buildPersonDisplayName(givenName, surname1, surname2);
  const key = displayName.toLowerCase();
  if (!key) return;

  const match = buildPersonMatch({
    displayName,
    userPrincipalName: params.userPrincipalName,
    samAccountName: params.samAccountName,
    email: params.email,
  });

  const target =
    params.registrySource === 'operationalM365'
      ? recentOperationalByDisplayNameLower
      : recentAdminByDisplayNameLower;
  target.set(key, match);
}

/**
 * @param {string} displayName
 * @param {PersonRegistrySource} registrySource
 * @returns {import('../utils/personMatchBuild.js').PersonDirectoryMatch | undefined}
 */
export function findRecentPersonByDisplayName(displayName, registrySource) {
  const key = String(displayName || '').trim().toLowerCase();
  if (!key) return undefined;
  const map =
    registrySource === 'operationalM365'
      ? recentOperationalByDisplayNameLower
      : recentAdminByDisplayNameLower;
  return map.get(key);
}

/** @deprecated Usar findRecentPersonByDisplayName(displayName, 'administrativeQueue' | 'operationalM365') */
export function findRecentPersonByDisplayNameLegacy(displayName) {
  return (
    findRecentPersonByDisplayName(displayName, 'administrativeQueue') ||
    findRecentPersonByDisplayName(displayName, 'operationalM365')
  );
}

/**
 * Reserva UPN/sAM administrativo en memoria (misma sesión del backend).
 * @param {{ samAccountName?: string, userPrincipalName?: string }} params
 */
export function registerRecentAdministrativeAccount(params) {
  const sam = String(params.samAccountName || '').trim().toLowerCase();
  const upn = String(params.userPrincipalName || '').trim().toLowerCase();
  if (sam) recentAdminSamLower.add(sam);
  if (upn) recentAdminUpnLower.add(upn);
}

/**
 * @param {string} sam
 * @param {string} userPrincipalName
 */
export function isAdministrativeAccountReservedInMemory(sam, userPrincipalName) {
  const samKey = String(sam || '').trim().toLowerCase();
  const upnKey = String(userPrincipalName || '').trim().toLowerCase();
  if (samKey && recentAdminSamLower.has(samKey)) return true;
  if (upnKey && recentAdminUpnLower.has(upnKey)) return true;
  return false;
}

/** Solo pruebas. */
export function clearRecentPersonRegistryForTests() {
  recentAdminByDisplayNameLower.clear();
  recentOperationalByDisplayNameLower.clear();
  recentAdminSamLower.clear();
  recentAdminUpnLower.clear();
}
