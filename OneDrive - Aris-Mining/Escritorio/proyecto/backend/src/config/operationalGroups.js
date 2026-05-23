/**
 * Grupos M365 compartidos por todos los operativos (además de operarios/colaboradores por sede).
 *
 * .env:
 * - OPERATIONAL_COMMON_GROUP_IDS — Object IDs separados por coma
 * - OPERATIONAL_COMMON_GROUP_DISPLAY_NAMES — nombres para la UI (mismo orden, opcional)
 */

import { sanitizeGroupObjectIdEnv } from '../utils/envObjectId.js';

let warnedEmptyCommonGroups = false;

/** Lista de Object ID de grupos comunes (vacía si no hay variable en .env). */
export function getOperationalCommonGroupSlots() {
  const raw = sanitizeGroupObjectIdEnv(process.env.OPERATIONAL_COMMON_GROUP_IDS);
  if (!raw) {
    if (!warnedEmptyCommonGroups) {
      warnedEmptyCommonGroups = true;
      console.warn(
        '[OPERATIONAL_GROUPS] OPERATIONAL_COMMON_GROUP_IDS vacío: no se asignarán grupos comunes.'
      );
    }
    return [];
  }
  return raw.split(',').map((s) => sanitizeGroupObjectIdEnv(s));
}

/** Etiquetas para mostrar en el front si Graph no devuelve displayName. */
export function getOperationalCommonGroupDisplayNameSlots() {
  const raw = process.env.OPERATIONAL_COMMON_GROUP_DISPLAY_NAMES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim());
}
