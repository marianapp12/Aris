import { describe, expect, it } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { getAxiosErrorMessage } from './apiClient';

const dummyConfig = { headers: {} } as InternalAxiosRequestConfig;

function makeAxiosError(partial: Partial<AxiosError>): AxiosError {
  const err = new AxiosError(
    partial.message,
    partial.code,
    partial.config,
    partial.request,
    partial.response
  );
  return err;
}

describe('apiClient — getAxiosErrorMessage', () => {
  it('extrae message del JSON del servidor', () => {
    const err = makeAxiosError({
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: { message: 'Cédula inválida' },
        headers: {},
        config: dummyConfig,
      },
    });
    expect(getAxiosErrorMessage(err, 'fallback')).toBe('Cédula inválida');
  });

  it('usa error si message no viene', () => {
    const err = makeAxiosError({
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: { error: 'Servicio no disponible' },
        headers: {},
        config: dummyConfig,
      },
    });
    expect(getAxiosErrorMessage(err, 'fallback')).toBe('Servicio no disponible');
  });

  it('usa fallback con código HTTP si el cuerpo no tiene texto', () => {
    const err = makeAxiosError({
      response: {
        status: 500,
        statusText: 'Error',
        data: {},
        headers: {},
        config: dummyConfig,
      },
    });
    expect(getAxiosErrorMessage(err, 'Error genérico')).toBe(
      'Error genérico (HTTP 500).'
    );
  });

  it('sin respuesta HTTP indica error de conexión', () => {
    const err = makeAxiosError({ response: undefined });
    expect(getAxiosErrorMessage(err, 'fallback')).toBe(
      'Error de conexión con el servidor'
    );
  });

  it('Error nativo de JavaScript devuelve su message', () => {
    expect(getAxiosErrorMessage(new Error('falló algo'), 'fallback')).toBe(
      'falló algo'
    );
  });

  it('valor desconocido usa fallback', () => {
    expect(getAxiosErrorMessage(null, 'Por defecto')).toBe('Por defecto');
  });
});
