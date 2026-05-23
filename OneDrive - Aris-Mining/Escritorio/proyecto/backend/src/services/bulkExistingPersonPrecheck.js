/**
 * Por cada fila del Excel, llama a checkExistingPersonByName (misma lógica que el alta individual).
 */
import { mapWithConcurrency } from '../utils/asyncPool.js';
import { warmQueueSamUpnIndex } from './operationalAccountAvailability.js';
import { checkExistingPersonByName } from './personNameExistsCheck.js';
import { buildPersonDisplayName } from '../utils/personDisplayName.js';

const toTitleCase = (value) =>
  value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * @param {Record<string, unknown>} row
 */
export function operationalRowToCheckParams(row) {
  const primerNombre = toTitleCase(String(row.PrimerNombre || '').trim());
  const segundoNombre = String(row.SegundoNombre || '').trim()
    ? toTitleCase(String(row.SegundoNombre).trim())
    : '';
  const apellido1 = toTitleCase(String(row.PrimerApellido || '').trim());
  const apellido2 = String(row.SegundoApellido || '').trim()
    ? toTitleCase(String(row.SegundoApellido).trim())
    : '';

  const givenName = [primerNombre, segundoNombre].filter(Boolean).join(' ');
  return {
    givenName,
    surname1: apellido1,
    surname2: apellido2 || undefined,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
export function administrativeRowToCheckParams(row) {
  const primerNombre = toTitleCase(String(row.PrimerNombre || '').trim());
  const segundoNombre = String(row.SegundoNombre || '').trim()
    ? toTitleCase(String(row.SegundoNombre).trim())
    : '';
  const apellido1 = toTitleCase(String(row.PrimerApellido || '').trim());
  const apellido2 = String(row.SegundoApellido || '').trim()
    ? toTitleCase(String(row.SegundoApellido).trim())
    : '';

  const givenName = [primerNombre, segundoNombre].filter(Boolean).join(' ');
  const employeeId = String(row.Cedula || '').trim();

  return {
    givenName,
    surname1: apellido1,
    surname2: apellido2 || undefined,
    employeeId: employeeId || undefined,
  };
}

/**
 * @param {Array<{ row: Record<string, unknown>, rowNumber: number }>} jobs
 * @param {'operational' | 'administrative'} kind
 */
export async function precheckBulkRowsForDuplicates(jobs, kind) {
  const limit = Number(process.env.BULK_PRECHECK_CONCURRENCY);
  const concurrency =
    Number.isFinite(limit) && limit >= 1 && limit <= 10 ? Math.floor(limit) : 4;

  try {
    await warmQueueSamUpnIndex();
  } catch (err) {
    console.warn(
      '[bulk-precheck] Índice cola SMB no precalentado; el chequeo puede ser más lento:',
      err?.message || err
    );
  }

  return mapWithConcurrency(jobs, concurrency, async ({ row, rowNumber }) => {
    const params =
      kind === 'administrative'
        ? administrativeRowToCheckParams(row)
        : operationalRowToCheckParams(row);

    if (!params.givenName || !params.surname1) {
      return {
        row: rowNumber,
        displayName: '',
        exists: false,
        check: null,
        skipPrecheck: true,
        message: 'Fila sin nombre o apellido suficiente para prechequeo.',
      };
    }

    const displayName = buildPersonDisplayName(
      params.givenName,
      params.surname1,
      params.surname2 || ''
    );

    try {
      const check = await checkExistingPersonByName(params);
      return {
        row: rowNumber,
        displayName: check.displayName || displayName,
        exists: check.exists,
        check,
        skipPrecheck: false,
      };
    } catch (err) {
      console.warn(`[bulk-precheck] fila ${rowNumber}:`, err?.message || err);
      return {
        row: rowNumber,
        displayName,
        exists: false,
        check: null,
        skipPrecheck: false,
        message: 'No se pudo verificar duplicados en esta fila.',
      };
    }
  });
}
