import { describe, expect, it } from 'vitest';
import {
  validateAdministrativePayload,
  normalizeAdministrativePostalCode,
  EMPLOYEE_ID_MIN_LENGTH,
} from '../src/utils/administrativeUserValidation.js';

const validBase = {
  givenName: 'María',
  surname1: 'García',
  jobTitle: 'Analista',
  department: 'Sistemas',
  employeeId: '12345',
  city: 'Medellín',
  postalCode: '050021',
};

describe('validateAdministrativePayload', () => {
  it('acepta un cuerpo válido', () => {
    expect(validateAdministrativePayload(validBase)).toEqual({ ok: true });
  });

  it('rechaza campos obligatorios faltantes', () => {
    const r = validateAdministrativePayload({ ...validBase, givenName: '' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toBe('Campos obligatorios faltantes');
  });

  it('rechaza cédula vacía', () => {
    const r = validateAdministrativePayload({ ...validBase, employeeId: '   ' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/cédula/i);
  });

  it('rechaza cédula demasiado corta', () => {
    const id = 'x'.repeat(EMPLOYEE_ID_MIN_LENGTH - 1);
    const r = validateAdministrativePayload({ ...validBase, employeeId: id });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rechaza código postal no numérico', () => {
    const r = validateAdministrativePayload({ ...validBase, postalCode: 'ABCD' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/postal/i);
  });

  it('rechaza ciudad desconocida', () => {
    const r = validateAdministrativePayload({ ...validBase, city: 'CiudadInventada' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/no válida/i);
  });

  it('rechaza caracteres inválidos en puesto', () => {
    const r = validateAdministrativePayload({ ...validBase, jobTitle: 'Dev123' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Puesto/i);
  });
});

describe('normalizeAdministrativePostalCode', () => {
  it('elimina espacios', () => {
    expect(normalizeAdministrativePostalCode('  05 0021  ')).toBe('050021');
  });
});
