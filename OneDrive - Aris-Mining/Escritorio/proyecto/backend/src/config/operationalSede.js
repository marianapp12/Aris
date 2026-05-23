/**
 * Sedes válidas en el formulario y en la columna «Sede» del Excel operativo.
 * Los grupos M365 por sede están en operationalSedeGroups.js (operarios.*, colaboradores.*).
 */
import { getGroupObjectIdForSedeRole } from './operationalSedeGroups.js';

/** Valores exactos que acepta el front y el Excel (respetar tildes y mayúsculas). */
export const OPERATIONAL_SEDE_VALUES = Object.freeze([
  'Medellín',
  'Segovia',
  'Marmato',
  'Bogotá',
  'Bucaramanga',
]);

/** @param {unknown} value */
export function isValidOperationalSede(value) {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  return OPERATIONAL_SEDE_VALUES.includes(t);
}

/** Devuelve el Object ID del grupo operarios de la sede (atajo; ver getGroupObjectIdForSedeRole). */
export function getGroupObjectIdForSede(sede) {
  return getGroupObjectIdForSedeRole('operarios', sede);
}

export { getGroupObjectIdForSedeRole, formatOperationalGroupName } from './operationalSedeGroups.js';
