import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import {
  normalizeExcelHeaderKey,
  excelDuplicateApellidoColumnTarget,
  mapRawRowToAdministrativeFields,
  parseAdministrativeBulkSheet,
} from '../src/utils/excelAdministrativeBulkParse.js';

describe('normalizeExcelHeaderKey', () => {
  it('normaliza tildes y espacios', () => {
    expect(normalizeExcelHeaderKey('  Código Postal  ')).toBe('codigopostal');
    expect(normalizeExcelHeaderKey('Primer_Nombre')).toBe('primernombre');
  });
});

describe('excelDuplicateApellidoColumnTarget', () => {
  it('detecta segunda columna Apellido de Excel', () => {
    expect(excelDuplicateApellidoColumnTarget('Apellido_1')).toBe('segundoApellido');
    expect(excelDuplicateApellidoColumnTarget('Apellido')).toBe(null);
  });
});

describe('mapRawRowToAdministrativeFields', () => {
  it('mapea cédula y ciudad administrativa', () => {
    const row = mapRawRowToAdministrativeFields({
      'Primer nombre': 'Carlos',
      Cédula: '12345678',
      Ciudad: 'Medellín',
      'Codigo postal': '050021',
      Puesto: 'Contador',
      Departamento: 'Finanzas',
    });
    expect(row.PrimerNombre).toBe('Carlos');
    expect(row.Cedula).toBe('12345678');
    expect(row.Ciudad).toBe('Medellín');
    expect(row.CodigoPostal).toBe('050021');
  });
});

describe('parseAdministrativeBulkSheet', () => {
  it('extrae al menos una fila de datos con cabeceras reconocibles', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Primer nombre', 'Primer apellido', 'Puesto', 'Departamento', 'Cedula', 'Ciudad', 'Codigo postal'],
      ['Ana', 'Diaz', 'Asistente', 'RRHH', '99999001', 'Segovia', '1234567'],
    ]);
    const { rows, firstDataExcelRow } = parseAdministrativeBulkSheet(sheet);
    expect(rows.length).toBe(1);
    expect(firstDataExcelRow).toBeGreaterThanOrEqual(2);
    expect(rows[0].Cedula).toBe('99999001');
  });
});
