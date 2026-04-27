import { describe, expect, it } from 'vitest';
import {
  normalizeName,
  generateUserName,
  generateDisplayName,
} from './userNameGenerator';

describe('userNameGenerator — normalizeName', () => {
  it('quita acentos y pasa a minúsculas', () => {
    expect(normalizeName('José')).toBe('jose');
  });

  it('elimina caracteres no alfanuméricos', () => {
    expect(normalizeName('María-López')).toBe('marialopez');
  });

  it('cadena vacía tras normalizar retorna vacío', () => {
    expect(normalizeName('   ---   ')).toBe('');
  });
});

describe('userNameGenerator — generateUserName', () => {
  it('genera localPart.nombre.apellido en minúsculas sin acentos', () => {
    expect(generateUserName('Juan', 'Pérez')).toBe('juan.perez');
  });

  it('retorna vacío si falta nombre', () => {
    expect(generateUserName('', 'García')).toBe('');
  });

  it('retorna vacío si falta apellido', () => {
    expect(generateUserName('Ana', '')).toBe('');
  });
});

describe('userNameGenerator — generateDisplayName', () => {
  it('concatena nombre y apellido con un espacio', () => {
    expect(generateDisplayName('María', 'López')).toBe('María López');
  });

  it('recorta espacios extremos en nombre y apellido', () => {
    expect(generateDisplayName('  Ana  ', '  Ruiz  ')).toBe('Ana Ruiz');
  });
});
