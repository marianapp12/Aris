import fs from 'fs/promises';
import { joinAdQueueFilePath, getAdQueueProcessedTtlHours } from '../config/adQueueConfig.js';
import { AdministrativePrecheckError, PRECHECK_CODES } from './administrativePrecheckErrors.js';

/** Nombre de archivo estable por cédula (caracteres no seguros para nombre de archivo → _). */
export function processedRecordFileNameForEmployeeId(employeeId) {
  const safe = String(employeeId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return `procesado-employeeId-${safe}.json`;
}

/**
 * Bloquea si existe registro en carpeta procesados (usuario ya creado en AD por el script PS).
 * La limpieza recomendada de estos archivos cuando Entra ID ya refleja la cédula la hace
 * `adQueueProcessedGraphCleanup` (intervalo AD_PROCESSED_GRAPH_*). AD_QUEUE_PROCESSED_TTL_HOURS
 * es solo respaldo (p. ej. recontratación); por defecto 0 = sin caducidad por tiempo.
 *
 * @param {string} processedBasePath - getAdQueueProcessedPath()
 * @param {string} employeeId
 * @throws {AdministrativePrecheckError} EMPLOYEE_ID_IN_PROCESSED_RECORDS
 */
export async function assertEmployeeIdNotInProcessedRecords(processedBasePath, employeeId) {
  const id = String(employeeId).trim();
  if (!id || !String(processedBasePath).trim()) return;

  const root = String(processedBasePath).replace(/[/\\]+$/g, '');
  const ttlHours = getAdQueueProcessedTtlHours();
  const fullPath = joinAdQueueFilePath(root, processedRecordFileNameForEmployeeId(id));

  let st;
  try {
    st = await fs.stat(fullPath);
  } catch (e) {
    if (e?.code === 'ENOENT') return;
    console.warn('[AD-Queue] No se pudo acceder a registro procesados:', e?.message || e);
    return;
  }
  if (!st.isFile()) return;

  let raw;
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch (e) {
    console.warn('[AD-Queue] No se pudo leer registro procesados:', fullPath, e?.message || e);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.EMPLOYEE_ID_IN_PROCESSED_RECORDS,
      'Existe un registro dañado en la carpeta procesados para esta cédula. Pida a TI que revise o elimine el archivo correspondiente.',
      409
    );
  }

  const cedulaEnArchivo =
    data?.cedula != null ? String(data.cedula).trim() : data?.employeeId != null ? String(data.employeeId).trim() : '';
  if (cedulaEnArchivo && cedulaEnArchivo !== id) {
    throw new AdministrativePrecheckError(
      PRECHECK_CODES.EMPLOYEE_ID_IN_PROCESSED_RECORDS,
      'Inconsistencia entre el nombre del archivo y la cédula en procesados. Revise la carpeta con TI.',
      409
    );
  }

  const fecha = data?.fechaCreacion ?? data?.fecha_creacion;
  if (ttlHours > 0 && fecha) {
    const created = new Date(fecha).getTime();
    if (Number.isFinite(created) && Date.now() - created > ttlHours * 3600000) {
      try {
        await fs.unlink(fullPath);
      } catch {
        /* ignore */
      }
      return;
    }
  }

  const nombre = data?.nombreCompleto ?? data?.nombre_completo ?? data?.displayName ?? '';
  const hint = nombre ? ` (${nombre})` : '';
  throw new AdministrativePrecheckError(
    PRECHECK_CODES.EMPLOYEE_ID_IN_PROCESSED_RECORDS,
    `El usuario ya está en proceso de creación o ya fue creado recientemente en Active Directory${hint}. Microsoft 365 puede tardar varios minutos en reflejar la cuenta tras Azure AD Connect.`,
    409
  );
}
