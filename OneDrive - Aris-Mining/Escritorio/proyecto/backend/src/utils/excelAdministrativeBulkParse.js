import XLSX from 'xlsx';

/** Normaliza encabezados: trim, minúsculas, sin tildes, sin espacios ni guiones bajos. */
export function normalizeExcelHeaderKey(k) {
  return String(k ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '');
}

/** Evita notación científica y conserva enteros legibles desde Excel. */
export function cellToTrimmedString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(v);
  }
  return String(v).trim();
}

/** Mapeo sinónimos comunes → clave interna */
const HEADER_SYNONYMS = {
  primernombre: 'primerNombre',
  nombre: 'primerNombre',
  segundonombre: 'segundoNombre',
  primerapellido: 'primerApellido',
  apellido: 'primerApellido',
  apellido1: 'primerApellido',
  segundoapellido: 'segundoApellido',
  apellido2: 'segundoApellido',
  puesto: 'puesto',
  cargo: 'puesto',
  departamento: 'departamento',
  depto: 'departamento',
  area: 'departamento',
  cedula: 'cedula',
  numerocedula: 'cedula',
  documento: 'cedula',
  employeeid: 'cedula',
  idempleado: 'cedula',
  ciudad: 'ciudad',
  city: 'ciudad',
};

/**
 * Convierte una fila cruda de sheet_to_json en campos esperados por la carga masiva administrativa.
 */
export function mapRawRowToAdministrativeFields(rawRow) {
  const acc = {
    primerNombre: '',
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
    puesto: '',
    departamento: '',
    cedula: '',
    ciudad: '',
  };

  if (!rawRow || typeof rawRow !== 'object') {
    return {
      PrimerNombre: '',
      SegundoNombre: '',
      PrimerApellido: '',
      SegundoApellido: '',
      Puesto: '',
      Departamento: '',
      Cedula: '',
      Ciudad: '',
    };
  }

  for (const [k, v] of Object.entries(rawRow)) {
    if (String(k).startsWith('__EMPTY')) continue;
    const nk = normalizeExcelHeaderKey(k);
    const target = HEADER_SYNONYMS[nk];
    if (!target) continue;
    const val = cellToTrimmedString(v);
    if (!val) continue;
    acc[target] = val;
  }

  return {
    PrimerNombre: acc.primerNombre,
    SegundoNombre: acc.segundoNombre,
    PrimerApellido: acc.primerApellido,
    SegundoApellido: acc.segundoApellido,
    Puesto: acc.puesto,
    Departamento: acc.departamento,
    Cedula: acc.cedula,
    Ciudad: acc.ciudad,
  };
}

function scoreAdministrativeSample(rawRows) {
  let score = 0;
  const n = Math.min(8, rawRows.length);
  for (let i = 0; i < n; i++) {
    const m = mapRawRowToAdministrativeFields(rawRows[i]);
    if (m.PrimerNombre && m.PrimerApellido && m.Cedula) score += 3;
    else if (m.PrimerNombre && m.PrimerApellido) score += 1;
  }
  return score;
}

/**
 * Elige range (fila 0-based donde están los encabezados en SheetJS):
 * - range 1: fila 1 Excel = título ignorado, fila 2 = encabezados, datos desde fila 3 (plantilla documentada)
 * - range 0: fila 1 = encabezados, datos desde fila 2 (muy habitual sin fila de título)
 */
export function parseAdministrativeBulkSheet(sheet) {
  const opts = { raw: false, defval: '' };

  const rowsRange1 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 1 });
  const rowsRange0 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 0 });

  const score1 = scoreAdministrativeSample(rowsRange1);
  const score0 = scoreAdministrativeSample(rowsRange0);

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

  const rows = rawRows.map((raw) => mapRawRowToAdministrativeFields(raw));
  return { rows, firstDataExcelRow };
}
