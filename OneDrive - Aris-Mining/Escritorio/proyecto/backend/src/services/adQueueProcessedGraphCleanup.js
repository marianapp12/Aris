import fs from 'fs/promises';
import { getAdQueueProcessedPath, joinAdQueueFilePath } from '../config/adQueueConfig.js';
import { getGraphClient } from '../config/graphClient.js';
import { findUserByEmployeeId } from './graphAdministrativePrecheck.js';

const PROCESADO_RE = /^procesado-employeeId-.+\.json$/i;

/** Avanza por lotes para no revisar siempre los mismos archivos primero. */
let cleanupFileCursor = 0;

/**
 * Elimina en `procesados` los JSON cuya cédula ya existe en Entra ID (employeeId en Graph).
 * La limpieza por TTL (AD_QUEUE_PROCESSED_TTL_HOURS) queda solo como respaldo operativo.
 *
 * @param {object} [options]
 * @param {import('@microsoft/microsoft-graph-client').Client} [options.graphClient]
 * @param {string} [options.processedPath]
 * @param {number} [options.maxFilesPerCycle]
 */
export async function runAdQueueProcessedGraphCleanupOnce(options = {}) {
  const maxRaw = Number(options.maxFilesPerCycle ?? process.env.AD_PROCESSED_GRAPH_MAX_FILES_PER_CYCLE);
  const maxFiles = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 50;
  const processedBase = options.processedPath ?? getAdQueueProcessedPath();
  if (!String(processedBase).trim()) {
    return { scanned: 0, removed: 0, skipped: 0 };
  }

  const graphClient = options.graphClient ?? getGraphClient();
  const root = String(processedBase).replace(/[/\\]+$/g, '');

  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch (e) {
    console.warn('[AD-Queue] limpieza Graph/procesados: no se pudo leer carpeta:', e?.message || e);
    return { scanned: 0, removed: 0, skipped: 0 };
  }

  const names = dirents.filter((d) => d.isFile() && PROCESADO_RE.test(d.name)).map((d) => d.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const n = sorted.length;
  if (n === 0) {
    return { scanned: 0, removed: 0, skipped: 0 };
  }

  const count = Math.min(maxFiles, n);
  const batch = [];
  for (let i = 0; i < count; i++) {
    batch.push(sorted[(cleanupFileCursor + i) % n]);
  }
  cleanupFileCursor = (cleanupFileCursor + count) % n;

  let scanned = 0;
  let removed = 0;
  let skipped = 0;

  for (const name of batch) {
    scanned++;
    const fullPath = joinAdQueueFilePath(root, name);
    let raw;
    try {
      raw = await fs.readFile(fullPath, 'utf8');
    } catch {
      skipped++;
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    const employeeId =
      (data?.cedula != null && String(data.cedula).trim()) ||
      (data?.employeeId != null && String(data.employeeId).trim()) ||
      '';
    if (!employeeId) {
      skipped++;
      continue;
    }

    try {
      const user = await findUserByEmployeeId(graphClient, employeeId);
      if (user) {
        await fs.unlink(fullPath);
        removed++;
        console.log(`[AD-Queue] Limpieza Graph/procesados: eliminado (Entra ya tiene employeeId) ${name}`);
      }
    } catch (e) {
      console.warn('[AD-Queue] Limpieza Graph/procesados:', name, e?.message || e);
      skipped++;
    }
  }

  return { scanned, removed, skipped };
}

/**
 * Arranca un ciclo periódico que alinea carpeta procesados con Entra ID.
 */
export function startAdQueueProcessedGraphCleanup() {
  const processedPath = getAdQueueProcessedPath();
  const disabled =
    process.env.AD_PROCESSED_GRAPH_CLEANUP_ENABLED === 'false' ||
    process.env.AD_PROCESSED_GRAPH_CLEANUP_ENABLED === '0';

  if (!processedPath) {
    console.log(
      '[AD-Queue] Limpieza Graph/procesados: sin ruta (defina AD_QUEUE_UNC con \\pending o AD_QUEUE_PROCESSED_UNC); worker no iniciado.'
    );
    return;
  }
  if (disabled) {
    console.log('[AD-Queue] Limpieza Graph/procesados: desactivada (AD_PROCESSED_GRAPH_CLEANUP_ENABLED=false).');
    return;
  }

  const intervalMs = Number(process.env.AD_PROCESSED_GRAPH_SYNC_INTERVAL_MS);
  const ms = Number.isFinite(intervalMs) && intervalMs >= 5000 ? intervalMs : 60000;

  const tick = async () => {
    try {
      const client = getGraphClient();
      await runAdQueueProcessedGraphCleanupOnce({ graphClient: client, processedPath });
    } catch (e) {
      console.warn('[AD-Queue] Limpieza Graph/procesados (ciclo):', e?.message || e);
    }
  };

  console.log(
    `[AD-Queue] Limpieza Graph/procesados cada ${ms} ms (si Entra ya tiene la cédula, se borra el JSON en procesados).`
  );
  setInterval(tick, ms);
  setTimeout(tick, 5000);
}
