import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';

let graphClient = null;

/**
 * Obtiene o crea el cliente de Microsoft Graph
 */
export const getGraphClient = () => {
  if (graphClient) {
    return graphClient;
  }

  // Validar variables de entorno
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Faltan variables de entorno requeridas: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET'
    );
  }

  // Crear credenciales usando Client Secret
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  // Crear el proveedor de autenticación
  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  // Crear el cliente de Microsoft Graph
  graphClient = Client.initWithMiddleware({ authProvider });

  return graphClient;
};
