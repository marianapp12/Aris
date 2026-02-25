import axios from 'axios';
import { CreateUserRequest, CreateUserResponse, NextUsernameResponse } from '../types/user';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

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

export default apiClient;
