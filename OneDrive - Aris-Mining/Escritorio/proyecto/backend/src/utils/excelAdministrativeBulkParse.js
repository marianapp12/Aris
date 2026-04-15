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

/**
 * SheetJS renombra columnas duplicadas: segunda columna "Apellido" → "Apellido_1".
 * Eso se normaliza a "apellido1", que antes se mapeaba a primer apellido y sobrescribía el paterno.
 * @param {string} rawKey encabezado tal como viene del libro
 * @returns {'segundoApellido' | null}
 */
export function excelDuplicateApellidoColumnTarget(rawKey) {
  const rk = String(rawKey ?? '').trim();
  if (/^Apellido_1$/i.test(rk)) return 'segundoApellido';
  if (/^Apellidos_1$/i.test(rk)) return 'segundoApellido';
  return null;
}

/** Evita notación científica y conserva enteros legibles desde Excel. */
export function cellToTrimmedString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return String(v);
  }
  return String(v)
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .trim();
}

/** Mapeo sinónimos comunes → clave interna */
const HEADER_SYNONYMS = {
  primernombre: 'primerNombre',
  nombre: 'primerNombre',
  segundonombre: 'segundoNombre',
  primerapellido: 'primerApellido',
  apellidopaterno: 'primerApellido',
  apellidodelpadre: 'primerApellido',
  apellido: 'primerApellido',
  /** "Apellido 1" humano; no usar para Apellido_1 de SheetJS (véase excelDuplicateApellidoColumnTarget). */
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
  cedula: 'cedula',
  numerocedula: 'cedula',
  documento: 'cedula',
  employeeid: 'cedula',
  idempleado: 'cedula',
  ciudad: 'ciudad',
  city: 'ciudad',
  /** Columna «Sede» en plantillas internas (mismo significado que ciudad administrativa). */
  sede: 'ciudad',
  /** Encabezado «PSN» como columna de sede administrativa. */
  psn: 'ciudad',
  /** Encabezados compuestos frecuentes en Excel corporativo. */
  'ciudad/sede': 'ciudad',
  ciudadysede: 'ciudad',
  ubicacion: 'ciudad',
  codigopostal: 'codigoPostal',
  cp: 'codigoPostal',
  zip: 'codigoPostal',
  postal: 'codigoPostal',
  zipcode: 'codigoPostal',
};

/**
 * Convierte una fila cruda de sheet_to_json en campos esperados por la carga masiva administrativa.
 * Ciudad: una de Segovia, Medellín, Bogotá, PSN, Marmato, Lower Mine (compat: Overmain, Overmine; o buckets Medellin / Marmato / Segovia);
 * en AD (City) queda el nombre legible tras normalizar; la OU la deriva el backend desde administrativeCitySite.js.
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
      Cedula: '',
      Ciudad: '',
      CodigoPostal: '',
    };
  }

  let apellidosCombined = '';

  for (const [k, v] of Object.entries(rawRow)) {
    if (String(k).startsWith('__EMPTY')) continue;
    const dup = excelDuplicateApellidoColumnTarget(k);
    const nk = normalizeExcelHeaderKey(k);
    const target = dup || HEADER_SYNONYMS[nk];
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
    Cedula: acc.cedula,
    Ciudad: acc.ciudad,
    CodigoPostal: acc.codigoPostal,
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

/** Campos esperados en la fila de encabezados (tras sinónimos). */
const ADMIN_BULK_HEADER_CANONICAL = new Set([
  'primerNombre',
  'primerApellido',
  'puesto',
  'departamento',
  'cedula',
  'ciudad',
  'codigoPostal',
]);

/**
 * Cuenta cuántas columnas reconocibles de carga administrativa hay en una fila (textos de cabecera).
 * @param {unknown[]} rowValues - celdas de una fila (p. ej. desde sheet_to_json header:1)
 */
function countAdministrativeHeaderHits(rowValues) {
  const seen = new Set();
  for (const cell of rowValues) {
    const raw = String(cell ?? '').trim();
    if (!raw) continue;
    const nk = normalizeExcelHeaderKey(raw);
    const dup = excelDuplicateApellidoColumnTarget(raw);
    const target = dup || HEADER_SYNONYMS[nk];
    if (target && target !== '__apellidosCombined' && ADMIN_BULK_HEADER_CANONICAL.has(target)) {
      seen.add(target);
    }
  }
  return seen.size;
}

/**
 * Localiza la fila 0-based que parece la cabecera (≥5 columnas reconocidas en las primeras filas).
 * Evita el fallo cuando la fila 1 es título y `range:1` devuelve 0 filas (solo filas vacías debajo).
 */
function findAdministrativeHeaderRowIndex(sheet) {
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  const maxScan = Math.min(matrix.length, 25);
  let bestR = -1;
  let bestHits = 0;
  for (let r = 0; r < maxScan; r++) {
    const hits = countAdministrativeHeaderHits(matrix[r] || []);
    if (hits > bestHits) {
      bestHits = hits;
      bestR = r;
    }
  }
  if (bestHits >= 5 && bestR >= 0) return bestR;
  return null;
}

/**
 * Elige la fila de encabezados y parsea datos:
 * - Preferencia: detectar la fila con columnas Primer nombre, Apellido, Cédula, Ciudad/Sede, etc. (plantilla con título o sin él).
 * - Respaldo: heurística anterior (range 0 vs 1 de SheetJS).
 */
export function parseAdministrativeBulkSheet(sheet) {
  const opts = { raw: false, defval: '' };

  if (!sheet || !sheet['!ref']) {
    return { rows: [], firstDataExcelRow: 2 };
  }

  const refParsed = XLSX.utils.decode_range(sheet['!ref']);
  const headerIdx = findAdministrativeHeaderRowIndex(sheet);

  let rawRows;
  let firstDataExcelRow;

  if (headerIdx != null) {
    const rangeObj = {
      s: { r: headerIdx, c: refParsed.s.c },
      e: refParsed.e,
    };
    rawRows = XLSX.utils.sheet_to_json(sheet, { ...opts, range: rangeObj });
    firstDataExcelRow = headerIdx + 2;
  } else {
    const rowsRange1 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 1 });
    const rowsRange0 = XLSX.utils.sheet_to_json(sheet, { ...opts, range: 0 });

    const score1 = scoreAdministrativeSample(rowsRange1);
    const score0 = scoreAdministrativeSample(rowsRange0);

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
  }

  const rows = rawRows.map((raw) => mapRawRowToAdministrativeFields(raw));
  return { rows, firstDataExcelRow };
}
