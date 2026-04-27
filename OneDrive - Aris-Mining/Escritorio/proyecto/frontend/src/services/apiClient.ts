/**
 * Cliente HTTP del front hacia la API Express (`/api/users/...`).
 * Centraliza base URL, extracción de mensajes de error del JSON del servidor y llamadas por caso de uso.
 */
import axios from 'axios';
import {
  CreateUserRequest,
  CreateUserResponse,
  NextUsernameResponse,
  AdQueueCreationAccepted,
  AdQueueConnectionTestResult,
  AdQueueRequestResult,
} from '../types/user';

/**
 * El backend monta las rutas bajo `/api` (p. ej. `/api/users/...`).
 * Si `VITE_API_BASE_URL` es solo el origen (`http://localhost:5000`), se añade `/api`
 * para evitar 404. No modifica URLs con path explícito (p. ej. `https://host/v1`).
 */
function resolveApiBaseUrl(raw: string | undefined): string {
  const fallback = '/api';
  if (!raw?.trim()) return fallback;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) return trimmed;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const u = new URL(trimmed);
      if (!u.pathname || u.pathname === '/') {
        return `${u.origin}/api`;
      }
      return trimmed;
    } catch {
      return fallback;
    }
  }

  if (trimmed.startsWith('/')) return trimmed;

  return fallback;
}

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

/** Instancia Axios compartida (JSON; multipart se redefine en masivos). */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Alta individual en Microsoft 365 (POST /api/users/operational). */
export const createOperationalUser = async (
  payload: CreateUserRequest
): Promise<CreateUserResponse> => {
  try {
    const response = await apiClient.post<CreateUserResponse>(
      '/users/operational',
      payload
    );
    return response.data;
  } catch (error) {
    throw new Error(getAxiosErrorMessage(error, 'Error al crear el usuario'));
  }
};

/**
 * Encola creación corporativa en AD: el backend escribe un JSON en la ruta UNC configurada.
 * POST /api/users
 */
export const createUserViaAdQueue = async (
  payload: CreateUserRequest
): Promise<AdQueueCreationAccepted> => {
  try {
    const response = await apiClient.post<AdQueueCreationAccepted>('/users', payload, {
      validateStatus: () => true,
    });
    if (response.status === 202) {
      return response.data;
    }
    const data = response.data as { message?: string; error?: string };
    const message =
      data?.message || data?.error || `Error al encolar el usuario administrativo (${response.status})`;
    throw new Error(message);
  } catch (error) {
    throw new Error(
      getAxiosErrorMessage(error, 'Error al encolar el usuario administrativo')
    );
  }
};

/** Compatibilidad: mismo cuerpo y respuesta que createUserViaAdQueue; ruta legacy POST /administrative. */
export const createAdministrativeUser = async (
  payload: CreateUserRequest
): Promise<AdQueueCreationAccepted> => {
  try {
    const response = await apiClient.post<AdQueueCreationAccepted>(
      '/users/administrative',
      payload,
      { validateStatus: () => true }
    );
    if (response.status === 202) {
      return response.data;
    }
    const data = response.data as { message?: string; error?: string };
    const message =
      data?.message || data?.error || `Error al encolar el usuario administrativo (${response.status})`;
    throw new Error(message);
  } catch (error) {
    throw new Error(
      getAxiosErrorMessage(error, 'Error al encolar el usuario administrativo')
    );
  }
  };

/** Comprueba que el servidor pueda acceder a la carpeta UNC de la cola AD (lectura/escritura). */
export const testAdministrativeQueueConnection =
  async (): Promise<AdQueueConnectionTestResult> => {
    try {
      const response = await apiClient.get<AdQueueConnectionTestResult>(
        '/users/administrative/queue-connection-test'
      );
      return response.data;
    } catch (error) {
      throw new Error(
        getAxiosErrorMessage(error, 'No se pudo probar la conexión a la cola.')
      );
    }
  };

/** Devuelve el primer valor string no vacío entre las claves dadas (útil para respuestas con distinto casing). */
function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** Extrae `message` o `error` del cuerpo JSON del servidor (variantes de mayúsculas). */
function extractApiErrorBody(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const msg = pickString(o, 'message', 'Message', 'error', 'Error');
    if (msg) return msg;
  }
  return fallback;
}

/**
 * Mensaje para mostrar al usuario ante fallos de Axios (cuerpo JSON, texto plano o red).
 */
export function getAxiosErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      const { data, status } = error.response;
      if (typeof data === 'string' && data.trim()) {
        return data.trim().slice(0, 500);
      }
      const fromBody = extractApiErrorBody(data, '');
      if (fromBody) return fromBody;
      return `${fallback} (HTTP ${status}).`;
    }
    return 'Error de conexión con el servidor';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Estado del job en AD: lee resultado-{requestId}.json (carpeta resultados del UNC).
 * Incluye displayName, samAccountName, userPrincipalName y email finales cuando status === 'success'.
 */
export const getAdministrativeQueueRequestResult = async (
  requestId: string
): Promise<AdQueueRequestResult> => {
  const response = await apiClient.get(
    `/users/administrative/queue-requests/${encodeURIComponent(requestId)}/result`,
    { validateStatus: () => true }
  );
  const d = response.data as unknown;

  if (response.status === 200 && d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    const st = o.status ?? o.Status;
    if (st === 'pending' || st === 'success' || st === 'error') {
      const msg =
        pickString(o, 'message', 'Message') ||
        (st === 'pending'
          ? 'Pendiente de procesamiento.'
          : 'Sin mensaje del servidor.');
      return {
        status: st,
        message: msg,
        requestId: pickString(o, 'requestId', 'RequestId') ?? requestId,
        processedAt: pickString(o, 'processedAt', 'ProcessedAt'),
        queueAction: pickString(o, 'queueAction', 'QueueAction'),
        displayName: pickString(o, 'displayName', 'DisplayName'),
        samAccountName: pickString(o, 'samAccountName', 'SamAccountName'),
        userPrincipalName: pickString(
          o,
          'userPrincipalName',
          'UserPrincipalName'
        ),
        email: pickString(o, 'email', 'Email', 'mail', 'Mail'),
      };
    }
  }

  if (response.status === 503) {
    throw new Error(
      extractApiErrorBody(
        d,
        'Configure AD_QUEUE_UNC o AD_QUEUE_RESULTS_UNC en el servidor para consultar resultados.'
      )
    );
  }
  if (response.status === 400) {
    throw new Error(
      extractApiErrorBody(d, 'Identificador de solicitud inválido.')
    );
  }

  throw new Error(
    extractApiErrorBody(
      d,
      `El servidor respondió con código ${response.status} al consultar el estado en Active Directory.`
    )
  );
};

/** Propuesta de `userName` para administrativos (misma regla de unicidad que aplicará el script AD). */
export const getNextAdministrativeUsername = async (params: {
  givenName: string;
  surname1: string;
  surname2?: string;
}): Promise<NextUsernameResponse> => {
  const searchParams = new URLSearchParams({
    givenName: params.givenName,
    surname1: params.surname1,
  });
  if (params.surname2) searchParams.set('surname2', params.surname2);
  try {
    const response = await apiClient.get<NextUsernameResponse>(
      `/users/administrative/next-username?${searchParams.toString()}`
    );
    return response.data;
  } catch (error) {
    throw new Error(
      getAxiosErrorMessage(
        error,
        'No se pudo obtener el nombre de usuario propuesto (administrativo).'
      )
    );
  }
};

/** Respuesta 201 de carga masiva operativa o administrativa. */
export interface BulkUploadApiResponse {
  message?: string;
  results?: unknown[];
}

/** Excel masivo operativo: envía multipart a `/users/operational/bulk`. */
export const uploadBulkUsers = async (file: File): Promise<BulkUploadApiResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await apiClient.post('/users/operational/bulk', formData, {
      headers: {
        // Deja que el navegador establezca el boundary correcto
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(
      getAxiosErrorMessage(
        error,
        'Error al procesar la carga masiva de usuarios operativos.'
      )
    );
  }
};

/** Carga masiva administrativa (cola AD / SMB). Plantilla: Cedula, Ciudad (nombre en AD), Codigo postal, etc. */
export const uploadAdministrativeBulkUsers = async (
  file: File
): Promise<BulkUploadApiResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await apiClient.post('/users/administrative/bulk', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(
      getAxiosErrorMessage(
        error,
        'Error al procesar la carga masiva de usuarios administrativos.'
      )
    );
  }
};

/** Instancia por defecto para interceptores o pruebas; las funciones exportadas usan la misma base. */
export default apiClient;
