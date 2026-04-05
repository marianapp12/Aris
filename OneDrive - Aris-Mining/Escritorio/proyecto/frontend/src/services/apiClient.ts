import axios from 'axios';
import {
  CreateUserRequest,
  CreateUserResponse,
  NextUsernameResponse,
  AdQueueCreationAccepted,
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

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const message = error.response.data?.message || error.response.data?.error || 'Error al crear el usuario';
        throw new Error(message);
      }
      throw new Error('Error de conexión con el servidor');
    }
    throw error;
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
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const message =
          error.response.data?.message ||
          error.response.data?.error ||
          'Error al encolar el usuario administrativo';
        throw new Error(message);
      }
      throw new Error('Error de conexión con el servidor');
    }
    throw error;
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
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const message =
          error.response.data?.message ||
          error.response.data?.error ||
          'Error al encolar el usuario administrativo';
        throw new Error(message);
      }
      throw new Error('Error de conexión con el servidor');
    }
    throw error;
  }
};

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
  const response = await apiClient.get<NextUsernameResponse>(
    `/users/administrative/next-username?${searchParams.toString()}`
  );
  return response.data;
};

export const getNextAvailableUsername = async (params: {
  givenName: string;
  surname1: string;
  surname2?: string;
}): Promise<NextUsernameResponse> => {
  const searchParams = new URLSearchParams({
    givenName: params.givenName,
    surname1: params.surname1,
  });
  if (params.surname2) searchParams.set('surname2', params.surname2);
  const response = await apiClient.get<NextUsernameResponse>(
    `/users/next-username?${searchParams.toString()}`
  );
  return response.data;
};

export const uploadBulkUsers = async (file: File): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post('/users/operational/bulk', formData, {
    headers: {
      // Deja que el navegador establezca el boundary correcto
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

/** Carga masiva administrativa (cola AD / SMB). Misma plantilla que operativos + Cedula y opcional Ciudad. */
export const uploadAdministrativeBulkUsers = async (file: File): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post('/users/administrative/bulk', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export default apiClient;
