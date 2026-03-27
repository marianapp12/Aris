import type { Configuration } from '@azure/msal-browser';

function getEnv(name: string): string {
  const value = import.meta.env[name] as string | undefined;
  if (!value) {
    // No lanzamos error para evitar pantalla en blanco;
    // la app podrá mostrar un mensaje más claro si hace falta.
    console.warn(
      `[msalConfig] Variable de entorno ${name} no definida. Revisa tu archivo .env (Vite).`
    );
    return '';
  }
  return value;
}

export const azureTenantId = getEnv('VITE_AZURE_TENANT_ID');
export const azureClientId = getEnv('VITE_AZURE_CLIENT_ID');
export const logiGroupId = getEnv('VITE_AZURE_LOGI_GROUP_ID');

export const msalConfig: Configuration = {
  auth: {
    clientId: azureClientId,
    authority: `https://login.microsoftonline.com/${azureTenantId}`,
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};

export const graphScopes = ['User.Read', 'GroupMember.Read.All'];

export const loginRequest = {
  scopes: ['openid', 'profile', 'email', ...graphScopes],
};

