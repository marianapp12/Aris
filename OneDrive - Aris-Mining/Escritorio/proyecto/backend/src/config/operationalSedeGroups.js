/**
 * Enlace entre sede del formulario y grupos en Microsoft Entra ID.
 *
 * Convención de nombres en Azure: operarios.medellin, colaboradores.segovia, etc.
 * Variables en .env: GROUP_OPERARIOS_MEDELLIN_ID, GROUP_COLABORADORES_SEGOVIA_ID, …
 *
 * Compatibilidad: si no existe GROUP_OPERARIOS_*_ID, se usa GROUP_MEDELLIN_ID (nombre antiguo).
 */
import {
  sanitizeGroupObjectIdEnv,
  isLikelyEntraObjectId,
  maskObjectIdForLog,
} from '../utils/envObjectId.js';

/** @typedef {'operarios' | 'colaboradores'} OperationalSedeGroupRole */

export const OPERATIONAL_SEDE_GROUP_ROLES = Object.freeze(['operarios', 'colaboradores']);

/** Convierte «Medellín» → medellin (para armar operarios.medellin). */
export function sedeToGroupSlug(sede) {
  return String(sede ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Nombre esperado del grupo, p. ej. operarios.bucaramanga. */
export function formatOperationalGroupName(role, sede) {
  const slug = sedeToGroupSlug(sede);
  if (!slug) return role;
  return `${role}.${slug}`;
}

/** @type {ReadonlyArray<{ sede: string; envSlug: string; legacyEnvVar: string }>} */
const SEDE_GROUP_ROWS = Object.freeze([
  { sede: 'Medellín', envSlug: 'MEDELLIN', legacyEnvVar: 'GROUP_MEDELLIN_ID' },
  { sede: 'Segovia', envSlug: 'SEGOVIA', legacyEnvVar: 'GROUP_SEGOVIA_ID' },
  { sede: 'Marmato', envSlug: 'MARMATO', legacyEnvVar: 'GROUP_MARMATO_ID' },
  { sede: 'Bogotá', envSlug: 'BOGOTA', legacyEnvVar: 'GROUP_BOGOTA_ID' },
  { sede: 'Bucaramanga', envSlug: 'BUCARAMANGA', legacyEnvVar: 'GROUP_BUCARAMANGA_ID' },
]);

function envVarForSedeRole(role, envSlug) {
  const roleUpper = role === 'operarios' ? 'OPERARIOS' : 'COLABORADORES';
  return `GROUP_${roleUpper}_${envSlug}_ID`;
}

function findSedeGroupRow(sede) {
  const t = String(sede).trim();
  return SEDE_GROUP_ROWS.find((r) => r.sede === t) ?? null;
}

/**
 * Lee el Object ID del grupo desde .env para un rol y una sede.
 * @returns {string | null} UUID del grupo o null si no está configurado
 */
export function getGroupObjectIdForSedeRole(role, sede) {
  const row = findSedeGroupRow(sede);
  if (!row) {
    console.warn(`[SEDE] Sede desconocida "${sede}" para grupo ${role}.`);
    return null;
  }

  const primaryVar = envVarForSedeRole(role, row.envSlug);
  let raw = process.env[primaryVar];

  if (!raw?.trim() && role === 'operarios') {
    raw = process.env[row.legacyEnvVar];
    if (raw?.trim()) {
      console.warn(
        `[SEDE] Use ${primaryVar} en .env (grupo esperado: ${formatOperationalGroupName(
          role,
          sede
        )}). Usando ${row.legacyEnvVar} por compatibilidad.`
      );
    }
  }

  const cleaned = sanitizeGroupObjectIdEnv(raw);
  if (!cleaned) {
    console.warn(
      `[SEDE] Falta ${primaryVar} para "${sede}" (${formatOperationalGroupName(role, sede)}). No se asignará ese grupo.`
    );
    return null;
  }

  if (!isLikelyEntraObjectId(cleaned)) {
    console.warn(
      `[SEDE] ${primaryVar} no parece un UUID válido (${maskObjectIdForLog(cleaned)}).`
    );
  }

  return cleaned;
}
