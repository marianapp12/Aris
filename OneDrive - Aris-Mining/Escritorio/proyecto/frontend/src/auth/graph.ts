import type { AccountInfo } from '@azure/msal-browser';
import { msalInstance } from './msalInstance';
import { graphScopes, logiGroupId } from './msalConfig';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function getGraphAccessToken(account: AccountInfo): Promise<string> {
  const result = await msalInstance.acquireTokenSilent({
    account,
    scopes: graphScopes,
  });
  return result.accessToken;
}

async function graphFetch<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph error ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export async function ensureUserInLogiGroup(account: AccountInfo): Promise<void> {
  if (!logiGroupId) {
    throw new Error(
      'Falta configurar el grupo permitido (VITE_AZURE_LOGI_GROUP_ID) en el frontend.'
    );
  }

  const accessToken = await getGraphAccessToken(account);

  const data = await graphFetch<{ value: string[] }>(
    `${GRAPH_BASE}/me/checkMemberGroups`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ groupIds: [logiGroupId] }),
    }
  );

  const isMember = Array.isArray(data.value) && data.value.includes(logiGroupId);
  if (!isMember) {
    throw new Error('Access restricted to authorized personnel.');
  }
}

