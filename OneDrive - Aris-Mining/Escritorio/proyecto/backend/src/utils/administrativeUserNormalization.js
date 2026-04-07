/**
 * Misma normalización que carga masiva operativa/administrativa: Title Case en nombres, MAYÚSCULAS en puesto/depto.
 */

import { normalizeAdministrativePostalCode } from './administrativeUserValidation.js';

const WHITESPACE_SPLIT = /\s+/;

export function toTitleCaseWords(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(WHITESPACE_SPLIT)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * @param {object} body - validateAdministrativePayload (campos ya validados)
 * @returns {object} body listo para encolar
 */
export function normalizeAdministrativeBody(body) {
  const givenTrim = String(body.givenName || '').trim();
  const parts = givenTrim.split(WHITESPACE_SPLIT).filter(Boolean);
  const primer = parts[0] || '';
  const segundoRest = parts.slice(1).join(' ');
  const givenName = [toTitleCaseWords(primer), segundoRest ? toTitleCaseWords(segundoRest) : '']
    .filter(Boolean)
    .join(' ');

  return {
    ...body,
    givenName,
    surname1: toTitleCaseWords(String(body.surname1 || '').trim()),
    ...(body.surname2 != null && String(body.surname2).trim() !== ''
      ? { surname2: toTitleCaseWords(String(body.surname2).trim()) }
      : {}),
    jobTitle: String(body.jobTitle || '').trim().toUpperCase(),
    department: String(body.department || '').trim().toUpperCase(),
    employeeId: String(body.employeeId || '').trim(),
    postalCode: normalizeAdministrativePostalCode(body.postalCode),
    ...(body.city != null && String(body.city).trim() !== ''
      ? { city: String(body.city).trim() }
      : {}),
  };
}
