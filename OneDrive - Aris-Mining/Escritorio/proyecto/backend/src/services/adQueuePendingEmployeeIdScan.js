import fs from 'fs/promises';
import { joinAdQueueFilePath } from '../config/adQueueConfig.js';
import { AdministrativePrecheckError, PRECHECK_CODES } from './administrativePrecheckErrors.js';

const PENDIENTE_JSON_RE = /^pendiente-.+\.json$/i;

/**
 * Lista archivos pendiente-*.json en la carpeta de cola y comprueba si alguno ya usa esta cédula (employeeId).
 * Omite archivos ilegibles o sin employeeId.
 *
 * @param {string} queueUnc - AD_QUEUE_UNC
 * @param {string} employeeId
 * @throws {AdministrativePrecheckError} EMPLOYEE_ID_PENDING_IN_QUEUE
 */
export async function assertNoPendingQueueFileWithEmployeeId(queueUnc, employeeId) {
  const id = String(employeeId).trim();
  if (!id || !String(queueUnc).trim()) return;

  const root = String(queueUnc).replace(/[/\\]+$/g, '');
  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    const code = e?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    console.warn('[AD-Queue] No se pudo leer la carpeta de cola (prechequeo pendiente):', e?.message || e);
    return;
  }

  const names = dirents.filter((d) => d.isFile() && PENDIENTE_JSON_RE.test(d.name)).map((d) => d.name);

  for (const name of names) {
    const fullPath = joinAdQueueFilePath(root, name);
    try {
      const raw = await fs.readFile(fullPath, 'utf8');
      const data = JSON.parse(raw);
      const eid = data?.employeeId != null ? String(data.employeeId).trim() : '';
      if (!eid || eid !== id) continue;

      const isUpdate = data?.queueAction === 'updateByEmployeeId';
      throw new AdministrativePrecheckError(
        PRECHECK_CODES.EMPLOYEE_ID_PENDING_IN_QUEUE,
        isUpdate
          ? `Ya hay una solicitud en cola (actualización) con la cédula / ID "${id}". Espere a que el servidor procese el archivo pendiente antes de volver a usar el mismo documento.`
          : `Ya hay una solicitud en cola de alta con la cédula / ID "${id}". Espere a que Active Directory procese el archivo; Microsoft 365 puede tardar en mostrar al usuario.`,
        409
      );
    } catch (e) {
      if (e instanceof AdministrativePrecheckError) throw e;
    }
  }
}
