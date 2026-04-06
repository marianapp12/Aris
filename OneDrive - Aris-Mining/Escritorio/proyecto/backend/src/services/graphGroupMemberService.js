import { getGraphClient } from '../config/graphClient.js';
import { logGraphApiError, summarizeGraphError } from '../utils/graphApiErrors.js';

const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFoundStatus(err) {
  const s = /** @type {{ statusCode?: number; status?: number }} */ (err)?.statusCode;
  const s2 = /** @type {{ status?: number }} */ (err)?.status;
  return s === 404 || s2 === 404;
}

/**
 * @param {unknown} err
 * @returns {{ httpStatus?: number; code?: string; message?: string }}
 */
function safeGraphErrorForApi(err) {
  const { statusLabel, summary } = summarizeGraphError(err);
  const n = Number(statusLabel);
  let graphCode;
  if (err && typeof err === 'object' && err !== null && 'body' in err) {
    const body = /** @type {{ body?: { error?: { code?: string } } }} */ (err).body;
    if (body && typeof body === 'object' && body !== null && 'error' in body) {
      const ge = /** @type {{ error?: { code?: string } }} */ (body).error;
      if (ge && typeof ge === 'object' && ge !== null && typeof ge.code === 'string') {
        graphCode = ge.code;
      }
    }
  }
  const msg = summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
  return {
    httpStatus: Number.isFinite(n) ? n : undefined,
    code: graphCode,
    message: msg || undefined,
  };
}

/**
 * @typedef {object} AddUserToGroupResult
 * @property {boolean} ok
 * @property {{ httpStatus?: number; code?: string; message?: string } | undefined} graphError - Solo si ok es false tras llamar a Graph
 */

/**
 * Agrega un usuario (u otro directoryObject) como miembro de un grupo.
 * No lanza: los errores solo se registran (la creación del usuario no debe fallar por esto).
 *
 * @param {string} groupObjectId - Object ID del grupo en Entra ID
 * @param {string} userObjectId - Object ID del usuario creado
 * @returns {Promise<AddUserToGroupResult>}
 */
export async function addUserToGroup(groupObjectId, userObjectId) {
  const gid = String(groupObjectId || '').trim();
  const uid = String(userObjectId || '').trim();
  if (!gid || !uid) {
    console.warn('[GRAPH] addUserToGroup: groupObjectId o userObjectId vacío; se omite.');
    return { ok: false };
  }

  const graphClient = getGraphClient();
  /** Referencia OData para un usuario: /users/{id} evita 404 intermitentes tras crear la cuenta. */
  const memberRef = { '@odata.id': `${GRAPH_V1}/users/${uid}` };

  const maxAttempts = 3;
  const delaysMs = [0, 2000, 4000];
  let lastErr = /** @type {unknown} */ (null);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (delaysMs[attempt] > 0) {
      await sleep(delaysMs[attempt]);
    }
    try {
      await graphClient.api(`/groups/${gid}/members/$ref`).post(memberRef);
      if (attempt > 0) {
        console.info(
          `[GRAPH] Miembro agregado al grupo tras reintento ${attempt + 1}: user=${uid} group=${gid}`
        );
      } else {
        console.info(
          `[GRAPH] Miembro agregado al grupo: userObjectId=${uid} groupObjectId=${gid}`
        );
      }
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const retry404 = isNotFoundStatus(err) && attempt < maxAttempts - 1;
      if (retry404) {
        console.warn(
          `[GRAPH] addUserToGroup: HTTP 404 (grupo o usuario aún no visible en Graph). Reintento ${attempt + 2}/${maxAttempts} en ${delaysMs[attempt + 1]} ms… group=${gid}`
        );
        continue;
      }
      logGraphApiError(`agregar usuario ${uid} al grupo ${gid}`, err);
      return { ok: false, graphError: safeGraphErrorForApi(err) };
    }
  }

  logGraphApiError(`agregar usuario ${uid} al grupo ${gid}`, lastErr);
  return { ok: false, graphError: safeGraphErrorForApi(lastErr) };
}

/**
 * Lee el nombre para mostrar del grupo en Graph (GET /groups/{id}?$select=displayName).
 * No lanza: null si falla (permisos, 404, etc.). Suele requerir Group.Read.All u otro permiso de lectura de grupos.
 *
 * @param {string} groupObjectId
 * @returns {Promise<string | null>}
 */
export async function getGroupDisplayName(groupObjectId) {
  const gid = String(groupObjectId || '').trim();
  if (!gid) return null;
  try {
    const graphClient = getGraphClient();
    const g = await graphClient.api(`/groups/${gid}`).select('displayName').get();
    const n = g?.displayName != null ? String(g.displayName).trim() : '';
    return n || null;
  } catch (err) {
    const { summary } = summarizeGraphError(err);
    console.warn(`[GRAPH] getGroupDisplayName: ${summary}`);
    return null;
  }
}
