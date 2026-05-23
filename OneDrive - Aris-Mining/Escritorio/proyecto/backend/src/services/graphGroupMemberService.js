/**
 * Agregar usuarios a grupos de seguridad M365 y leer el nombre del grupo (Microsoft Graph).
 */
import { getGraphClient } from '../config/graphClient.js';
import { logGraphApiError, summarizeGraphError } from '../utils/graphApiErrors.js';

const GRAPH_V1 = 'https://graph.microsoft.com/v1.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFoundStatus(err) {
  const s = /** @type {{ statusCode?: number; status?: number }} */ (err)?.statusCode;
  const s2 = /** @type {{ status?: number }} */ (err)?.status;
  return s === 404 || s2 === 404;
}

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
 * @property {{ httpStatus?: number; code?: string; message?: string } | undefined} graphError
 */

/**
 * Agrega un usuario a un grupo. No lanza error: el alta en M365 no debe fallar por esto.
 * Reintenta hasta 3 veces si Graph devuelve 404 (usuario o grupo aún no replicado).
 */
export async function addUserToGroup(groupObjectId, userObjectId) {
  const gid = String(groupObjectId || '').trim();
  const uid = String(userObjectId || '').trim();
  if (!gid || !uid) {
    console.warn('[GRAPH] addUserToGroup: falta groupObjectId o userObjectId.');
    return { ok: false };
  }

  const graphClient = getGraphClient();
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
          `[GRAPH] Miembro agregado tras reintento ${attempt + 1}: user=${uid} group=${gid}`
        );
      } else {
        console.info(`[GRAPH] Miembro agregado: user=${uid} group=${gid}`);
      }
      return { ok: true };
    } catch (err) {
      lastErr = err;
      const retry404 = isNotFoundStatus(err) && attempt < maxAttempts - 1;
      if (retry404) {
        console.warn(
          `[GRAPH] 404 al agregar miembro; reintento ${attempt + 2}/${maxAttempts} en ${delaysMs[attempt + 1]} ms (group=${gid})`
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

/** Nombre para mostrar del grupo en Entra ID; null si no hay permiso o el ID no existe. */
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
