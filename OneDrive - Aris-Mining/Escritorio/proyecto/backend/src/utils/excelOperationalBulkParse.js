import XLSX from 'xlsx';
import { isValidOperationalSede } from '../config/operationalSede.js';
import {
  normalizeExcelHeaderKey,
  cellToTrimmedString,
  excelDuplicateApellidoColumnTarget,
} from './excelAdministrativeBulkParse.js';

/** Sinónimos de encabezado → campo interno (tras normalizar clave: sin tildes, sin espacios). */
const OPERATIONAL_HEADER_SYNONYMS = {
  primernombre: 'primerNombre',
  nombre: 'primerNombre',
  segundonombre: 'segundoNombre',
  primerapellido: 'primerApellido',
  apellidopaterno: 'primerApellido',
  apellidodelpadre: 'primerApellido',
  apellido: 'primerApellido',
  /** "Apellido 1"; la 2ª columna duplicada "Apellido" en Excel es Apellido_1 → segundo (excelDuplicateApellidoColumnTarget). */
  apellido1: 'primerApellido',
  segundoapellido: 'segundoApellido',
  apellidomaterno: 'segundoApellido',
  apellidodelamadre: 'segundoApellido',
  apellido2: 'segundoApellido',
  apellidos: '__apellidosCombined',
  apellidoscompletos: '__apellidosCombined',
  puesto: 'puesto',
  cargo: 'puesto',
  departamento: 'departamento',
  depto: 'departamento',
  area: 'departamento',
  sede: 'sede',
  ubicacion: 'sede',
  oficina: 'sede',
  codigopostal: 'codigoPostal',
  cp: 'codigoPostal',
  zip: 'codigoPostal',
  postal: 'codigoPostal',
  zipcode: 'codigoPostal',
};

/**
 * Convierte una fila cruda de sheet_to_json en el shape esperado por createOperationalUsersBulk.
 */
export function mapRawRowToOperationalFields(rawRow) {
  const acc = {
    primerNombre: '',
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
    puesto: '',
    departamento: '',
    sede: '',
    codigoPostal: '',
  };

  if (!rawRow || typeof rawRow !== 'object') {
    return {
      PrimerNombre: '',
      SegundoNombre: '',
      PrimerApellido: '',
      SegundoApellido: '',
      Puesto: '',
      Departamento: '',
      Sede: '',
      CodigoPostal: '',
    };
  }

  let apellidosCombined = '';

  for (const [k, v] of Object.entries(rawRow)) {
    if (String(k).startsWith('__EMPTY')) continue;
    const dup = excelDuplicateApellidoColumnTarget(k);
    const nk = normalizeExcelHeaderKey(k);
    const target = dup || OPERATIONAL_HEADER_SYNONYMS[nk];
    if (!target) continue;
    const val = cellToTrimmedString(v);
    if (!val) continue;
    if (target === '__apellidosCombined') {
      apellidosCombined = val;
      continue;
    }
    acc[target] = val;
  }

  if (apellidosCombined) {
    const parts = apellidosCombined.split(/\s+/).filter(Boolean);
    if (!acc.primerApellido && parts[0]) acc.primerApellido = parts[0];
    if (!acc.segundoApellido && parts.length >= 2) acc.segundoApellido = parts.slice(1).join(' ');
  }

  return {
    PrimerNombre: acc.primerNombre,
    SegundoNombre: acc.segundoNombre,
    PrimerApellido: acc.primerApellido,
    SegundoApellido: acc.segundoApellido,
    Puesto: acc.puesto,
    Departamento: acc.departamento,
    Sede: acc.sede,
    CodigoPostal: acc.codigoPostal,
  };
}

function scoreOperationalSample(rawRows) {
  let score = 0;
  const n = Math.min(8, rawRows.length);
  for (let i = 0; i < n; i++) {
    const m = mapRawRowToOperationalFields(rawRows[i]);
    const sede = (m.Sede || '').trim();
    if (m.PrimerNombre && m.PrimerApellido) {
      score += 1;
      if (isValidOperationalSede(sede)) score += 3;
      else if (sede) score += 1;
    }
  }
  return score;
}

/**
 * Elige si la fila de encabezados está en la fila 1 o 2 de Excel (misma heurística que administrativos).
 * @returns {{ rows: Record<string, string>[], firstDataExcelRow: number }}
 */
export function parseOperationalBulkSheet(sheet) {
  const opts = { raw: false, defval: '' };

  const rowsRange1 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 1 });
  const rowsRange0 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 0 });

  const score1 = scoreOperationalSample(rowsRange1);
  const score0 = scoreOperationalSample(rowsRange0);

  let rawRows;
  let firstDataExcelRow;

  if (score0 > score1) {
    rawRows = rowsRange0;
    firstDataExcelRow = 2;
  } else if (rowsRange1.length > 0) {
    rawRows = rowsRange1;
    firstDataExcelRow = 3;
  } else {
    rawRows = rowsRange0;
    firstDataExcelRow = 2;
  }

  const rows = rawRows.map((raw) => mapRawRowToOperationalFields(raw));
  return { rows, firstDataExcelRow };
}
