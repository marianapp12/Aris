/**
 * Nombre para mostrar alineado con alta operativa/administrativa (Graph y cola AD).
 * @param {string} givenName
 * @param {string} surname1
 * @param {string} [surname2]
 */
export function buildPersonDisplayName(givenName, surname1, surname2) {
  const s = [surname1, surname2].filter(Boolean).join(' ');
  return `${String(givenName).trim()} ${s}`.trim();
}

/**
 * Apellidos concatenados como en Graph (`surname`).
 * @param {string} surname1
 * @param {string} [surname2]
 */
export function buildPersonFullSurname(surname1, surname2) {
  return [surname1, surname2].filter(Boolean).join(' ').trim();
}
