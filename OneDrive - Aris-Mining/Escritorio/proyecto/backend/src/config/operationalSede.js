/**
 * Sedes permitidas para usuarios operativos (Microsoft 365) y mapeo a Object ID de grupo en Entra ID.
 * Los valores deben coincidir exactamente con lo que envía el frontend / columna Excel "Sede".
 */
import {
  sanitizeGroupObjectIdEnv,
  isLikelyEntraObjectId,
  maskObjectIdForLog,
} from '../utils/envObjectId.js';

export const OPERATIONAL_SEDE_VALUES = Object.freeze([
  'Medellín',
  'Segovia',
  'Marmato',
  'Bogotá',
  'Bucaramanga',
]);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidOperationalSede(value) {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  return OPERATIONAL_SEDE_VALUES.includes(t);
}

/**
 * Object ID del grupo de seguridad/Microsoft 365 según sede (variables .env).
 * @param {string} sede - Una de OPERATIONAL_SEDE_VALUES
 * @returns {string | null} UUID del grupo o null si no está configurado
 */
export function getGroupObjectIdForSede(sede) {
  const t = String(sede).trim();
  /** @type {Array<{ sede: string; envVar: string; raw: string | undefined }>} */
  const rows = [
    { sede: 'Medellín', envVar: 'GROUP_MEDELLIN_ID', raw: process.env.GROUP_MEDELLIN_ID },
    { sede: 'Segovia', envVar: 'GROUP_SEGOVIA_ID', raw: process.env.GROUP_SEGOVIA_ID },
    { sede: 'Marmato', envVar: 'GROUP_MARMATO_ID', raw: process.env.GROUP_MARMATO_ID },
    { sede: 'Bogotá', envVar: 'GROUP_BOGOTA_ID', raw: process.env.GROUP_BOGOTA_ID },
    { sede: 'Bucaramanga', envVar: 'GROUP_BUCARAMANGA_ID', raw: process.env.GROUP_BUCARAMANGA_ID },
  ];
  const row = rows.find((r) => r.sede === t);
  if (!row) {
    console.warn(`[SEDE] Sede desconocida "${t}" para mapeo de grupo.`);
    return null;
  }

  const cleaned = sanitizeGroupObjectIdEnv(row.raw);
  if (!cleaned) {
    console.warn(
      `[SEDE] Falta o vacío ${row.envVar} para sede "${t}". No se asignará al grupo (el usuario ya creado no se revierte).`
    );
    return null;
  }

  if (!isLikelyEntraObjectId(cleaned)) {
    console.warn(
      `[SEDE] ${row.envVar} no parece un UUID de Object ID de Entra (enmascarado: ${maskObjectIdForLog(
        cleaned
      )}). Revise el valor en .env y el Id. de objeto del grupo en Azure Portal.`
    );
  }

  return cleaned;
}
