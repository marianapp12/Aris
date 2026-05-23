import { buildPersonDisplayName } from '../utils/personDisplayName.js';
import { buildPersonMatch } from '../utils/personMatchBuild.js';

/** displayName en minúsculas → coincidencia reciente en esta instancia del backend. */
const recentPersonByDisplayNameLower = new Map();

/**
 * Registra una persona recién creada/encolada para detectar duplicados antes de que Graph indexe.
 * @param {{ givenName: string, surname1: string, surname2?: string, userPrincipalName?: string, samAccountName?: string, email?: string }} params
 */
export function registerRecentPersonByName(params) {
  const givenName = String(params.givenName || '').trim();
  const surname1 = String(params.surname1 || '').trim();
  const surname2 = params.surname2 ? String(params.surname2).trim() : '';
  if (!givenName || !surname1) return;

  const displayName = buildPersonDisplayName(givenName, surname1, surname2);
  const key = displayName.toLowerCase();
  if (!key) return;

  recentPersonByDisplayNameLower.set(
    key,
    buildPersonMatch({
      displayName,
      userPrincipalName: params.userPrincipalName,
      samAccountName: params.samAccountName,
      email: params.email,
    })
  );
}

/**
 * @param {string} displayName
 * @returns {import('../utils/personMatchBuild.js').PersonDirectoryMatch | undefined}
 */
export function findRecentPersonByDisplayName(displayName) {
  const key = String(displayName || '').trim().toLowerCase();
  if (!key) return undefined;
  return recentPersonByDisplayNameLower.get(key);
}

/** Solo pruebas. */
export function clearRecentPersonRegistryForTests() {
  recentPersonByDisplayNameLower.clear();
}
