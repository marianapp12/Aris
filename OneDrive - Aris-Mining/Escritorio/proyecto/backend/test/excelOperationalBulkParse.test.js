import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import {
  mapRawRowToOperationalFields,
  parseOperationalBulkSheet,
} from '../src/utils/excelOperationalBulkParse.js';

describe('mapRawRowToOperationalFields', () => {
  it('mapea sinónimos de encabezados', () => {
    const row = mapRawRowToOperationalFields({
      Nombre: 'Ana',
      'Primer apellido': 'López',
      Sede: 'Segovia',
      CP: '1234567',
      Puesto: 'Operario',
      Departamento: 'Mina',
    });
    expect(row.PrimerNombre).toBe('Ana');
    expect(row.PrimerApellido).toBe('López');
    expect(row.Sede).toBe('Segovia');
    expect(row.CodigoPostal).toBe('1234567');
  });

  it('trata Apellido_1 de SheetJS como segundo apellido', () => {
    const row = mapRawRowToOperationalFields({
      Apellido: 'Pérez',
      Apellido_1: 'Gómez',
    });
    expect(row.PrimerApellido).toBe('Pérez');
    expect(row.SegundoApellido).toBe('Gómez');
  });

  it('combina columna Apellidos en faltantes', () => {
    const row = mapRawRowToOperationalFields({
      Apellidos: 'Ruiz Soto',
    });
    expect(row.PrimerApellido).toBe('Ruiz');
    expect(row.SegundoApellido).toBe('Soto');
  });

  it('devuelve vacíos para fila inválida', () => {
    const row = mapRawRowToOperationalFields(null);
    expect(row.PrimerNombre).toBe('');
  });
});

describe('parseOperationalBulkSheet', () => {
  it('parsea una hoja mínima con encabezados en fila 1', () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Nombre', 'Apellido', 'Puesto', 'Departamento', 'Sede', 'Codigo postal'],
      ['Luis', 'Martinez', 'Técnico', 'Planta', 'Segovia', '1234567'],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, 'H1');
    const { rows, firstDataExcelRow } = parseOperationalBulkSheet(sheet);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(firstDataExcelRow).toBeGreaterThanOrEqual(2);
    expect(rows[0].PrimerNombre).toBe('Luis');
    expect(rows[0].Sede).toBe('Segovia');
  });
});
