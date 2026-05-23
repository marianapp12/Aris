/**
 * Prechequeo de duplicados en carga masiva Excel (sin crear usuarios).
 * POST .../operational/bulk-precheck y .../administrative/bulk-precheck
 */
import XLSX from 'xlsx';
import { parseOperationalBulkSheet } from '../utils/excelOperationalBulkParse.js';
import { parseAdministrativeBulkSheet } from '../utils/excelAdministrativeBulkParse.js';
import { precheckBulkRowsForDuplicates } from '../services/bulkExistingPersonPrecheck.js';

async function parseBulkSheetFromUpload(file) {
  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    const err = new Error('El archivo Excel no contiene hojas.');
    err.statusCode = 400;
    throw err;
  }
  return sheet;
}

export const precheckOperationalBulk = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Archivo faltante',
        message: 'Debe adjuntar un archivo Excel en el campo "file".',
      });
    }

    const sheet = await parseBulkSheetFromUpload(req.file);
    const { rows, firstDataExcelRow } = parseOperationalBulkSheet(sheet);

    if (!rows.length) {
      return res.status(400).json({
        error: 'Sin datos',
        message: 'El archivo no contiene filas de datos.',
      });
    }

    const jobs = rows.map((row, index) => ({
      row,
      rowNumber: index + firstDataExcelRow,
    }));

    const rowsPrecheck = await precheckBulkRowsForDuplicates(jobs, 'operational');
    const duplicateRows = rowsPrecheck.filter((r) => r.exists);

    return res.status(200).json({
      message: 'Prechequeo de duplicados completado.',
      totalRows: rowsPrecheck.length,
      duplicateCount: duplicateRows.length,
      rows: rowsPrecheck,
    });
  } catch (error) {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return res.status(status).json({
      error: 'Prechequeo fallido',
      message: error.message || 'No se pudo prechequear el archivo.',
    });
  }
};

/**
 * POST /api/users/administrative/bulk-precheck
 */
export const precheckAdministrativeBulk = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'Archivo faltante',
        message: 'Debe adjuntar un archivo Excel en el campo "file".',
      });
    }

    const sheet = await parseBulkSheetFromUpload(req.file);
    const { rows, firstDataExcelRow } = parseAdministrativeBulkSheet(sheet);

    if (!rows.length) {
      return res.status(400).json({
        error: 'Sin datos',
        message: 'El archivo no contiene filas de datos.',
      });
    }

    const jobs = rows.map((row, index) => ({
      row,
      rowNumber: index + firstDataExcelRow,
    }));

    const rowsPrecheck = await precheckBulkRowsForDuplicates(jobs, 'administrative');
    const duplicateRows = rowsPrecheck.filter((r) => r.exists);

    return res.status(200).json({
      message: 'Prechequeo de duplicados completado.',
      totalRows: rowsPrecheck.length,
      duplicateCount: duplicateRows.length,
      rows: rowsPrecheck,
    });
  } catch (error) {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return res.status(status).json({
      error: 'Prechequeo fallido',
      message: error.message || 'No se pudo prechequear el archivo.',
    });
  }
};
