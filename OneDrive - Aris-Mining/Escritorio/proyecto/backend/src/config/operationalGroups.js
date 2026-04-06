/**
 * Grupos comunes para todos los usuarios operativos (además del grupo por sede).
 * OPERATIONAL_COMMON_GROUP_IDS: Object IDs separados por coma (p. ej. tres UUID).
 * Los segmentos vacíos tras una coma cuentan como ranura sin configurar.
 */

import { sanitizeGroupObjectIdEnv } from '../utils/envObjectId.js';

let warnedEmptyCommonGroups = false;

/**
 * @returns {string[]} Partes tras split por coma (trim); vacío si no hay variable.
 */
export function getOperationalCommonGroupSlots() {
  const raw = sanitizeGroupObjectIdEnv(process.env.OPERATIONAL_COMMON_GROUP_IDS);
  if (!raw) {
    if (!warnedEmptyCommonGroups) {
      warnedEmptyCommonGroups = true;
      console.warn(
        '[OPERATIONAL_GROUPS] OPERATIONAL_COMMON_GROUP_IDS vacío: no se asignarán grupos comunes (defina hasta tres Object ID separados por coma).'
      );
    }
    return [];
  }
  return raw.split(',').map((s) => sanitizeGroupObjectIdEnv(s));
}

/**
 * Nombres para mostrar de grupos comunes (mismo orden y cantidad de ranuras que OPERATIONAL_COMMON_GROUP_IDS).
 * Separados por coma; si un segmento está vacío se ignora como etiqueta en esa posición.
 * Útil cuando Graph no devuelve displayName (p. ej. sin Group.Read.All).
 *
 * @returns {string[]}
 */
export function getOperationalCommonGroupDisplayNameSlots() {
  const raw = process.env.OPERATIONAL_COMMON_GROUP_DISPLAY_NAMES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim());
}
