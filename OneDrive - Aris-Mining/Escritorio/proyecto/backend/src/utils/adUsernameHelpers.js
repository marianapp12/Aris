/**
 * Generación de sAMAccountName / localPart alineada con graphUpnCandidatePicker (operativos y administrativos vía Graph).
 */

export const normalizeName = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

export const generateLocalPart = (givenName, surname) => {
  const normalizedGivenName = normalizeName(givenName);
  const normalizedSurname = normalizeName(surname);
  if (!normalizedGivenName || !normalizedSurname) {
    throw new Error('No se puede generar el nombre de usuario: nombre o apellido inválido');
  }
  return `${normalizedGivenName}.${normalizedSurname}`;
};

/** Máximo recomendado para sAMAccountName en AD (compatibilidad legada). */
export const SAM_MAX_LENGTH = 20;

/**
 * Trunca el localPart para sAMAccountName (≤ SAM_MAX_LENGTH).
 * Si termina en .número (homónimos), preserva el sufijo y trunca solo la base para que .1 y .2 no colisionen.
 */
export function truncateForSamAccountName(localPart) {
  if (!localPart || localPart.length <= SAM_MAX_LENGTH) return localPart;

  const m = localPart.match(/^(.+)\.(\d+)$/);
  if (m) {
    const base = m[1];
    const suffix = `.${m[2]}`;
    const maxBaseLen = SAM_MAX_LENGTH - suffix.length;
    if (maxBaseLen < 1) {
      return localPart.slice(0, SAM_MAX_LENGTH);
    }
    const truncatedBase = base.length > maxBaseLen ? base.slice(0, maxBaseLen) : base;
    return `${truncatedBase}${suffix}`;
  }

  return localPart.slice(0, SAM_MAX_LENGTH);
}

/**
 * Itera candidatos en el mismo orden que generateUniqueUserPrincipalName en graphUserService.
 * @param {string} givenName
 * @param {string} surname1
 * @param {string} [surname2]
 * @returns {Generator<string>}
 */
export function* iterateLocalPartCandidates(givenName, surname1, surname2) {
  const g = givenName.trim();
  const s1 = surname1.trim();
  const s2 = surname2?.trim() || '';

  const nameParts = g.split(/\s+/).filter(Boolean);
  const primaryGivenName = nameParts[0] || g;
  const secondaryGivenName = nameParts[1] || null;

  yield generateLocalPart(primaryGivenName, s1);
  if (s2) yield generateLocalPart(primaryGivenName, s2);
  if (secondaryGivenName) yield generateLocalPart(secondaryGivenName, s1);
  if (secondaryGivenName && s2) yield generateLocalPart(secondaryGivenName, s2);

  const baseLocalPart = generateLocalPart(primaryGivenName, s1);
  for (let counter = 1; counter < 100; counter++) {
    yield `${baseLocalPart}.${counter}`;
  }
}

